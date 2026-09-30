import { describe, expect, it, vi } from 'vitest';

import { DiscordQuestApi } from '../../../../src/quests/api/discord-quest-api';
import { Constants } from '../../../../src/discord/constants';
import { AppError } from '../../../../src/shared/errors';
import type { AllQuestsResponse } from '../../../../src/quests/model/types';
import { quest, userStatus } from '../../../fixtures/quest-builder';

interface RestCall {
	route: string;
	options: Record<string, unknown>;
}

/** Minimal `ClientQuest` double: only `rest` and the captcha facade are used here. */
function fakeClient(
	responses: Record<string, unknown> = {},
	solve?: () => Promise<unknown>,
) {
	const calls: RestCall[] = [];
	let counter = 0;
	const rest = {
		get: async (route: string, options: Record<string, unknown> = {}) => {
			calls.push({ route, options });
			return responses[`GET ${route}`] ?? responses[route] ?? {};
		},
		post: async (route: string, options: Record<string, unknown> = {}) => {
			calls.push({ route, options });
			counter += 1;
			const value =
				responses[`POST ${route} #${counter}`] ?? responses[`POST ${route}`] ?? userStatus();
			if (value instanceof Error) {
				throw value;
			}
			return value;
		},
	};
	const client = {
		rest,
		captcha: { solve: solve ?? vi.fn() },
	} as unknown as ConstructorParameters<typeof DiscordQuestApi>[0];
	return { api: new DiscordQuestApi(client), calls, rest };
}

const CAPTCHA_CHALLENGE = {
	captcha_key: ['E0:key'],
	captcha_sitekey: 'site',
	captcha_service: 'hcaptcha' as const,
	captcha_session_id: 'session',
	captcha_rqdata: 'rqdata',
	captcha_rqtoken: 'rqtoken',
};

