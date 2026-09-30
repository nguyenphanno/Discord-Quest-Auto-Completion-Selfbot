/**
 * @file Application orchestrator for the v2 CLI.
 *
 * Owns the run lifecycle: banner, preflight validation, gateway handshake,
 * quest execution, reward redemption, run summary and shutdown. Commands differ
 * only in which of those steps they run, so `list`, `redeem`, `dry-run`,
 * `status` and `watch` all funnel through this single object.
 */

import { join } from 'node:path';
import { GatewayDispatchEvents } from 'discord-api-types/v10';
import type { APIUser } from 'discord-api-types/v10';

import type { CliCommand } from './cli';
import { ExitCode, ProcessLifecycle } from './lifecycle';
import { runWatchLoop } from './watch-loop';
import { configReport, describeConfig } from '../config/describe';
import type { QuestBotConfig } from '../config/schema';
import { ClientQuest } from '../discord/client';
import { Constants } from '../discord/constants';
import { EnrollCooldownStore } from '../persistence/enroll-cooldown';
import { QuestCache } from '../persistence/quest-cache';
import { RewardStore } from '../persistence/reward-store';
import { writeRunReport } from '../reporting/file-report';
import { DiscordQuestApi } from '../quests/api/discord-quest-api';
import { enrollBudgetFor, shouldSkipSettled } from '../quests/engine/enroll-budget';
import { applyQuestFilters, boardStats } from '../quests/engine/filters';
import { QuestEngine } from '../quests/engine/quest-engine';
import { defaultRegistry } from '../quests/handlers/default-registry';
import { Quest } from '../quests/model/quest';
import type { ClaimedQuest, QuestRunResult } from '../quests/model/types';
import { Async } from '../shared/async';
import { AppError } from '../shared/errors';
import { Http } from '../shared/http';
import { Time } from '../shared/time';
import { Logger } from '../ui/logger';
import { Blocks } from '../ui/progress';
import { Theme } from '../ui/theme';

/** Commands the application can execute; `help` never reaches it. */
export type RunCommand = Exclude<CliCommand, 'help'>;

const READY_TIMEOUT_MS = 180_000;
const REWARD_STORE_FILE = 'rewards.json';
const COOLDOWN_STORE_FILE = 'enroll-cooldown.json';

export class QuestBotApplication {
	private readonly log = new Logger('app');
	private readonly cache: QuestCache;
	private readonly rewards: RewardStore;
	private readonly cooldown: EnrollCooldownStore;
	private readonly lifecycle = new ProcessLifecycle();
	private client: ClientQuest | null = null;

	constructor(private readonly config: QuestBotConfig) {
		this.cache = new QuestCache(config.cache.directory, config.cache.enabled);
		this.rewards = new RewardStore(join(config.cache.directory, REWARD_STORE_FILE));
		this.cooldown = new EnrollCooldownStore(join(config.cache.directory, COOLDOWN_STORE_FILE));
	}

	/** Runs one command and returns the process exit code. */
	async run(command: RunCommand): Promise<number> {
		this.applyRuntimePreferences();
		if (command === 'status') {
			return await this.printStatus();
		}

		// An empty TOKEN must fail with the CANNOT START panel, not with an
		// uncaught stack trace from the client constructor.
		const report = configReport(this.config);
		if (report.errors.length > 0) {
			this.printCannotStart(report.errors);
			return ExitCode.Failure;
		}

		await this.cache.load();
		this.log.divider('preflight');
		this.log.keyValues(describeConfig(this.config));
		report.notices.forEach((notice) => this.log.info(notice));
		report.warnings.forEach((warning) => this.log.warn(warning));

		const client = new ClientQuest(this.config);
		this.client = client;
		this.lifecycle.install({ onSignal: () => client.reporter.flush() });

		try {
			// The ready listener must exist before the gateway is dialled.
			const ready = this.waitForReady(client);
			ready.catch(() => undefined);
			await client.connect();
			const user = await ready;
			this.log.success(`Logged in as @${user.username} (${user.id})`);
			const api = new DiscordQuestApi(client);
			return command === 'watch'
				? await this.watch(api, user)
				: await this.execute(api, user, command);
		} catch (error) {
			this.reportFailure(client, error);
			return ExitCode.Failure;
		} finally {
			await this.cache.save();
			await client.destroy().catch(() => undefined);
			await client.reporter.flush().catch(() => undefined);
			this.client = null;
		}
	}

