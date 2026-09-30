/**
 * @file Application orchestrator.
 *
 * Owns the run lifecycle: banner, preflight validation, gateway handshake,
 * quest execution, run summary and shutdown. Keeping this in one place means
 * `bot.ts` stays a three line entry point and the flow can be unit tested.
 */

import { GatewayDispatchEvents } from 'discord-api-types/v10';
import type { APIUser } from 'discord-api-types/v10';

import { ClientQuest } from './core/_client';
import { Config, ConfigError } from './core/_config';
import type { QuestBotConfig, ValidationReport } from './core/_config';
import { Constants } from './core/_constants';
import type { QuestManager } from './domain/_quest-manager';
import type { QuestOutcome, QuestRunResult } from './domain/_types';
import { QuestCache } from './services/_quest-cache';
import { Logger } from './ui/_logger';
import { Blocks, ProgressBar } from './ui/_progress';
import { Theme } from './ui/_theme';
import { Async } from './utils/_async';
import { Http } from './utils/_http';
import { Time } from './utils/_time';

const OUTCOME_STYLES: Record<QuestOutcome, { label: string; colour: 'green' | 'gray400' | 'red' | 'amber' }> = {
	completed: { label: 'completed', colour: 'green' },
	'already-complete': { label: 'done earlier', colour: 'gray400' },
	failed: { label: 'failed', colour: 'red' },
	skipped: { label: 'skipped', colour: 'amber' },
};

export class QuestBotApplication {
	private readonly log = new Logger('app');
	private readonly cache: QuestCache;
	private client: ClientQuest | null = null;
	private shuttingDown = false;
	/** Quests of this run the cache had never seen before. */
	private newQuestCount = 0;

	constructor(readonly config: QuestBotConfig) {
		this.cache = new QuestCache(config.cache.directory, config.cache.enabled);
	}

	/** Runs the whole cycle and returns the process exit code. */
	async start(): Promise<number> {
		this.applyRuntimePreferences();
		this.printBanner();
		this.registerProcessHandlers();

		const report = Config.report(this.config);
		if (report.errors.length > 0) {
			this.printConfigurationFailure(report);
			return 1;
		}
		await this.cache.load();
		this.printPreflight(report);

		const client = new ClientQuest(this.config);
		this.client = client;

		try {
			// The ready listener must exist before the gateway is dialled.
			const ready = this.waitForReady(client);
			ready.catch(() => undefined);
			await client.connect();
			const user = await ready;
			this.log.success(
				this.config.isCi ? 'Logged in' : `Logged in as @${user.username}`,
			);

			const results = await this.executeQuestCycle(client, user);
			await this.printSummary(client, results);

			await client.destroy();
			this.log.success('All quests processed. Disconnected cleanly.');
			return 0;
		} catch (error) {
			if (error instanceof ConfigError) {
				this.printConfigurationFailure({
					errors: error.problems,
					warnings: [],
					notices: [],
				});
				return 1;
			}
			this.log.fatal('Run aborted', error);
			client.sendWebhookMessage(`Run aborted: ${Async.errorMessage(error)}`);
			await client.destroy().catch(() => undefined);
			return 1;
		} finally {
			await this.cache.save();
			await this.client?.reporter.flush().catch(() => undefined);
			this.client = null;
		}
	}

