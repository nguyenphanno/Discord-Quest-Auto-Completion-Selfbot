import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeRunReport } from '../../../src/reporting/file-report';
import { RewardStore } from '../../../src/persistence/reward-store';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import type { QuestRunResult } from '../../../src/quests/model/types';

const RESULTS: QuestRunResult[] = [
	{
		questId: 'q-1',
		questName: 'Quest One',
		task: QuestTaskConfigType.WATCH_VIDEO,
		outcome: 'completed',
		detail: 'task finished',
	},
	{
		questId: 'q-2',
		questName: 'Quest Two',
		task: QuestTaskConfigType.STREAM_ON_DESKTOP,
		outcome: 'skipped',
		detail: 'stream unsupported',
		errorCode: 'UNSUPPORTED_TASK',
	},
];

describe('writeRunReport', () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quest-report-'));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('creates the directory and returns the file path', async () => {
		const path = await writeRunReport(join(directory, 'reports'), {
			startedAt: '2026-01-01T10:00:00.000Z',
			finishedAt: '2026-01-01T10:05:30.000Z',
			results: RESULTS,
		});
		expect(path).toBe(join(directory, 'reports', 'run-20260101-100530.json'));
	});

	it('writes every result to disk', async () => {
		const path = await writeRunReport(directory, {
			startedAt: '2026-01-01T10:00:00.000Z',
			finishedAt: '2026-01-01T10:05:30.000Z',
			results: RESULTS,
		});
		const written = JSON.parse(await readFile(path, 'utf8')) as {
			results: QuestRunResult[];
		};
		expect(written.results).toHaveLength(2);
		expect(written.results[1]?.errorCode).toBe('UNSUPPORTED_TASK');
	});

	it('writes an empty report without failing', async () => {
		const path = await writeRunReport(directory, {
			startedAt: '2026-01-01T10:00:00.000Z',
			finishedAt: '2026-01-01T10:00:00.000Z',
			results: [],
		});
		expect((JSON.parse(await readFile(path, 'utf8')) as { results: unknown[] }).results).toEqual([]);
	});
});

describe('RewardStore', () => {
	let directory: string;
	let path: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quest-rewards-'));
		path = join(directory, 'rewards.json');
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('returns nothing when no code was ever stored', () => {
		expect(new RewardStore(path).all()).toEqual([]);
	});

	it('round-trips a stored code', () => {
		const store = new RewardStore(path);
		store.record('q-1', 'CODE-ABC', 'sku-1');
		const entries = store.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ questId: 'q-1', code: 'CODE-ABC', skuId: 'sku-1' });
		expect(entries[0]?.savedAt).toBeTruthy();
	});

	it('keeps codes of different quests apart', () => {
		const store = new RewardStore(path);
		store.record('q-1', 'CODE-A', 'sku-1');
		store.record('q-2', 'CODE-B', 'sku-2');
		expect(store.all().map((entry) => entry.questId)).toEqual(['q-1', 'q-2']);
	});

	it('replaces a re-issued code instead of duplicating it', () => {
		const store = new RewardStore(path);
		store.record('q-1', 'CODE-A', 'sku-1');
		store.record('q-1', 'CODE-A', 'sku-1');
		expect(store.all()).toHaveLength(1);
	});

	it('survives a corrupt store file', async () => {
		await writeFile(path, 'nope', 'utf8');
		expect(new RewardStore(path).all()).toEqual([]);
	});
});
