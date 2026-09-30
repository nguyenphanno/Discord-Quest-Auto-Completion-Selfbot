/**
 * @file `Quest` entity - a thin, immutable view over the raw quest payload with
 * the derived questions the quest flow keeps asking (status, task, progress,
 * expiry, reward platform).
 */

import { Time } from '../utils/_time';
import { QuestTaskConfigType } from './_types';
import type {
	Quest as QuestShape,
	QuestReward,
	QuestTask,
	QuestUserStatus,
} from './_types';

/**
 * Task types the bot knows how to drive, in resolution priority order.
 *
 * The first eight entries preserve the historical ordering so the task a quest
 * resolves to does not change for existing payloads; the remaining types are
 * appended for completeness.
 */
export const SUPPORTED_TASK_ORDER: readonly QuestTaskConfigType[] = [
	QuestTaskConfigType.WATCH_VIDEO,
	QuestTaskConfigType.PLAY_ON_DESKTOP,
	QuestTaskConfigType.PLAY_ON_XBOX,
	QuestTaskConfigType.PLAY_ON_PLAYSTATION,
	QuestTaskConfigType.STREAM_ON_DESKTOP,
	QuestTaskConfigType.PLAY_ACTIVITY,
	QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE,
	QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY,
	QuestTaskConfigType.PLAY_ON_DESKTOP_V2,
	QuestTaskConfigType.ACHIEVEMENT_IN_GAME,
];

export class Quest {
	private constructor(private readonly data: QuestShape) {}

	static create(data: QuestShape): Quest {
		return new Quest(data);
	}

	get id(): string {
		return this.data.id;
	}

	get config(): QuestShape['config'] {
		return this.data.config;
	}

	get userStatus(): QuestUserStatus | null {
		return this.data.user_status;
	}

	get targetedContent(): number | number[] | undefined {
		return this.data.targeted_content;
	}

	get preview(): boolean {
		return this.data.preview;
	}

	/** The raw payload, used when enrolling or claiming requires sealed data. */
	get raw(): QuestShape {
		return this.data;
	}

	/** Human readable quest name. */
	get name(): string {
		return this.config?.messages?.quest_name ?? this.id;
	}

	get applicationId(): string {
		return this.config.application.id;
	}

	get applicationName(): string {
		return this.config.application.name;
	}

	/** Task map of the quest, defaulting to an empty object when absent. */
	get tasks(): Partial<Record<QuestTaskConfigType, QuestTask>> {
		return this.config.task_config_v2?.tasks ?? {};
	}

	get rewards(): QuestReward[] {
		return this.config.rewards_config?.rewards ?? [];
	}

	/** ISO timestamp the quest expires at. */
	get expiresAt(): string {
		return this.config.expires_at;
	}

	/**
	 * Whether the quest requires the Android client profile. Video quests that
	 * only offer the mobile variant must enroll and progress as Android.
	 */
	isAndroidProfile(): boolean {
		return Boolean(this.tasks.WATCH_VIDEO_ON_MOBILE) && !this.tasks.WATCH_VIDEO;
	}

	isExpired(reference: Date = new Date()): boolean {
		const expiresAt = Time.parse(this.config.expires_at);
		if (!expiresAt) {
			return false;
		}
		return reference.getTime() > expiresAt.getTime();
	}

	isCompleted(): boolean {
		return Boolean(this.userStatus?.completed_at);
	}

	isEnrolledQuest(): boolean {
		return Boolean(this.userStatus?.enrolled_at);
	}

	hasClaimedRewards(): boolean {
		return Boolean(this.userStatus?.claimed_at);
	}

	/** The first supported task found on the quest, if any. */
	primaryTask(): QuestTask | null {
		const tasks = this.tasks;
		for (const candidate of SUPPORTED_TASK_ORDER) {
			const task = tasks[candidate];
			if (task) {
				return { ...task, type: task.type ?? candidate };
			}
		}
		return null;
	}

	/** Event name of the primary task, used to look up progress values. */
	taskType(): QuestTaskConfigType | null {
		const tasks = this.tasks;
		for (const candidate of SUPPORTED_TASK_ORDER) {
			if (tasks[candidate]) {
				return candidate;
			}
		}
		return null;
	}

	/** Current progress value reported for a task. */
	taskProgress(taskName: string): number {
		const value = this.userStatus?.progress?.[taskName]?.value;
		return typeof value === 'number' ? value : 0;
	}

	/** Task completion percentage, clamped to `[0, 100]`. */
	completionRatio(taskName: string, target: number): number {
		return Time.percent(this.taskProgress(taskName), target);
	}

	/** Seconds until the quest expires; negative once it has expired. */
	secondsRemaining(reference: Date = new Date()): number {
		const expiresAt = Time.parse(this.config.expires_at);
		if (!expiresAt) {
			return Number.POSITIVE_INFINITY;
		}
		return (expiresAt.getTime() - reference.getTime()) / Time.Second;
	}

	/** Primary reward name, falling back to a generic label. */
	rewardLabel(): string {
		const reward = this.rewards[0];
		return reward?.messages?.name ?? 'reward';
	}

	/** Platform id used by `POST /quests/{id}/claim-reward`. */
	redeemPlatform(): number | null {
		const platforms = this.config.rewards_config?.platforms;
		if (!platforms || platforms.length === 0) {
			return null;
		}
		return platforms[0];
	}

	updateUserStatus(userStatus: QuestUserStatus | null): void {
		this.data.user_status = userStatus;
	}

	/** Safe one-line description used in debug logs. */
	toString(): string {
		return `Quest(${this.id}, ${this.name}, task=${this.taskType() ?? 'none'})`;
	}
}
