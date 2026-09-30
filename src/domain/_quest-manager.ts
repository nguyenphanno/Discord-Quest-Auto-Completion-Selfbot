/**
 * @file Quest orchestration: collection management, enrolment, task execution
 * and reward claiming.
 *
 * Each worker reports a `QuestRunResult` so the application can print an
 * accurate end-of-run table instead of inferring success from log lines.
 */

import { buildConnector, Client as UndiciClient } from 'undici';
import type { ClientQuest } from '../core/_client';
import { Constants } from '../core/_constants';
import { Quest, SUPPORTED_TASK_ORDER } from '../domain/_quest';
import { QuestTaskConfigType } from '../domain/_types';
import type {
	AllQuestsResponse,
	PartialQuest,
	PublicApplication,
	Quest as QuestShape,
	QuestRunResult,
	QuestTask,
	QuestUserStatus,
} from '../domain/_types';
import { CaptchaService } from '../services/_captcha';
import { Logger } from '../ui/_logger';
import { ProgressBar } from '../ui/_progress';
import { Async } from '../utils/_async';
import { Time } from '../utils/_time';

export interface QuestManagerOptions {
	/** Retries used when claiming a reward. */
	maxRedeemAttempts?: number;
	/** Delay between quest workers when the concurrency is limited. */
	workerStaggerMs?: number;
	/** Report what would happen without enrolling, progressing or claiming. */
	dryRun?: boolean;
}

export class QuestManager implements Iterable<Quest> {
	private readonly quests = new Map<string, Quest>();
	private readonly log = new Logger('quest');
	private readonly options: Required<QuestManagerOptions>;
	private static dispatcher: UndiciClient | null = null;

	constructor(
		public readonly client: ClientQuest,
		quests: Quest[] = [],
		options: QuestManagerOptions = {},
	) {
		this.options = {
			maxRedeemAttempts: options.maxRedeemAttempts ?? Constants.Tuning.maxRedeemAttempts,
			workerStaggerMs: options.workerStaggerMs ?? 0,
			dryRun: options.dryRun ?? false,
		};
		quests.forEach((quest) => this.quests.set(quest.id, quest));
	}

	/**
	 * Builds a manager from a `GET /quests/@me` response.
	 * @throws when quest enrolment is temporarily blocked for the account.
	 */
	static async fromResponse(
		client: ClientQuest,
		response: AllQuestsResponse,
		fetchExcludedQuests = false,
		options: QuestManagerOptions = {},
	): Promise<QuestManager> {
		if (response.quest_enrollment_blocked_until) {
			throw new Error(
				`Quest enrolment is blocked until ${response.quest_enrollment_blocked_until}`,
			);
		}
		const manager = new QuestManager(
			client,
			(response.quests ?? []).map((quest) => Quest.create(quest)),
			options,
		);
		if (fetchExcludedQuests) {
			const excluded: PartialQuest[] = response.excluded_quests ?? [];
			manager.log.debug(`Resolving ${excluded.length} excluded quest(s)`);
			for (const quest of excluded) {
				if (quest?.id) {
					await manager.addExcludedQuest(quest.id);
				}
			}
		}
		return manager;
	}

