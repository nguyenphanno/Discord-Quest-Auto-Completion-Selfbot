import type { QuestApi } from '../api/quest-api';
import type { Quest } from '../model/quest';
import type { QuestTaskConfigType } from '../model/types';
import type { Logger } from '../../ui/logger';

export interface HandlerClock {
	now(): number;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface HandlerContext {
	quest: Quest;
	taskType: QuestTaskConfigType;
	api: QuestApi;
	signal: AbortSignal;
	log: Logger;
	clock: HandlerClock;
	setQuest(next: Quest): void;
}

export interface TaskHandler {
	readonly types: readonly QuestTaskConfigType[];
	canHandle(quest: Quest): boolean;
	run(context: HandlerContext): Promise<void>;
	/** Used by the engine to stop before enrollment. */
	readonly unsupportedDetail?: string;
}
