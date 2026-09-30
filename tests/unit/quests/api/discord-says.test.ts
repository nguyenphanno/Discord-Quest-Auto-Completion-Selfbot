import { describe, expect, it, vi } from 'vitest';

import { DiscordSaysService } from '../../../../src/quests/api/discord-says';
import { DiscordHeaders } from '../../../../src/discord/headers';
import { Http } from '../../../../src/shared/http';
import type { HttpConfig } from '../../../../src/config/schema';

const HTTP_CONFIG: HttpConfig = { timeoutMs: 1_000, retries: 1, retryDelayMs: 0 };
const APPLICATION = '900000000000000001';

function fakeClient(overrides: Record<string, unknown> = {}) {
	const calls: string[] = [];
	const rest = {
		post: async (route: string) => {
			calls.push(`POST ${route}`);
			return overrides[`POST ${route}`] ?? { ticket: 'ticket-1' };
		},
		get: async (route: string) => {
			calls.push(`GET ${route}`);
			return overrides[`GET ${route}`] ?? [];
		},
		delete: async (route: string) => {
			calls.push(`DELETE ${route}`);
			if (overrides.deleteFails) {
				throw new Error('already revoked');
			}
			return undefined;
		},
	};
	const client = { rest } as unknown as ConstructorParameters<typeof DiscordSaysService>[0];
	return { service: new DiscordSaysService(client, HTTP_CONFIG), calls };
}

describe('DiscordSaysService', () => {
	it('acquires a proxy ticket and builds the referrer', async () => {
		const { service, calls } = fakeClient();
		await expect(service.getProxyTicket(APPLICATION)).resolves.toBe('ticket-1');
		expect(calls).toEqual([`POST /applications/${APPLICATION}/proxy-tickets`]);

		const referrer = await service.getActivityReferrer(APPLICATION);
		expect(referrer).toContain(`https://${APPLICATION}.discordsays.com/`);
		expect(referrer).toContain('instance_id=');
		expect(referrer).toContain('discord_proxy_ticket=ticket-1');
	});

	it('exposes the activity headers', () => {
		const { service } = fakeClient();
		expect(service.getActivityHeaders('quest-1', 'token')).toMatchObject({
			'X-Auth-Token': 'token',
			'X-Discord-Quest-ID': 'quest-1',
		});
	});

	it('exchanges the auth code for an activity token', async () => {
		const json = vi.spyOn(Http, 'json').mockResolvedValue({ token: 'activity-token' } as never);
		try {
			const { service } = fakeClient();
			await expect(service.authorize(APPLICATION, 'quest-1', 'code')).resolves.toEqual({
				token: 'activity-token',
				error: null,
				activityReferrer: expect.stringContaining('discordsays.com'),
			});
		} finally {
			json.mockRestore();
		}
	});

	it('reports a missing token instead of throwing', async () => {
		const json = vi.spyOn(Http, 'json').mockResolvedValue({} as never);
		try {
			const { service } = fakeClient();
			await expect(service.authorize(APPLICATION, 'quest-1', 'code')).resolves.toMatchObject({
				token: null,
				error: expect.stringContaining('did not include a token'),
			});
		} finally {
			json.mockRestore();
		}
	});

	it('reports a referrer failure as an authorization error', async () => {
		const { service } = fakeClient();
		vi.spyOn(service, 'getActivityReferrer').mockRejectedValue(new Error('no ticket'));
		const result = await service.authorize(APPLICATION, 'quest-1', 'code');
		expect(result.token).toBeNull();
		expect(result.error).toContain('no ticket');
	});

	it('reports the activity progress', async () => {
		const text = vi.spyOn(Http, 'text').mockResolvedValue('ok' as never);
		try {
			const { service } = fakeClient();
			await expect(
				service.progress(APPLICATION, 'quest-1', 'token', 5, 'https://ref.test'),
			).resolves.toEqual({ success: true, error: null });
		} finally {
			text.mockRestore();
		}
	});

	it('turns a progress failure into a result object', async () => {
		const text = vi.spyOn(Http, 'text').mockRejectedValue(new Error('proxy rejected'));
		try {
			const { service } = fakeClient();
			await expect(
				service.progress(APPLICATION, 'quest-1', 'token', 5, 'https://ref.test'),
			).resolves.toEqual({ success: false, error: 'proxy rejected' });
		} finally {
			text.mockRestore();
		}
	});

	it('lists the authorized applications', async () => {
		const { service, calls } = fakeClient({ 'GET /oauth2/tokens': [{ id: 'token-1' }] });
		await expect(service.listAuthorizedTokens()).resolves.toEqual([{ id: 'token-1' }]);
		expect(calls).toEqual(['GET /oauth2/tokens']);
	});

	it('revokes an authorization and swallows an already-gone token', async () => {
		const ok = fakeClient();
		await expect(ok.service.deauthorize('token-1', APPLICATION)).resolves.toBe(true);
		expect(ok.calls).toEqual(['DELETE /oauth2/tokens/token-1']);

		const failing = fakeClient({ deleteFails: true });
		await expect(failing.service.deauthorize('token-1', APPLICATION)).resolves.toBe(false);
	});

	it('merges the desktop headers with the activity headers', () => {
		const merged = DiscordHeaders.merge(
			DiscordHeaders.desktop(false, false),
			new Headers({ 'X-Auth-Token': 'token' }),
		);
		expect(merged.get('X-Auth-Token')).toBe('token');
	});
});
