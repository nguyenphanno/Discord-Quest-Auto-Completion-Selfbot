import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QuestCache } from '../../../src/persistence/quest-cache';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import type { QuestRunResult } from '../../../src/quests/model/types';

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

describe('QuestCache', () => {
	let directory: string;
	let cache: QuestCache;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quest-cache-'));
		cache = new QuestCache(directory);
		await cache.load();
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('treats every quest as new on a fresh cache', () => {
		expect(cache.isNew('q-1')).toBe(true);
		expect(cache.isSettled('q-1')).toBe(false);
	});

	it('records an outcome and counts the run', async () => {
		cache.recordResult(result());
		await cache.save();
		const stats = cache.stats();
		expect(stats.known).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.runs).toBe(1);
	});

	it('counts the run only once no matter how often it saves', async () => {
		await cache.save();
		await cache.save();
		expect(cache.stats().runs).toBe(1);
	});

	it('is settled only once completed and claimed', () => {
		cache.recordResult(result());
		expect(cache.isSettled('q-1')).toBe(false);
		cache.markClaimed('q-1', 'Quest One');
		expect(cache.isSettled('q-1')).toBe(true);
	});

	it('creates an entry for a quest claimed outside the run', () => {
		cache.markClaimed('q-9', 'Legacy');
		expect(cache.isSettled('q-9')).toBe(true);
		expect(cache.isNew('q-9')).toBe(false);
	});

	it('keeps the first-seen timestamp across runs', async () => {
		cache.recordResult(result());
		await cache.save();
		const stored = JSON.parse(await readFile(join(directory, 'quests.json'), 'utf8')) as {
			entries: Record<string, { firstSeenAt: string; runs: number }>;
		};
		expect(stored.entries['q-1']?.firstSeenAt).toBeTruthy();
		cache.recordResult(result({ outcome: 'failed' }));
		expect(cache.stats().known).toBe(1);
	});

	it('round-trips through disk', async () => {
		cache.recordResult(result());
		cache.markClaimed('q-1');
		await cache.save();

		const reloaded = new QuestCache(directory);
		await reloaded.load();
		expect(reloaded.isSettled('q-1')).toBe(true);
		expect(reloaded.stats().updatedAt).not.toBeNull();
	});

	it('ignores a cache written by an older format', async () => {
		await writeFile(
			join(directory, 'quests.json'),
			JSON.stringify({ version: 99, entries: { 'q-1': {} } }),
			'utf8',
		);
		const reloaded = new QuestCache(directory);
		await reloaded.load();
		expect(reloaded.isNew('q-1')).toBe(true);
	});

	it('survives a corrupt cache file', async () => {
		await writeFile(join(directory, 'quests.json'), 'not json at all', 'utf8');
		const reloaded = new QuestCache(directory);
		await expect(reloaded.load()).resolves.toBeUndefined();
		expect(reloaded.stats().known).toBe(0);
	});

	it('writes nothing to disk when disabled', async () => {
		const disabled = new QuestCache(directory, false);
		await disabled.load();
		disabled.recordResult(result());
		await disabled.save();
		await expect(readFile(join(directory, 'quests.json'), 'utf8')).rejects.toThrow();
		expect(disabled.stats().updatedAt).toBeNull();
	});

	it('lists the quests seen for the first time', () => {
		cache.recordResult(result({ questId: 'q-known' }));
		const fresh = [result({ questId: 'q-fresh', questName: 'Fresh' })];
		expect(cache.newQuests(fresh).map((entry) => entry.questId)).toEqual(['q-fresh']);
	});
});