	/** Applies the colour/verbosity/log-format preferences before any output. */
	private applyRuntimePreferences(): void {
		Theme.configure({
			ascii: this.config.logAscii,
			color: this.config.logColor === null ? undefined : this.config.logColor,
		});
		Logger.configure({
			level: this.config.logLevel,
			json: this.config.logJson,
			timestamps: this.config.logTimestamps,
		});
		Http.configure(this.config.http);
		Logger.printBanner(`v${Constants.VERSION} ${Theme.glyph.dot} node ${process.version}`);
	}

	private waitForReady(client: ClientQuest): Promise<APIUser> {
		return Async.withTimeout(
			new Promise<APIUser>((resolve) => {
				client.once(GatewayDispatchEvents.Ready, ({ data }) => resolve(data.user));
			}),
			READY_TIMEOUT_MS,
			'gateway ready event',
		);
	}

	/** Turns a failed run into the operator-facing output. */
	private reportFailure(client: ClientQuest, error: unknown): void {
		if (error instanceof AppError && error.code === 'ENROLL_BLOCKED') {
			this.printCannotStart([error.message]);
			return;
		}
		this.log.fatal('Run aborted', error);
		client.sendWebhookMessage(`Run aborted: ${Async.errorMessage(error)}`);
	}

	/** `list` renders the board, `redeem` only claims, the rest drives quests. */
	private async execute(
		api: DiscordQuestApi,
		user: APIUser,
		command: RunCommand,
	): Promise<number> {
		const quests = await this.fetchQuests(api);
		this.printBoard(user, quests);
		if (command === 'list') {
			return ExitCode.Success;
		}
		if (command === 'redeem') {
			return await this.redeem(api, quests);
		}
		return await this.processQuests(api, quests, user.id);
	}

	/** Repeats the actionable part of the run on a local poll interval. */
	private async watch(api: DiscordQuestApi, user: APIUser): Promise<number> {
		const pollMs = this.config.watchPollMs;
		if (pollMs <= 0) {
			this.log.warn('WATCH_POLL_MS must be greater than zero for watch mode.');
			return ExitCode.Usage;
		}
		return await runWatchLoop({
			pollMs,
			signal: this.lifecycle.signal,
			runOnce: async () => {
				const quests = await this.fetchQuests(api);
				return await this.processQuests(api, quests, user.id);
			},
		});
	}

	private async fetchQuests(api: DiscordQuestApi): Promise<Quest[]> {
		const board = await api.fetchBoard(this.config.fetchExcludedQuests);
		return (board.quests ?? []).map((quest) => Quest.create(quest));
	}

	private printBoard(user: APIUser, quests: readonly Quest[]): void {
		const stats = boardStats(quests);
		this.log.divider('quest board');
		this.log.keyValues([
			['Account', `@${user.username} (${user.id})`],
			['Total', String(stats.total)],
			['Pending', String(stats.pending)],
			['Completed', String(stats.completed)],
			['Expired', String(stats.expired)],
		]);
		if (quests.length === 0) {
			return;
		}
		this.log.raw(
			Blocks.table(
				[{ title: 'Quest' }, { title: 'Task' }, { title: 'Reward' }, { title: 'Expires' }],
				quests.map((quest) => [
					quest.name,
					String(quest.taskType() ?? 'none'),
					quest.rewardLabel(),
					Time.relative(quest.expiresAt),
				]),
			),
		);
	}

	/** Include/exclude filters plus the optional settled-quest cache skip. */
	private candidates(quests: readonly Quest[]): Quest[] {
		return applyQuestFilters(quests, this.config.includeQuestIds, this.config.excludeQuestIds)
			.filter((quest) => !quest.isCompleted() && !quest.isExpired())
			.filter((quest) => !shouldSkipSettled(this.cache, quest.id, this.config.cache.skipSettled));
	}

