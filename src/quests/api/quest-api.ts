import type {
	AllQuestsResponse,
	ClaimedQuest,
	Quest as QuestShape,
	QuestUserStatus,
} from '../model/types';
import type { Quest } from '../model/quest';

/** Port used by the quest engine. It is deliberately small enough to fake in tests. */
export interface QuestApi {
	fetchBoard(includeExcluded: boolean): Promise<AllQuestsResponse>;
	fetchQuest(questId: string): Promise<QuestShape['config']>;
	enroll(quest: Quest, profile: 'desktop' | 'android'): Promise<QuestUserStatus>;
	postVideoProgress(questId: string, timestamp: number): Promise<QuestUserStatus>;
	postHeartbeat(questId: string, body: Record<string, unknown>): Promise<QuestUserStatus>;
	/** The claim route answers with the claimed reward, including its code. */
	claimReward(quest: Quest, captchaHeaders?: Record<string, string>): Promise<ClaimedQuest>;
}
