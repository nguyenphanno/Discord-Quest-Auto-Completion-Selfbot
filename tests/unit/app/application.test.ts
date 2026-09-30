import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestBotApplication } from '../../../src/app/application';
import { ExitCode } from '../../../src/app/lifecycle';
import { loadConfig } from '../../../src/config/load';
import type { QuestBotConfig } from '../../../src/config/schema';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import type { AllQuestsResponse } from '../../../src/quests/model/types';
import {
	createFakeClient,
	postedRoutes,
	type FakeClient,
	type FakeClientOptions,
} from '../../fixtures/fake-client';
import { questPayload, userStatus } from '../../fixtures/quest-builder';

/** Captures everything the application writes to stdout while `body` runs. */
async function captureStdout<T>(body: () => Promise<T>): Promise<{ value: T; output: string }> {
	const written: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string) => {
		written.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		const value = await body();
		return { value, output: written.join('') };
	} finally {
		process.stdout.write = original;
	}
}

/**
 * Replaces the `ClientQuest` export for the duration of `body`.
 *
 * `vi.mock` is hoisted per module graph, so the replacement is installed through
 * a mutable holder: the factory returns a constructor-like function that always
 * hands back the client the test registered.
 */
let currentClient: FakeClient = createFakeClient();

vi.mock('../../../src/discord/client', async () => {
	const actual = await vi.importActual<typeof import('../../../src/discord/client')>(
		'../../../src/discord/client',
	);
	return {
		...actual,
		ClientQuest: function MockClientQuest(): FakeClient {
			return currentClient;
		},
	};
});

async function withFakeClient<T>(
	options: FakeClientOptions,
	body: (client: FakeClient) => Promise<T>,
): Promise<T> {
	currentClient = createFakeClient(options);
	return await body(currentClient);
}

const VIDEO_BOARD: AllQuestsResponse = {
	quests: [
		{
			...questPayload({ id: 'q-1' }),
			config: {
				...questPayload({ id: 'q-1' }).config,
				task_config_v2: {
					tasks: {
						WATCH_VIDEO: {
							event_name: 'WATCH_VIDEO',
							target: 20,
							type: QuestTaskConfigType.WATCH_VIDEO,
						},
					},
					join_operator: 'or',
				},
			},
		},
	],
	excluded_quests: [],
	quest_enrollment_blocked_until: null,
};

const COMPLETED_BOARD: AllQuestsResponse = {
	quests: [
		{
			...questPayload({ id: 'q-2' }),
			user_status: userStatus({ completed_at: '2026-01-01T00:10:00.000Z' }),
		},
	],
	excluded_quests: [],
	quest_enrollment_blocked_until: null,
};