	private async processQuests(
		api: DiscordQuestApi,
		quests: readonly Quest[],
		accountId: string,
	): Promise<number> {
		const candidates = this.candidates(quests);
		if (candidates.length === 0) {
			this.log.info('Nothing to do: no actionable quest was found.');
			return ExitCode.Success;
		}
		const startedAt = Time.iso();
		const engine = new QuestEngine(api, defaultRegistry(), {
			concurrency: this.config.concurrency,
			dryRun: this.config.dryRun,
			workerStaggerMs: 0,
			enrollBudget: enrollBudgetFor(this.cooldown, accountId, this.config.enrollCooldownMs),
		});
		const results = await engine.run(candidates, this.lifecycle.signal);
		for (const result of results) {
			this.cache.recordResult(result);
			if (result.outcome === 'completed') {
				this.client?.emitQuestCompleted(result.questId, result.questName);
			}
		}
		await this.summary(results, startedAt);
		return results.some((result) => result.outcome === 'failed')
			? ExitCode.Failure
			: ExitCode.Success;
	}

	/** Claims the reward of every completed quest, sequentially (rate limits). */
	private async redeem(api: DiscordQuestApi, quests: readonly Quest[]): Promise<number> {
		const claimable = quests.filter((quest) => quest.isCompleted() && !quest.hasClaimedRewards());
		if (claimable.length === 0) {
			this.log.debug('No reward is waiting to be claimed.');
			return ExitCode.Success;
		}
		this.log.divider('rewards');
		let failed = 0;
		for (const quest of claimable) {
			if (this.config.dryRun) {
				this.log.info(
					`${Logger.tag('dry run', 'amber')} would claim "${quest.rewardLabel()}" for "${quest.name}"`,
				);
				continue;
			}
			try {
				const status = await api.claimReward(quest);
				this.cache.markClaimed(quest.id, quest.name);
				this.captureRewardCode(quest, status);
				this.log.success(`Claimed "${quest.rewardLabel()}" for "${quest.name}"`);
			} catch (error) {
				failed++;
				this.log.error(`Failed to claim "${quest.name}"`, error);
			}
		}
		return failed > 0 ? ExitCode.Failure : ExitCode.Success;
	}

	/** Persists a reward code without printing it at info level. */
	private captureRewardCode(quest: Quest, status: ClaimedQuest): void {
		const reward = status.reward_code;
		if (!reward?.code) {
			return;
		}
		this.rewards.record(quest.id, reward.code, reward.sku_id);
		this.log.info(`Reward code stored for "${quest.name}"`);
		this.log.debug(`Reward code for ${quest.id} written to the reward store`);
	}

	/** Prints the table, writes the JSON run report and pings the webhook. */
	private async summary(results: QuestRunResult[], startedAt: string): Promise<void> {
		this.log.divider('run summary');
		if (results.length > 0) {
			this.log.raw(
				Blocks.table(
					[{ title: 'Quest' }, { title: 'Task' }, { title: 'Status' }, { title: 'Detail' }],
					results.map((result) => [
						result.questName,
						result.task,
						result.outcome,
						result.detail,
					]),
				),
			);
		}
		const path = await writeRunReport(this.config.reportDirectory, {
			startedAt,
			finishedAt: Time.iso(),
			results,
		});
		this.log.debug(`Run report written to ${path}`);
		this.client?.reporter.summary('Quest run summary', [
			['Processed', String(results.length)],
			['Completed', String(results.filter((item) => item.outcome === 'completed').length)],
			['Skipped', String(results.filter((item) => item.outcome === 'skipped').length)],
			['Failed', String(results.filter((item) => item.outcome === 'failed').length)],
		]);
	}

	/** `status` reads the local cache only: no network, no token required. */
	private async printStatus(): Promise<number> {
		await this.cache.load();
		const stats = this.cache.stats();
		this.log.divider('status');
		this.log.keyValues([
			['Known quests', String(stats.known)],
			['Settled', String(stats.settled)],
			['Completed', String(stats.completed)],
			['Claimed', String(stats.claimed)],
			['Recorded runs', String(stats.runs)],
		]);
		return ExitCode.Success;
	}

	private printCannotStart(errors: readonly string[]): void {
		printCannotStart(errors);
	}
}

/**
 * The single "you cannot run" panel: a red border plus one line per problem.
 *
 * Exported so the CLI entry point can render the same panel when the
 * configuration itself could not be read, before an application exists.
 */
export function printCannotStart(errors: readonly string[]): void {
	Logger.root.raw(Blocks.panel([...errors], { title: 'CANNOT START', color: 'red' }));
}


