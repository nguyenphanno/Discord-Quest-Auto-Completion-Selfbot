import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enrollBudgetFor, shouldSkipSettled } from '../../../src/quests/engine/enroll-budget';
import { EnrollCooldownStore } from '../../../src/persistence/enroll-cooldown';
import { QuestCache } from '../../../src/persistence/quest-cache';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import type { QuestRunResult } from '../../../src/quests/model/types';

const WINDOW_MS = 45 * 60 * 1000;
const ACCOUNT = 'account-1';

function result(overrides: Partial<QuestRunResult> = {}): QuestRunResult {
	return {
		questId: 'q-1',
		questName: 'Quest One',
		task: QuestTaskConfigType.WATCH_VIDEO,
		outcome: 'completed',
		detail: 'task finished',
		...overrides,
	};
}

describe('EnrollCooldownStore', () => {
	let directory: string;
	let path: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quest-cooldown-'));
		path = join(directory, 'cooldown.json');
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('returns null when nothing was ever recorded', () => {
		expect(new EnrollCooldownStore(path).lastEnrollAt(ACCOUNT)).toBeNull();
	});

	it('round-trips a recorded enrollment', () => {
		const store = new EnrollCooldownStore(path);
		store.recordEnroll(ACCOUNT, new Date('2026-01-01T00:00:00.000Z'));
		expect(store.lastEnrollAt(ACCOUNT)?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
	});

	it('keeps separate accounts apart', () => {
		const store = new EnrollCooldownStore(path);
		store.recordEnroll(ACCOUNT, new Date('2026-01-01T00:00:00.000Z'));
		expect(store.lastEnrollAt('other')).toBeNull();
	});

	it('blocks a second enrollment inside the window', () => {
		const store = new EnrollCooldownStore(path);
		store.recordEnroll(ACCOUNT, new Date('2026-01-01T00:00:00.000Z'));
		expect(store.isBlocked(ACCOUNT, new Date('2026-01-01T00:10:00.000Z'), WINDOW_MS)).toBe(true);
	});

	it('allows enrollment once the window elapsed', () => {
		const store = new EnrollCooldownStore(path);
		store.recordEnroll(ACCOUNT, new Date('2026-01-01T00:00:00.000Z'));
		expect(store.isBlocked(ACCOUNT, new Date('2026-01-01T01:00:00.000Z'), WINDOW_MS)).toBe(false);
	});

	it('treats a corrupt file as no enrollment', async () => {
		await writeFile(path, '{not json', 'utf8');
		const store = new EnrollCooldownStore(path);
		expect(store.lastEnrollAt(ACCOUNT)).toBeNull();
		expect(store.isBlocked(ACCOUNT, new Date(), WINDOW_MS)).toBe(false);
	});

	it('ignores a stored value that is not a date', async () => {
		await writeFile(path, JSON.stringify({ [ACCOUNT]: 'never' }), 'utf8');
		expect(new EnrollCooldownStore(path).lastEnrollAt(ACCOUNT)).toBeNull();
	});
});

describe('enrollBudgetFor', () => {
	it('disables the gate when the window is zero', () => {
		expect(enrollBudgetFor(new EnrollCooldownStore('unused.json'), ACCOUNT, 0)).toBeNull();
	});

	it('delegates isBlocked and record to the store', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'quest-budget-'));
		try {
			const store = new EnrollCooldownStore(join(directory, 'cooldown.json'));
			const budget = enrollBudgetFor(store, ACCOUNT, WINDOW_MS);
			expect(budget?.isBlocked(new Date())).toBe(false);
			budget?.record(new Date('2026-01-01T00:00:00.000Z'));
			expect(budget?.isBlocked(new Date('2026-01-01T00:01:00.000Z'))).toBe(true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe('shouldSkipSettled', () => {
	it('never skips while the option is off', () => {
		const cache = new QuestCache('unused');
		cache.recordResult(result());
		cache.markClaimed('q-1');
		expect(shouldSkipSettled(cache, 'q-1', false)).toBe(false);
	});

	it('skips a settled quest when the option is on', () => {
		const cache = new QuestCache('unused');
		cache.recordResult(result());
		cache.markClaimed('q-1');
		expect(shouldSkipSettled(cache, 'q-1', true)).toBe(true);
	});

	it('keeps an unsettled quest in the run', () => {
		const cache = new QuestCache('unused');
		cache.recordResult(result());
		expect(shouldSkipSettled(cache, 'q-1', true)).toBe(false);
	});
});