describe('QuestBotApplication', () => {
	let directory: string;
	let config: QuestBotConfig;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'quest-app-'));
		config = loadConfig({
			TOKEN: 'aaa.bbb.ccc',
			CACHE_DIR: directory,
			REPORT_DIR: join(directory, 'reports'),
			LOG_LEVEL: 'silent',
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(directory, { recursive: true, force: true });
	});

	it('prints the CANNOT START panel and exits 1 for an empty token', async () => {
		const { value } = await captureStdout(() =>
			new QuestBotApplication({ ...config, token: '' }).run('start'),
		);
		expect(value).toBe(ExitCode.Failure);
	});

	it('never throws a stack for a missing token', async () => {
		const { value } = await captureStdout(async () =>
			new QuestBotApplication({ ...config, token: '' }).run('start'),
		);
		expect(value).toBe(ExitCode.Failure);
	});

	it('reads the cache and exits 0 for status, without a token', async () => {
		const { value, output } = await captureStdout(() =>
			new QuestBotApplication({ ...config, token: '' }).run('status'),
		);
		expect(value).toBe(ExitCode.Success);
		expect(output).toContain('Known quests');
	});

	it('exits 1 for a config error such as an unparseable proxy url', async () => {
		const { value } = await captureStdout(() =>
			new QuestBotApplication({ ...config, proxyUrl: 'not-a-url' }).run('start'),
		);
		expect(value).toBe(ExitCode.Failure);
	});

	it('lists the board without driving any quest', async () => {
		await withFakeClient({ board: VIDEO_BOARD }, async (client) => {
			const { value, output } = await captureStdout(() => new QuestBotApplication(config).run('list'));
			expect(value).toBe(ExitCode.Success);
			expect(output).toContain('tester');
			expect(postedRoutes(client)).toEqual([]);
		});
	});

	it('reports a gateway failure and exits 1', async () => {
		await withFakeClient({ connectError: new Error('gateway unreachable') }, async () => {
			const { value } = await captureStdout(() => new QuestBotApplication(config).run('start'));
			expect(value).toBe(ExitCode.Failure);
		});
	});

	it('makes no write call during a dry run', async () => {
		await withFakeClient({ board: VIDEO_BOARD }, async (client) => {
			const { value } = await captureStdout(() =>
				new QuestBotApplication({ ...config, dryRun: true }).run('start'),
			);
			expect(value).toBe(ExitCode.Success);
			expect(postedRoutes(client)).toEqual([]);
		});
	});

	it('drives the pending quest and writes a run report', async () => {
		await withFakeClient({ board: VIDEO_BOARD }, async (client) => {
			const { value } = await captureStdout(() => new QuestBotApplication(config).run('start'));
			expect(value).toBe(ExitCode.Success);
			expect(postedRoutes(client)).toContain('/quests/q-1/enroll');
		});
		const files = await readdir(join(directory, 'reports'));
		expect(files.length).toBeGreaterThan(0);
		const report = JSON.parse(
			await readFile(join(directory, 'reports', files[0] as string), 'utf8'),
		) as { results: Array<{ questId: string }> };
		expect(report.results[0]?.questId).toBe('q-1');
	});

	it('leaves an already completed quest alone', async () => {
		await withFakeClient({ board: COMPLETED_BOARD }, async (client) => {
			await captureStdout(() => new QuestBotApplication(config).run('start'));
			expect(postedRoutes(client)).toEqual([]);
		});
	});

	it('claims a completed reward through redeem', async () => {
		await withFakeClient({ board: COMPLETED_BOARD }, async (client) => {
			const { value } = await captureStdout(() => new QuestBotApplication(config).run('redeem'));
			expect(value).toBe(ExitCode.Success);
			expect(postedRoutes(client)).toEqual(['/quests/q-2/claim-reward']);
		});
	});

	it('exits 1 when a reward claim fails', async () => {
		await withFakeClient(
			{ board: COMPLETED_BOARD, claimError: new Error('claim rejected') },
			async () => {
				const { value } = await captureStdout(() =>
					new QuestBotApplication(config).run('redeem'),
				);
				expect(value).toBe(ExitCode.Failure);
			},
		);
	});

	it('stores a reward code without printing it', async () => {
		await withFakeClient(
			{
				board: COMPLETED_BOARD,
				claimResponse: {
					user_id: '1',
					quest_id: 'q-2',
					claimed_at: '2026-01-01T00:11:00.000Z',
					reward_code: { code: 'SECRET-CODE', sku_id: 'sku-2' },
				},
			},
			async () => {
				const { output } = await captureStdout(() => new QuestBotApplication(config).run('redeem'));
				expect(output).not.toContain('SECRET-CODE');
			},
		);
		const store = JSON.parse(await readFile(join(directory, 'rewards.json'), 'utf8')) as Array<{
			code: string;
		}>;
		expect(store[0]?.code).toBe('SECRET-CODE');
	});

	it('rejects watch mode when the poll interval is zero', async () => {
		await withFakeClient({ board: VIDEO_BOARD }, async () => {
			const { value } = await captureStdout(() =>
				new QuestBotApplication({ ...config, watchPollMs: 0 }).run('watch'),
			);
			expect(value).toBe(ExitCode.Usage);
		});
	});
});