	/** Applies colour/ASCII/verbosity/log-format preferences. */
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
		Http.configure({
			timeoutMs: this.config.http.timeoutMs,
			retries: this.config.http.retries,
			retryDelayMs: this.config.http.retryDelayMs,
		});
	}

	/** Prints the ASCII wordmark with a version and runtime footer. */
	private printBanner(): void {
		const meta = [
			`v${Constants.VERSION}`,
			`node ${process.version}`,
			`${process.platform} ${process.arch}`,
			Time.stamp(),
		].join(` ${Theme.glyph.dot} `);
		Logger.printBanner(meta);
	}

	/** Preflight block: resolved settings plus any advice. */
	private printPreflight(report: ValidationReport): void {
		this.log.divider('preflight');
		this.log.keyValues([...Config.describe(this.config), ...this.cacheRows()]);
		report.notices.forEach((notice) => this.log.info(notice));
		report.warnings.forEach((warning) => this.log.warn(warning));
		this.log.blank();
	}

	/** Run history row appended to the preflight block. */
	private cacheRows(): Array<[string, string]> {
		if (!this.config.cache.enabled) {
			return [];
		}
		const stats = this.cache.stats();
		if (stats.known === 0) {
			return [['History', 'no quest seen by a previous run']];
		}
		return [
			[
				'History',
				`${stats.known} quest(s) over ${stats.runs} run(s), ${stats.settled} fully settled`,
			],
		];
	}

	/** Friendly failure block listing every configuration problem at once. */
	private printConfigurationFailure(report: ValidationReport): void {
		this.log.divider('configuration');
		this.log.raw(
			Blocks.panel(
				[
					...report.errors.map((error) => `${Theme.fg('redSoft', '!')} ${error}`),
					'',
					Theme.fg('gray500', 'Fix .env (see .env.example) or the repository secrets.'),
				],
				{ title: 'CANNOT START', color: 'red' },
			),
		);
		this.log.blank();
	}

	/** Wires process level failure and termination handling. */
	private registerProcessHandlers(): void {
		process.on('unhandledRejection', (reason) => {
			this.log.error('Unhandled promise rejection', reason);
		});
		process.on('uncaughtException', (error) => {
			this.log.fatal('Uncaught exception', error);
			void this.shutdown('uncaughtException').finally(() => {
				process.exitCode = 1;
			});
		});
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			process.on(signal, () => {
				this.log.warn(`Received ${signal}; shutting down`);
				void this.shutdown(signal);
			});
		}
	}

	/** Resolves with the authenticated user once the gateway is ready. */
	private waitForReady(client: ClientQuest, timeoutMs = 180_000): Promise<APIUser> {
		const ready = new Promise<APIUser>((resolve) => {
			client.once(GatewayDispatchEvents.Ready, ({ data }) => resolve(data.user));
		});
		return Async.withTimeout(ready, timeoutMs, 'gateway ready event');
	}

	/** Closes the client once; safe to call from signal handlers. */
	private async shutdown(reason: string): Promise<void> {
		if (this.shuttingDown) {
			return;
		}
		this.shuttingDown = true;
		this.log.warn(`Shutting down (${reason})`);
		const client = this.client;
		if (client) {
			await client.destroy().catch(() => undefined);
			await client.reporter.flush().catch(() => undefined);
		}
		await this.cache.save();
	}

	/** Fetches the quest board, filters it and processes every actionable quest. */
	private async executeQuestCycle(
		client: ClientQuest,
		user: APIUser,
	): Promise<QuestRunResult[]> {
		const manager = await client.fetchQuests(this.config.fetchExcludedQuests);
		const stats = manager.stats();

		this.log.divider('quest board');
		this.log.keyValues([
			['Account', `@${user.username} (${user.id})`],
			['Total', String(stats.total)],
			['Pending', String(stats.pending)],
			['Completed', String(stats.completed)],
			['Expired', String(stats.expired)],
		]);

		const filtered = manager.applyFilters(
			this.config.includeQuestIds,
			this.config.excludeQuestIds,
		);
		const candidates = filtered.filter(
			(quest) => !quest.isCompleted() && !quest.isExpired(),
		);

		if (candidates.length === 0) {
			this.log.info('Nothing to do: no actionable quest was found.');
			return [];
		}

		this.log.info(
			`Found ${candidates.length} valid quest(s) to process ` +
				(this.config.concurrency > 0
					? `with ${this.config.concurrency} worker(s).`
					: 'with unbounded concurrency.'),
		);
		this.log.blank();

		const settled = await Async.mapLimit(
			candidates,
			this.config.concurrency,
			(quest, index) => manager.doingQuest(quest, index + 1, candidates.length),
		);

		const results = settled.map((result, index): QuestRunResult => {
			if (result.status === 'fulfilled') {
				return result.value;
			}
			const quest = candidates[index];
			return {
				questId: quest.id,
				questName: quest.name,
				task: 'UNKNOWN',
				outcome: 'failed',
				detail: Async.errorMessage(result.reason),
			};
		});

		this.recordResults(results);
		return results;
	}

	/**
	 * Folds the run into the persistent cache and reports the quests that showed
	 * up for the first time. New-comers are resolved before recording, because
	 * recording is exactly what makes a quest known.
	 */
	private recordResults(results: readonly QuestRunResult[]): void {
		if (!this.config.cache.enabled) {
			return;
		}
		const fresh = this.cache.newQuests(results);
		this.newQuestCount = fresh.length;
		for (const result of results) {
			this.cache.recordResult(result);
		}
		if (fresh.length === 0) {
			return;
		}
		const names = fresh
			.slice(0, 5)
			.map((result) => result.questName)
			.join(', ');
		const rest = fresh.length > 5 ? ` (+${fresh.length - 5} more)` : '';
		this.log.info(`${fresh.length} quest(s) never seen before: ${names}${rest}`);
	}

	/** Claims rewards for finished quests, sequentially due to rate limits. */
	private async redeemRewards(
		manager: QuestManager,
	): Promise<{ claimed: number; failed: number }> {
		const claimable = manager.filterQuestsValidToRedeem();
		if (claimable.length === 0) {
			this.log.debug('No reward is waiting to be claimed.');
			return { claimed: 0, failed: 0 };
		}

		this.log.divider('rewards');
		if (manager.dryRun) {
			for (const { quest, platform } of manager.plannedRedemptions()) {
				this.log.info(
					`${Logger.tag('dry run', 'amber')} would claim "${quest.rewardLabel()}" for "${quest.name}"` +
						(platform === null ? ' (no reward platform)' : ` on platform ${platform}`),
				);
			}
			return { claimed: 0, failed: 0 };
		}
		let claimed = 0;
		let failed = 0;
		for (const quest of claimable) {
			const ok = await manager.redeemQuest(quest);
			if (ok) {
				claimed++;
				this.cache.markClaimed(quest.id, quest.name);
			} else {
				failed++;
			}
		}
		return { claimed, failed };
	}

	/** Prints (and reports) the end-of-run summary block. */
	private async printSummary(
		client: ClientQuest,
		results: QuestRunResult[],
	): Promise<void> {
		const counts: Record<QuestOutcome, number> = {
			completed: 0,
			'already-complete': 0,
			failed: 0,
			skipped: 0,
		};
		for (const result of results) {
			counts[result.outcome]++;
		}

		const loggerStats = Logger.stats();
		this.log.divider('run summary');

		if (results.length > 0) {
			this.log.raw(
				Blocks.table(
					[
						{ title: 'Quest' },
						{ title: 'Task' },
						{ title: 'Status', align: 'right' },
						{ title: 'Detail', align: 'right' },
					],
					results.map((result) => [
						result.questName,
						result.task,
						OUTCOME_STYLES[result.outcome].label,
						result.detail,
					]),
				),
			);
			this.log.blank();
			this.log.raw(
				`  ${ProgressBar.render(counts.completed, results.length, { suffix: Theme.fg('gray500', 'quests completed') })}`,
			);
			this.log.blank();
		}

		const rows: Array<[string, string]> = [
			['Processed', String(results.length)],
			['Completed', String(counts.completed)],
			['Already done', String(counts['already-complete'])],
			['Skipped', String(counts.skipped)],
			['Failed', String(counts.failed)],
			['Duration', Time.duration(loggerStats.elapsedMs / Time.Second)],
			['Warnings', String(loggerStats.warnings)],
			['Errors', String(loggerStats.errors)],
		];

		const manager = client.questManager;
		if (this.config.redeemRewards && manager) {
			const { claimed, failed } = await this.redeemRewards(manager);
			rows.push(['Rewards claimed', String(claimed)]);
			if (failed > 0) {
				rows.push(['Rewards failed', String(failed)]);
			}
		}

		this.log.raw(
			Blocks.panel(
				rows.map(
					([label, value]) =>
						`${Theme.padEnd(Theme.fg('gray400', label), 16)}  ${Theme.fg('gray100', value)}`,
				),
				{ title: 'RESULT', color: 'gray700' },
			),
		);
		this.log.blank();

		client.reporter.summary('Quest run summary', rows);
	}
}

