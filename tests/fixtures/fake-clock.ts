/**
 * @file Virtual clock for handler and engine tests.
 *
 * `sleep` advances virtual time instead of waiting, so a video loop that would
 * take minutes of wall clock finishes instantly. The start instant matches
 * `ENROLLED_AT` so `enrolled_at` arithmetic in the handlers is exact.
 */

import type { Quest } from '../../src/quests/model/quest';
import type { QuestTaskConfigType } from '../../src/quests/model/types';
import type { QuestApi } from '../../src/quests/api/quest-api';
import type { HandlerClock, HandlerContext } from '../../src/quests/handlers/types';
import { Logger } from '../../src/ui/logger';
import { ENROLLED_AT } from './quest-builder';

/** Milliseconds represented by `ENROLLED_AT`. */
export const CLOCK_START_MS = new Date(ENROLLED_AT).getTime();

export interface FakeClock extends HandlerClock {
	/** Moves virtual time forward without sleeping. */
	advance(ms: number): void;
	/** Current virtual instant as an ISO string. */
	iso(): string;
}

/** Clock whose `sleep` moves virtual time instead of waiting. */
export function createFakeClock(startMs: number = CLOCK_START_MS): FakeClock {
	let current = startMs;
	return {
		now: (): number => current,
		sleep: async (ms: number): Promise<void> => {
			current += Math.max(0, ms);
		},
		advance: (ms: number): void => {
			current += ms;
		},
		iso: (): string => new Date(current).toISOString(),
	};
}

/** Handle on a handler context plus a reader for the quest it mutated. */
export interface TestHandlerContext {
	ctx: HandlerContext;
	current(): Quest;
}

export function createHandlerContext(options: {
	quest: Quest;
	api: QuestApi;
	taskType: QuestTaskConfigType;
	clock: FakeClock;
	signal?: AbortSignal;
}): TestHandlerContext {
	let quest = options.quest;
	const ctx: HandlerContext = {
		quest,
		taskType: options.taskType,
		api: options.api,
		signal: options.signal ?? new AbortController().signal,
		log: new Logger('test'),
		clock: options.clock,
		setQuest: (next) => {
			quest = next;
		},
	};
	return { ctx, current: () => quest };
}