describe('DiscordQuestApi', () => {
	it('fetches the quest board', async () => {
		const board: AllQuestsResponse = {
			quests: [],
			excluded_quests: [],
			quest_enrollment_blocked_until: null,
		};
		const { api, calls } = fakeClient({ 'GET /quests/@me': board });
		await expect(api.fetchBoard(false)).resolves.toEqual(board);
		expect(calls[0]?.route).toBe('/quests/@me');
	});

	it('fails fast when enrollment is blocked until a deadline', async () => {
		const board: AllQuestsResponse = {
			quests: [],
			excluded_quests: [],
			quest_enrollment_blocked_until: '2099-01-01T00:00:00.000Z',
		};
		const { api } = fakeClient({ 'GET /quests/@me': board });
		await expect(api.fetchBoard(false)).rejects.toBeInstanceOf(AppError);
	});

	it('appends the excluded quests when asked', async () => {
		const board: AllQuestsResponse = {
			quests: [],
			excluded_quests: [{ id: 'excluded-1' }],
			quest_enrollment_blocked_until: null,
		};
		const { api } = fakeClient({
			'GET /quests/@me': board,
			'GET /quests/excluded-1': { id: 'excluded-1', config: { messages: { quest_name: 'Hidden' } } },
		});
		const resolved = await api.fetchBoard(true);
		expect(resolved.quests.map((entry) => entry.id)).toEqual(['excluded-1']);
		expect(resolved.quests[0]?.user_status).toBeNull();
	});

	it('fetches a single quest config', async () => {
		const { api, calls } = fakeClient({ 'GET /quests/q-1': { id: 'q-1' } });
		await expect(api.fetchQuest('q-1')).resolves.toEqual({ id: 'q-1' });
		expect(calls[0]?.route).toBe('/quests/q-1');
	});

	it('enrolls as desktop by default', async () => {
		const { api, calls } = fakeClient();
		await api.enroll(quest({ id: 'q-1' }), 'desktop');
		const call = calls[0];
		expect(call?.route).toBe('/quests/q-1/enroll');
		expect(call?.options['headers']).toEqual({ [Constants.ANDROID_HEADER]: 'false' });
		expect((call?.options['body'] as { location: number }).location).toBe(
			Constants.QuestContentType.QUEST_HOME_DESKTOP,
		);
	});

	it('enrolls as android for the mobile profile', async () => {
		const { api, calls } = fakeClient();
		await api.enroll(quest({ id: 'q-1' }), 'android');
		const call = calls[0];
		expect(call?.options['headers']).toEqual({ [Constants.ANDROID_HEADER]: 'true' });
		expect((call?.options['body'] as { location: number }).location).toBe(
			Constants.QuestContentType.QUEST_HOME_MOBILE,
		);
	});

	it('posts the video timestamp', async () => {
		const { api, calls } = fakeClient();
		await api.postVideoProgress('q-1', 14);
		expect(calls[0]).toMatchObject({
			route: '/quests/q-1/video-progress',
			options: { body: { timestamp: 14 } },
		});
	});

	it('posts the heartbeat body untouched', async () => {
		const { api, calls } = fakeClient();
		await api.postHeartbeat('q-1', { application_id: '1', terminal: true });
		expect(calls[0]).toMatchObject({
			route: '/quests/q-1/heartbeat',
			options: { body: { application_id: '1', terminal: true } },
		});
	});

	it('refuses to claim a quest without a reward platform', async () => {
		const { api } = fakeClient();
		await expect(api.claimReward(quest({ id: 'q-1', platforms: [] }))).rejects.toBeInstanceOf(
			AppError,
		);
	});

	it('claims a reward through the claim dispatcher', async () => {
		const { api, calls } = fakeClient({
			'POST /quests/q-1/claim-reward': {
				user_id: '1',
				quest_id: 'q-1',
				claimed_at: '2026-01-01T00:10:00.000Z',
				reward_code: null,
			},
		});
		const claimed = await api.claimReward(quest({ id: 'q-1' }));
		expect(claimed.quest_id).toBe('q-1');
		expect(calls[0]?.route).toBe('/quests/q-1/claim-reward');
		expect(calls[0]?.options['dispatcher']).toBeDefined();
	});

	it('rethrows a rejection that carries no captcha challenge', async () => {
		const failure = Object.assign(new Error('rate limited'), { rawError: { message: 'nope' } });
		const { api } = fakeClient({ 'POST /quests/q-1/claim-reward #1': failure });
		await expect(api.claimReward(quest({ id: 'q-1' }))).rejects.toThrow('rate limited');
	});

	it('gives up with CAPTCHA_REJECTED after the attempt budget', async () => {
		const failure = Object.assign(new Error('captcha required'), {
			rawError: CAPTCHA_CHALLENGE,
		});
		const responses: Record<string, unknown> = {};
		for (let attempt = 1; attempt <= 10; attempt++) {
			responses[`POST /quests/q-1/claim-reward #${attempt}`] = failure;
		}
		const { api } = fakeClient(responses);
		const error = await api.claimReward(quest({ id: 'q-1' })).catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('CAPTCHA_REJECTED');
	});

	it('fails with CAPTCHA_REJECTED when the solver fails', async () => {
		const failure = Object.assign(new Error('captcha required'), {
			rawError: CAPTCHA_CHALLENGE,
		});
		const { api } = fakeClient({ 'POST /quests/q-1/claim-reward': failure }, () =>
			Promise.reject(new Error('vendor unreachable')),
		);
		const error = await api.claimReward(quest({ id: 'q-1' })).catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe('CAPTCHA_REJECTED');
	});

	it('retries the claim with the solved captcha headers', async () => {
		const failure = Object.assign(new Error('captcha required'), {
			rawError: CAPTCHA_CHALLENGE,
		});
		const claimed = {
			user_id: '1',
			quest_id: 'q-1',
			claimed_at: '2026-01-01T00:10:00.000Z',
			reward_code: null,
		};
		const { api, calls } = fakeClient(
			{
				'POST /quests/q-1/claim-reward #1': failure,
				'POST /quests/q-1/claim-reward #2': claimed,
			},
			async () => ({ token: 'token', provider: 'test', headers: { 'x-captcha-key': 'token' } }),
		);
		await expect(api.claimReward(quest({ id: 'q-1' }))).resolves.toEqual(claimed);
		expect(calls[1]?.options['headers']).toEqual({ 'x-captcha-key': 'token' });
	});
});
