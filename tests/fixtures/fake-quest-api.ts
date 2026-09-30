/**
 * @file In-memory `QuestApi` double.
 *
 * Records every call so a test can assert that a dry run makes none, and lets a
 * test script the status each video tick or heartbeat returns.
 */

import type { QuestApi } from '../../src/quests/api/quest-api';
import type { Quest } from '../../src/quests/model/quest';
import type { AllQuestsResponse, ClaimedQuest, QuestUserStatus } from '../../src/quests/model/types';
import { taskProgress, userStatus } from './quest-builder';

const COMPLETED_AT = '2026-01-01T00:10:00.000Z';
const CLAIMED_AT = '2026-01-01T00:11:00.000Z';

export interface FakeQuestApiOptions {
	/** Status returned by each `postVideoProgress` call, in order. */
	videoStates?: QuestUserStatus[];
	/** Status returned by each `postHeartbeat` call, in order. */
	heartbeatStates?: QuestUserStatus[];
	/** Status returned by `claimReward` for the `claimed_at` mirror. */
	claimState?: QuestUserStatus;
	/** When set, `fetchBoard` rejects with this error. */
	boardError?: Error;
}

export class FakeQuestApi implements QuestApi {
	readonly calls: string[] = [];
	readonly timestamps: number[] = [];
	readonly enrolledIds: string[] = [];

	private videoIndex = 0;
	private heartbeatIndex = 0;

	constructor(private readonly options: FakeQuestApiOptions = {}) {}

	async fetchBoard(): Promise<AllQuestsResponse> {
		this.calls.push('fetchBoard');
		if (this.options.boardError) {
			throw this.options.boardError;
		}
		return { quests: [], excluded_quests: [], quest_enrollment_blocked_until: null };
	}

	async fetchQuest(questId: string): Promise<never> {
		this.calls.push(`fetchQuest:${questId}`);
		throw new Error('fetchQuest is not used by the engine');
	}

	async enroll(quest: Quest): Promise<QuestUserStatus> {
		this.calls.push('enroll');
		this.enrolledIds.push(quest.id);
		return userStatus();
	}

	async postVideoProgress(_questId: string, timestamp: number): Promise<QuestUserStatus> {
		this.calls.push(`video:${timestamp}`);
		this.timestamps.push(timestamp);
		const scripted = this.options.videoStates;
		const state = scripted?.[this.videoIndex] ?? scripted?.[scripted.length - 1];
		this.videoIndex += 1;
		return state ?? userStatus({ progress: taskProgress('WATCH_VIDEO', timestamp) });
	}

	async postHeartbeat(_questId: string, body: Record<string, unknown>): Promise<QuestUserStatus> {
		this.calls.push(body['terminal'] ? 'heartbeat:terminal' : 'heartbeat');
		const scripted = this.options.heartbeatStates;
		const state = scripted?.[this.heartbeatIndex] ?? scripted?.[scripted.length - 1];
		this.heartbeatIndex += 1;
		return state ?? userStatus({ completed_at: COMPLETED_AT });
	}

	async claimReward(quest: Quest): Promise<ClaimedQuest> {
		this.calls.push('claim');
		const claimState = this.options.claimState;
		return {
			user_id: '1',
			quest_id: quest.id,
			claimed_at: claimState?.claimed_at ?? CLAIMED_AT,
			reward_code: null,
		};
	}

	get videoCallCount(): number {
		return this.timestamps.length;
	}
}
