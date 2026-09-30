import { beforeEach, describe, expect, it } from 'vitest';

import { QuestEngine } from '../../../src/quests/engine/quest-engine';
import type { EnrollBudget } from '../../../src/quests/engine/enroll-budget';
import { defaultRegistry } from '../../../src/quests/handlers/default-registry';
import { TaskHandlerRegistry } from '../../../src/quests/handlers/registry';
import type { TaskHandler } from '../../../src/quests/handlers/types';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import { FakeQuestApi } from '../../fixtures/fake-quest-api';
import { createFakeClock } from '../../fixtures/fake-clock';
import { LONG_PAST, quest, userStatus } from '../../fixtures/quest-builder';

/** A real, never-aborted signal: handlers call `addEventListener` on it. */
function liveSignal(): AbortSignal {
	return new AbortController().signal;
}

function engineWith(
	api: FakeQuestApi,
	options: {
		dryRun?: boolean;
		clock?: ReturnType<typeof createFakeClock>;
		budget?: EnrollBudget | null;
	} = {},
) {
	const dryRun = options.dryRun ?? false;
	return new QuestEngine(api, defaultRegistry(), {
		concurrency: 1,
		dryRun,
		workerStaggerMs: 0,
		// A live run always gets the virtual clock: a real clock would make the
		// video and heartbeat loops wait minutes of wall time.
		clock: options.clock ?? createFakeClock(),
		enrollBudget: options.budget ?? null,
	});
}

/** Quest waiting to be enrolled, with a pending video task. */
const videoQuest = (id = 'q-video', target = 20) =>
	quest({ id, tasks: { [QuestTaskConfigType.WATCH_VIDEO]: target } });

/** Same quest, already enrolled by an earlier run. */
const enrolledVideoQuest = (id = 'q-video', target = 20) =>
	quest({ id, tasks: { [QuestTaskConfigType.WATCH_VIDEO]: target }, userStatus: userStatus() });

/** Handler that always throws, used to exercise the engine failure path. */
function failingHandler(): TaskHandler {
	return {
		types: [QuestTaskConfigType.WATCH_VIDEO],
		canHandle: () => true,
		run: async () => {
			throw new Error('video endpoint exploded');
		},
	};
}