	/** Fetches the full config of a quest the account cannot participate in. */
	protected async addExcludedQuest(questId: string): Promise<void> {
		try {
			const response = await this.client.rest.get(Constants.Endpoints.quest(questId));
			const quest = Quest.create({
				id: questId,
				config: response as QuestShape['config'],
				user_status: null,
				targeted_content: 0,
				preview: false,
			});
			this.quests.set(quest.id, quest);
			this.log.debug(`Added excluded quest "${quest.name}"`);
		} catch (error) {
			this.log.warn(
				`Failed to fetch excluded quest ${questId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	[Symbol.iterator](): IterableIterator<Quest> {
		return this.quests.values();
	}

	get size(): number {
		return this.quests.size;
	}

	list(): Quest[] {
		return Array.from(this.quests.values());
	}

	get(id: string): Quest | undefined {
		return this.quests.get(id);
	}

	hasQuest(id: string): boolean {
		return this.quests.has(id);
	}

	upsert(quest: Quest): void {
		this.quests.set(quest.id, quest);
	}

	remove(id: string): boolean {
		return this.quests.delete(id);
	}

	clear(): void {
		this.quests.clear();
	}

	getExpired(date: Date = new Date()): Quest[] {
		return this.list().filter((quest) => quest.isExpired(date));
	}

	getCompleted(): Quest[] {
		return this.list().filter((quest) => quest.isCompleted());
	}

	getClaimable(): Quest[] {
		return this.list().filter(
			(quest) => quest.isCompleted() && !quest.hasClaimedRewards(),
		);
	}

	/** Quests that still need work: neither completed nor expired. */
	filterQuestsValidToDo(): Quest[] {
		return this.list().filter((quest) => !quest.isCompleted() && !quest.isExpired());
	}

	/** Quests that are finished but whose reward was not claimed yet. */
	filterQuestsValidToRedeem(): Quest[] {
		return this.list().filter(
			(quest) => quest.isCompleted() && !quest.hasClaimedRewards(),
		);
	}

	/** Whether this manager reports what would happen instead of doing it. */
	get dryRun(): boolean {
		return this.options.dryRun;
	}

	/** Claims a live run would attempt, resolved without touching the API. */
	plannedRedemptions(): Array<{ quest: Quest; platform: number | null }> {
		return this.filterQuestsValidToRedeem().map((quest) => ({
			quest,
			platform: quest.redeemPlatform(),
		}));
	}

	/** Applies the include/exclude filters from the configuration. */
	applyFilters(include: readonly string[], exclude: readonly string[]): Quest[] {
		const included = include.length === 0 ? null : new Set(include);
		const excluded = new Set(exclude);
		return this.list().filter((quest) => {
			if (excluded.has(quest.id)) {
				return false;
			}
			return included === null || included.has(quest.id);
		});
	}

	/** Snapshot used by the summary block. */
	stats(): {
		total: number;
		completed: number;
		claimable: number;
		expired: number;
		pending: number;
	} {
		const all = this.list();
		const completed = all.filter((quest) => quest.isCompleted());
		const expired = all.filter((quest) => quest.isExpired());
		return {
			total: all.length,
			completed: completed.length,
			claimable: all.filter((quest) => quest.isCompleted() && !quest.hasClaimedRewards())
				.length,
			expired: expired.length,
			pending: all.filter((quest) => !quest.isCompleted() && !quest.isExpired()).length,
		};
	}

	/** Batch lookup of public application metadata. */
	getApplicationData(ids: string[]): Promise<PublicApplication[]> {
		const query = new URLSearchParams();
		ids.forEach((id) => query.append('application_ids', id));
		return this.client.rest.get(Constants.Endpoints.publicApplications, {
			query,
		}) as Promise<PublicApplication[]>;
	}

	/**
	 * Undici pool replaying the desktop cipher order. Discord rejects the
	 * default Node ordering on the claim-reward route, so the pool is created
	 * once and shared by every claim instead of per request.
	 */
	private static get claimDispatcher(): UndiciClient {
		if (!QuestManager.dispatcher) {
			QuestManager.dispatcher = new UndiciClient(Constants.ORIGIN, {
				connect: buildConnector({ ciphers: Constants.TLS_CIPHERS }),
			});
		}
		return QuestManager.dispatcher;
	}

	/** Releases the shared claim pool during shutdown. */
	static async closeDispatcher(): Promise<void> {
		const dispatcher = QuestManager.dispatcher;
		QuestManager.dispatcher = null;
		if (dispatcher) {
			await dispatcher.close().catch(() => undefined);
		}
	}

	/**
	 * Enrols the account in a quest.
	 * @warning This endpoint is heavily rate limited (~45 minutes per account).
	 */
	async acceptQuest(quest: Quest, isAndroid = false): Promise<Quest | undefined> {
		const status = (await this.client.rest.post(Constants.Endpoints.enroll(quest.id), {
			body: {
				location: isAndroid
					? Constants.QuestContentType.QUEST_HOME_MOBILE
					: Constants.QuestContentType.QUEST_HOME_DESKTOP,
				is_targeted: false,
				metadata_sealed: null,
				traffic_metadata_raw: quest.raw.traffic_metadata_raw,
				traffic_metadata_sealed: quest.raw.traffic_metadata_sealed,
			},
			headers: {
				[Constants.ANDROID_HEADER]: isAndroid ? 'true' : 'false',
			},
		})) as QuestUserStatus;

		const updated = this.get(quest.id);
		updated?.updateUserStatus(status);
		this.log.debug(
			`Enrolled in "${quest.name}" using the ${isAndroid ? 'Android' : 'Desktop'} profile`,
		);
		return updated;
	}

	/**
	 * Claims the reward of a completed quest, transparently solving an hCaptcha
	 * challenge when one is raised and a provider is configured.
	 * @returns whether the reward was claimed.
	 */
	async redeemQuest(
		quest: Quest,
		retry = 0,
		captchaHeaders?: Record<string, string>,
	): Promise<boolean> {
		const questName = quest.name;
		if (retry >= this.options.maxRedeemAttempts) {
			this.log.error(
				`Giving up on "${questName}" after ${this.options.maxRedeemAttempts} attempt(s)`,
			);
			return false;
		}
		if (!quest.isCompleted()) {
			this.log.warn(`Cannot claim "${questName}": the quest is not completed yet`);
			return false;
		}
		if (quest.hasClaimedRewards()) {
			this.log.debug(`Rewards for "${questName}" were already claimed`);
			return false;
		}
		const platform = quest.redeemPlatform();
		if (platform === null) {
			this.log.warn(`Cannot claim "${questName}": no reward platform advertised`);
			return false;
		}
		if (this.options.dryRun) {
			this.log.info(
				`${Logger.tag('dry run', 'amber')} would claim "${quest.rewardLabel()}" for "${questName}" on platform ${platform}`,
			);
			return false;
		}

		try {
			const status = (await this.client.rest.post(
				Constants.Endpoints.claimReward(quest.id),
				{
					body: {
						platform,
						location: Constants.QuestContentType.QUEST_HOME_DESKTOP,
						is_targeted: false,
						metadata_raw: null,
						metadata_sealed: null,
						traffic_metadata_raw: quest.raw.traffic_metadata_raw,
						traffic_metadata_sealed: quest.raw.traffic_metadata_sealed,
					},
					headers: captchaHeaders,
					dispatcher: QuestManager.claimDispatcher,
				},
			)) as QuestUserStatus;
			quest.updateUserStatus(status);
			this.log.success(`Claimed "${quest.rewardLabel()}" for "${questName}"`);
			return true;
		} catch (error) {
			const challenge = CaptchaService.extractChallenge(
				(error as { rawError?: unknown } | null)?.rawError,
			);
			if (!challenge) {
				this.log.error(`Failed to claim rewards for "${questName}"`, error);
				return false;
			}
			this.log.warn(`Captcha required to claim "${questName}"`);
			try {
				const solution = await this.client.captcha.solve(challenge);
				this.log.info(
					`Captcha key solved: ${solution.token.slice(0, 30)}... retrying the claim`,
				);
				return this.redeemQuest(quest, retry + 1, solution.headers);
			} catch (captchaError) {
				this.log.error(`Captcha solving failed for "${questName}"`, captchaError);
				return false;
			}
		}
	}

	/**
	 * One line describing what a live run would do for a quest. Resolved purely
	 * from the cached payload so a dry run cannot mutate account state by accident.
	 */
	private dryRunPlan(quest: Quest, task: QuestTask, taskType: QuestTaskConfigType): string {
		if (taskType === QuestTaskConfigType.STREAM_ON_DESKTOP) {
			return `"${quest.name}": would skip ${taskType} (desktop client only)`;
		}
		const profile = quest.isAndroidProfile() ? 'Android' : 'Desktop';
		const platform = quest.redeemPlatform();
		const steps = [
			quest.isEnrolledQuest() ? 'already enrolled' : `enrol (${profile})`,
			`drive ${taskType} ${quest.taskProgress(taskType)}/${task.target}s`,
			platform === null ? 'claim (no reward platform)' : `claim "${quest.rewardLabel()}"`,
		];
		return `"${quest.name}": ${steps.join(' -> ')}`;
	}

	/**
	 * Processes one quest end to end: enrolment, task execution, completion
	 * announcement. Never throws - failures are reported as a result.
	 */
	async doingQuest(quest: Quest, index = 0, total = 0): Promise<QuestRunResult> {
		const questName = quest.name;
		const taskType = quest.taskType();
		const base = { questId: quest.id, questName };
		const isAndroid = quest.isAndroidProfile();

		if (total > 0) {
			this.log.step(
				index,
				total,
				`${Logger.strong(questName)} ${Logger.tag(taskType ?? 'unknown', 'gray400')}`,
			);
		}

		if (quest.isExpired()) {
			this.log.warn(
				`Skipping "${questName}": expired ${Time.relative(quest.expiresAt)}`,
			);
			return {
				...base,
				task: taskType ?? 'UNKNOWN',
				outcome: 'skipped',
				detail: 'expired',
			};
		}
		if (quest.isCompleted()) {
			this.log.debug(`"${questName}" is already completed`);
			return {
				...base,
				task: taskType ?? 'UNKNOWN',
				outcome: 'already-complete',
				detail: 'already completed',
			};
		}

		// Resolved before enrolling: the enrol endpoint is rate limited to roughly
		// one call per 45 minutes per account, so a quest this run cannot drive
		// has to be rejected before that budget is spent on it.
		const task = quest.primaryTask();
		if (!task || !taskType) {
			this.log.warn(`No supported task found for "${questName}"`);
			return {
				...base,
				task: 'UNKNOWN',
				outcome: 'skipped',
				detail: 'unsupported task',
			};
		}

		if (this.options.dryRun) {
			const detail = this.dryRunPlan(quest, task, taskType);
			this.log.info(`${Logger.tag('dry run', 'amber')} ${detail}`);
			return { ...base, task: taskType, outcome: 'skipped', detail };
		}

		if (!quest.isEnrolledQuest()) {
			this.log.info(
				`Enrolling in "${questName}" using the ${isAndroid ? 'Android' : 'Desktop'} profile`,
			);
			try {
				await this.acceptQuest(quest, isAndroid);
			} catch (error) {
				this.log.error(`Failed to enrol in "${questName}"`, error);
				return {
					...base,
					task: taskType ?? 'UNKNOWN',
					outcome: 'failed',
					detail: Async.errorMessage(error),
				};
			}
		} else {
			this.log.debug(`Already enrolled in "${questName}"`);
		}

		const secondsNeeded = task.target;
		const secondsDone = quest.taskProgress(taskType);
		const applicationName = quest.applicationName;

		try {
			switch (taskType) {
				case QuestTaskConfigType.WATCH_VIDEO:
				case QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE: {
					await this.doingWatchVideoQuest(quest, secondsNeeded, secondsDone);
					break;
				}
				case QuestTaskConfigType.PLAY_ON_XBOX:
				case QuestTaskConfigType.PLAY_ON_PLAYSTATION:
				case QuestTaskConfigType.PLAY_ON_DESKTOP:
				case QuestTaskConfigType.PLAY_ON_DESKTOP_V2: {
					await this.doingPlayOnPlatformQuest(
						quest,
						taskType,
						secondsNeeded,
						applicationName,
					);
					break;
				}
				case QuestTaskConfigType.PLAY_ACTIVITY: {
					await this.doingPlayActivityQuest(
						quest,
						taskType,
						secondsNeeded,
						applicationName,
					);
					break;
				}
				case QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY: {
					await this.doingAchievementInActivityQuest(quest, taskType, secondsNeeded);
					break;
				}
				case QuestTaskConfigType.STREAM_ON_DESKTOP: {
					this.log.warn(
						`"${questName}" needs STREAM_ON_DESKTOP, which only works from the Discord desktop client`,
					);
					return {
						...base,
						task: taskType,
						outcome: 'skipped',
						detail: 'stream unsupported',
					};
				}
				default: {
					this.log.warn(`Unsupported task type ${taskType} for "${questName}"`);
					return {
						...base,
						task: taskType,
						outcome: 'skipped',
						detail: 'unsupported task',
					};
				}
			}
		} catch (error) {
			this.log.error(`Quest "${questName}" failed`, error);
			return {
				...base,
				task: taskType,
				outcome: 'failed',
				detail: Async.errorMessage(error),
			};
		}

		this.log.success(`Quest "${questName}" completed`);
		this.client.emitQuestCompleted(quest.id, questName);
		return { ...base, task: taskType, outcome: 'completed', detail: 'task finished' };
	}

	/**
	 * Fakes video playback by submitting timestamps slightly ahead of real time.
	 *
	 * Timestamps may never run more than `videoMaxFutureSeconds` ahead of the
	 * enrol clock, otherwise Discord discards the progress, so the loop waits
	 * whenever it catches up.
	 */
	private async doingWatchVideoQuest(
		quest: Quest,
		secondsNeeded: number,
		secondsDone: number,
	): Promise<void> {
		const { videoMaxFutureSeconds, videoSpeedSeconds, videoIntervalSeconds } =
			Constants.Tuning;
		const questName = quest.name;
		const enrolledAt = Time.parse(quest.userStatus?.enrolled_at)?.getTime() ?? Date.now();
		let done = secondsDone;
		let completed = false;
		let ticks = 0;

		this.log.info(
			`Spoofing video for "${questName}" (${Time.duration(secondsNeeded - secondsDone)} to go)`,
		);

		while (true) {
			const maxAllowed =
				Math.floor((Date.now() - enrolledAt) / 1000) + videoMaxFutureSeconds;
			const diff = maxAllowed - done;
			const timestamp = done + videoSpeedSeconds;

			if (diff >= videoSpeedSeconds) {
				const status = (await this.client.rest.post(
					Constants.Endpoints.videoProgress(quest.id),
					{
						body: {
							timestamp: Math.min(secondsNeeded, timestamp + Math.random()),
						},
					},
				)) as QuestUserStatus;
				completed = status?.completed_at != null;
				quest.updateUserStatus(status);
				done = Math.min(secondsNeeded, timestamp);
				ticks++;

				const bar = ProgressBar.withTiming(done, secondsNeeded);
				if (ticks % 8 === 0) {
					// Roughly once a minute: enough signal without flooding the log.
					this.log.info(`Watching "${questName}" ${bar}`);
				} else {
					this.log.debug(`video progress "${questName}" ${bar}`);
				}
			}

			if (timestamp >= secondsNeeded) {
				break;
			}
			await Async.sleep(videoIntervalSeconds * 1000);
		}

		if (!completed) {
			const status = (await this.client.rest.post(
				Constants.Endpoints.videoProgress(quest.id),
				{ body: { timestamp: secondsNeeded } },
			)) as QuestUserStatus;
			quest.updateUserStatus(status);
		}
	}

	/** Heartbeat based tasks: PLAY_ON_DESKTOP / XBOX / PLAYSTATION. */
	private async doingPlayOnPlatformQuest(
		quest: Quest,
		taskType: QuestTaskConfigType,
		secondsNeeded: number,
		applicationName: string,
	): Promise<void> {
		const interval = Constants.Tuning.heartbeatIntervalSeconds;
		const questName = quest.name;

		while (!quest.isCompleted()) {
			const secondsDone = quest.taskProgress(taskType);
			const status = (await this.client.rest.post(
				Constants.Endpoints.heartbeat(quest.id),
				{
					body: {
						application_id: quest.applicationId,
						terminal: false,
					},
				},
			)) as QuestUserStatus;
			quest.updateUserStatus(status);
			this.log.info(
				`Spoofed your game to ${applicationName}. Wait for ${Time.humanize(
					secondsNeeded - secondsDone,
				)} more. ${ProgressBar.withTiming(secondsDone, secondsNeeded)}`,
			);
			await Async.sleep(interval * 1000);
		}

		const status = (await this.client.rest.post(Constants.Endpoints.heartbeat(quest.id), {
			body: {
				application_id: quest.applicationId,
				terminal: true,
			},
		})) as QuestUserStatus;
		quest.updateUserStatus(status);
		this.log.debug(`Terminal heartbeat sent for "${questName}"`);
	}

	/**
	 * Heartbeat based task that reports voice channel activity.
	 *
	 * The `stream_key` identifies the "channel" the user is supposedly in; the
	 * placeholder used here mirrors what the original project sends.
	 */
	private async doingPlayActivityQuest(
		quest: Quest,
		taskType: QuestTaskConfigType,
		secondsNeeded: number,
		applicationName: string,
	): Promise<void> {
		const interval = Constants.Tuning.heartbeatIntervalSeconds;
		const streamKey = 'call:1:1';
		const questName = quest.name;

		while (!quest.isCompleted()) {
			const secondsDone = quest.taskProgress(taskType);
			const status = (await this.client.rest.post(
				Constants.Endpoints.heartbeat(quest.id),
				{
					body: { stream_key: streamKey, terminal: false },
				},
			)) as QuestUserStatus;
			quest.updateUserStatus(status);
			this.log.info(
				`Spoofed your activity to ${applicationName}. Wait for ${Time.humanize(
					secondsNeeded - secondsDone,
				)} more. ${ProgressBar.withTiming(secondsDone, secondsNeeded)}`,
			);
			await Async.sleep(interval * 1000);
		}

		const status = (await this.client.rest.post(Constants.Endpoints.heartbeat(quest.id), {
			body: { stream_key: streamKey, terminal: true },
		})) as QuestUserStatus;
		quest.updateUserStatus(status);
		this.log.debug(`Terminal heartbeat sent for "${questName}"`);
	}

	/**
	 * ACHIEVEMENT_IN_ACTIVITY: authorize the quest application, exchange the
	 * code for an activity token through the discordsays proxy, report progress
	 * and then revoke the authorization again.
	 */
	private async doingAchievementInActivityQuest(
		quest: Quest,
		taskType: QuestTaskConfigType,
		questTarget: number,
	): Promise<void> {
		const applicationId = quest.applicationId;
		const applicationName = quest.applicationName;
		const secondsDone = quest.taskProgress(taskType);
		if (questTarget > 0 && secondsDone >= questTarget) {
			this.log.debug(`"${quest.name}" already reported the full activity progress`);
		}

		const query = new URLSearchParams({
			response_type: 'code',
			client_id: applicationId,
			scope: 'identify applications.commands applications.entitlements',
			state: '',
		});
		const authorization = (await this.client.rest.post(
			Constants.Endpoints.oauthAuthorize,
			{
				query,
				body: {
					permissions: '0',
					authorize: true,
					integration_type: 1,
					location_context: {
						guild_id: '10000',
						channel_id: '10000',
						channel_type: 10000,
					},
				},
			},
		)) as Record<string, unknown>;

		this.log.info(`Authorized application ${applicationName}`);

		const location =
			typeof authorization?.location === 'string' ? authorization.location : null;
		let authCode: string | null = null;
		if (location) {
			authCode = new URL(location).searchParams.get('code');
		}
		if (!authCode) {
			throw new Error(
				`No auth code returned for application ${applicationName}; cannot complete the quest`,
			);
		}

		const { token, error: authError, activityReferrer } =
			await this.client.discordSays.authorize(applicationId, quest.id, authCode);
		if (authError || !token) {
			throw new Error(
				`Failed to authorize with the activity proxy for ${applicationName}: ${authError ?? 'no token'}`,
			);
		}

		const { success, error: progressError } = await this.client.discordSays.progress(
			applicationId,
			quest.id,
			token,
			questTarget,
			activityReferrer,
		);
		if (progressError || !success) {
			throw new Error(
				`Failed to report activity progress for ${applicationName}: ${progressError ?? 'unknown error'}`,
			);
		}

		await this.deauthorizeApplication(applicationId, applicationName);
	}

	/** Best-effort removal of the OAuth grant created for a quest. */
	private async deauthorizeApplication(
		applicationId: string,
		applicationName: string,
	): Promise<void> {
		try {
			const tokens = await this.client.discordSays.listAuthorizedTokens();
			const tokenInfo = tokens.find((token) => token.application?.id === applicationId);
			if (tokenInfo) {
				await this.client.discordSays.deauthorize(tokenInfo.id, applicationName);
			}
		} catch (error) {
			this.log.warn(`Could not deauthorize ${applicationName}: ${Async.errorMessage(error)}`);
		}
	}
}




