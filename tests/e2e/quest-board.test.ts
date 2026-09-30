/**
 * @file End-to-end quest run against a recorded `GET /quests/@me` board.
 *
 * The fixture is a redacted copy of a real response: no token, no sealed
 * metadata. It exercises the whole offline path - board -> filters -> engine ->
 * handlers - without ever touching the network, which is what CI runs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyQuestFilters, boardStats } from '../../src/quests/engine/filters';
import { QuestEngine } from '../../src/quests/engine/quest-engine';
import { defaultRegistry } from '../../src/quests/handlers/default-registry';
import { Quest } from '../../src/quests/model/quest';
import type { AllQuestsResponse } from '../../src/quests/model/types';
import { createFakeClock } from '../fixtures/fake-clock';
import { FakeQuestApi } from '../fixtures/fake-quest-api';

const FIXTURE = join(__dirname, '..', 'fixtures', 'quests', 'at-me.json');

function loadBoard(): AllQuestsResponse {
	return JSON.parse(readFileSync(FIXTURE, 'utf8')) as AllQuestsResponse;
}

function engineFor(api: FakeQuestApi, dryRun: boolean) {
	return new QuestEngine(api, defaultRegistry(), {
		concurrency: 2,
		dryRun,
		workerStaggerMs: 0,
		clock: createFakeClock(),
	});
}

describe('quest run against a recorded board', () => {
	it('lists the recorded quests with their derived state', () => {
		const quests = loadBoard().quests.map((shape) => Quest.create(shape));
		expect(quests).toHaveLength(2);
		expect(quests[0]?.name).toBe('Watch a video');
		expect(quests[0]?.isEnrolledQuest()).toBe(false);
		expect(quests[1]?.isCompleted()).toBe(true);
	});

	it('summarises the board without a network call', () => {
		const quests = loadBoard().quests.map((shape) => Quest.create(shape));
		expect(boardStats(quests)).toEqual({
			total: 2,
			completed: 1,
			claimable: 1,
			expired: 0,
			pending: 1,
		});
	});

	it('prints the plan and touches nothing during a dry run', async () => {
		const quests = loadBoard().quests.map((shape) => Quest.create(shape));
		const api = new FakeQuestApi();
		const results = await engineFor(api, true).run(quests, new AbortController().signal);

		expect(api.calls).toEqual([]);
		expect(results[0]).toMatchObject({ questId: '111111111111111111', outcome: 'skipped' });
		expect(results[0]?.detail).toContain('enrol (Desktop)');
		expect(results[1]).toMatchObject({ outcome: 'already-complete' });
	});

	it('drives the pending quest and leaves the finished one alone', async () => {
		const quests = loadBoard().quests.map((shape) => Quest.create(shape));
		const api = new FakeQuestApi();
		const results = await engineFor(api, false).run(quests, new AbortController().signal);

		expect(api.enrolledIds).toEqual(['111111111111111111']);
		expect(results[0]?.outcome).toBe('completed');
		expect(results[1]?.outcome).toBe('already-complete');
	});

	it('honours the include filter on the recorded board', () => {
		const quests = loadBoard().quests.map((shape) => Quest.create(shape));
		const filtered = applyQuestFilters(quests, ['222222222222222222'], []);
		expect(filtered.map((quest) => quest.id)).toEqual(['222222222222222222']);
	});
});