describe('QuestEngine', () => {
	let api: FakeQuestApi;

	beforeEach(() => {
		api = new FakeQuestApi();
	});

	it('makes no API call at all during a dry run', async () => {
		const results = await engineWith(api, { dryRun: true }).run([videoQuest()], liveSignal());
		expect(api.calls).toEqual([]);
		expect(results[0]?.outcome).toBe('skipped');
		expect(results[0]?.detail).toContain('enrol (Desktop)');
	});

	it('enrolls, drives and reports completion for a video quest', async () => {
		const results = await engineWith(api, { clock: createFakeClock() }).run([videoQuest()], liveSignal());
		expect(api.enrolledIds).toEqual(['q-video']);
		expect(results[0]?.outcome).toBe('completed');
		expect(results[0]?.task).toBe(QuestTaskConfigType.WATCH_VIDEO);
	});

	it('enrolls mobile-only video quests as the android profile', async () => {
		const mobile = quest({
			id: 'q-mobile',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE]: 20 },
		});
		const results = await engineWith(api).run([mobile], liveSignal());
		expect(api.enrolledIds).toEqual(['q-mobile']);
		expect(results[0]?.outcome).toBe('completed');
	});

	it('does not re-enroll a quest that is already enrolled', async () => {
		const results = await engineWith(api).run([enrolledVideoQuest()], liveSignal());
		expect(api.enrolledIds).toEqual([]);
		expect(results[0]?.outcome).toBe('completed');
	});

	it('skips STREAM_ON_DESKTOP before enrolling', async () => {
		const stream = quest({
			id: 'q-stream',
			tasks: { [QuestTaskConfigType.STREAM_ON_DESKTOP]: 600 },
		});
		const results = await engineWith(api).run([stream], liveSignal());
		expect(results[0]?.outcome).toBe('skipped');
		expect(results[0]?.detail).toBe('stream unsupported');
		expect(results[0]?.errorCode).toBe('UNSUPPORTED_TASK');
		expect(api.calls).toEqual([]);
	});

	it('skips ACHIEVEMENT_IN_GAME as an unsupported task', async () => {
		const inGame = quest({
			id: 'q-in-game',
			tasks: { [QuestTaskConfigType.ACHIEVEMENT_IN_GAME]: 5 },
		});
		const results = await engineWith(api).run([inGame], liveSignal());
		expect(results[0]?.detail).toBe('unsupported task');
		expect(api.calls).toEqual([]);
	});

	it('skips expired quests', async () => {
		const expired = quest({
			id: 'q-expired',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 },
			expiresAt: LONG_PAST,
		});
		const results = await engineWith(api).run([expired], liveSignal());
		expect(results[0]).toMatchObject({ outcome: 'skipped', detail: 'expired' });
		expect(api.calls).toEqual([]);
	});

	it('reports completed quests without touching them', async () => {
		const done = quest({
			id: 'q-done',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 },
			userStatus: userStatus({ completed_at: '2026-01-02T00:00:00.000Z' }),
		});
		const results = await engineWith(api).run([done], liveSignal());
		expect(results[0]?.outcome).toBe('already-complete');
		expect(api.calls).toEqual([]);
	});

	it('skips quests without any supported task', async () => {
		const results = await engineWith(api).run([quest({ id: 'q-bare' })], liveSignal());
		expect(results[0]).toMatchObject({
			outcome: 'skipped',
			task: 'UNKNOWN',
			errorCode: 'UNSUPPORTED_TASK',
		});
	});

	it('respects the enrollment cooldown for unenrolled quests', async () => {
		const budget: EnrollBudget = { isBlocked: () => true, record: () => undefined };
		const results = await engineWith(api, { budget }).run([videoQuest()], liveSignal());
		expect(results[0]).toMatchObject({
			outcome: 'skipped',
			detail: 'enrollment cooldown',
			errorCode: 'ENROLL_COOLDOWN',
		});
		expect(api.calls).toEqual([]);
	});

	it('still runs an already enrolled quest while the cooldown is active', async () => {
		const budget: EnrollBudget = { isBlocked: () => true, record: () => undefined };
		const results = await engineWith(api, { budget }).run([enrolledVideoQuest()], liveSignal());
		expect(results[0]?.outcome).toBe('completed');
	});

	it('records a new enrollment in the budget', async () => {
		const recorded: Date[] = [];
		const budget: EnrollBudget = {
			isBlocked: () => false,
			record: (now) => recorded.push(now),
		};
		await engineWith(api, { budget }).run([videoQuest()], liveSignal());
		expect(recorded).toHaveLength(1);
	});

	it('drives every advertised task when join_operator is and', async () => {
		const both = quest({
			id: 'q-both',
			tasks: {
				[QuestTaskConfigType.WATCH_VIDEO]: 20,
				[QuestTaskConfigType.PLAY_ON_DESKTOP]: 30,
			},
			joinOperator: 'and',
		});
		const results = await engineWith(api, { clock: createFakeClock() }).run([both], liveSignal());
		expect(results[0]?.outcome).toBe('completed');
		expect(api.timestamps.length).toBeGreaterThan(0);
		expect(api.calls).toContain('heartbeat');
	});

	it('drives only the highest priority task when join_operator is or', async () => {
		const both = quest({
			id: 'q-or',
			tasks: {
				[QuestTaskConfigType.WATCH_VIDEO]: 20,
				[QuestTaskConfigType.PLAY_ON_DESKTOP]: 30,
			},
			joinOperator: 'or',
		});
		await engineWith(api, { clock: createFakeClock() }).run([both], liveSignal());
		expect(api.timestamps.length).toBeGreaterThan(0);
		expect(api.calls.filter((call) => call.startsWith('heartbeat'))).toHaveLength(0);
	});

	it('returns one result per quest, in input order', async () => {
		const quests = [
			quest({ id: 'q-1', tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 }, userStatus: userStatus() }),
			quest({ id: 'q-2', expiresAt: LONG_PAST, tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 } }),
		];
		const results = await engineWith(api, { clock: createFakeClock() }).run(quests, liveSignal());
		expect(results.map((result) => result.questId)).toEqual(['q-1', 'q-2']);
	});

	it('skips everything when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const results = await engineWith(api).run([videoQuest()], controller.signal);
		expect(results[0]).toMatchObject({ outcome: 'skipped', errorCode: 'ABORTED' });
		expect(api.calls).toEqual([]);
	});

	it('reports a handler failure without losing the other quests', async () => {
		const engine = new QuestEngine(api, new TaskHandlerRegistry([failingHandler()]), {
			concurrency: 1,
			dryRun: false,
			workerStaggerMs: 0,
		});
		const results = await engine.run([videoQuest()], liveSignal());
		expect(results[0]).toMatchObject({
			outcome: 'failed',
			detail: 'video endpoint exploded',
		});
	});

	it('reports an abort raised inside a handler as skipped', async () => {
		const aborting: TaskHandler = {
			types: [QuestTaskConfigType.WATCH_VIDEO],
			canHandle: () => true,
			run: async () => {
				throw new Error('Sleep aborted');
			},
		};
		const engine = new QuestEngine(api, new TaskHandlerRegistry([aborting]), {
			concurrency: 1,
			dryRun: false,
			workerStaggerMs: 0,
		});
		const results = await engine.run([videoQuest()], liveSignal());
		expect(results[0]).toMatchObject({ outcome: 'skipped', detail: 'aborted' });
	});
});
