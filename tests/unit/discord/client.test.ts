import { describe, expect, it, vi } from 'vitest';

import {
	closeClaimDispatcher,
	ClientQuest,
	getClaimDispatcher,
} from '../../../src/discord/client';
import { BuildInfo } from '../../../src/discord/build-info';
import { Constants } from '../../../src/discord/constants';
import { loadConfig } from '../../../src/config/load';

describe('claim dispatcher', () => {
	it('is created once and reused', () => {
		const first = getClaimDispatcher();
		expect(getClaimDispatcher()).toBe(first);
		return closeClaimDispatcher().then(() => {
			// A fresh pool is built after the previous one was released.
			expect(getClaimDispatcher()).not.toBe(first);
			return closeClaimDispatcher();
		});
	});

	it('is a no-op to close twice', async () => {
		getClaimDispatcher();
		await closeClaimDispatcher();
		await expect(closeClaimDispatcher()).resolves.toBeUndefined();
	});
});

describe('ClientQuest', () => {
	it('refuses to start without a token', () => {
		const config = loadConfig({ TOKEN: '' });
		expect(() => new ClientQuest(config)).toThrow(/token is required/i);
	});

	it('wires the supporting services from the configuration', () => {
		const config = loadConfig({
			TOKEN: 'aaa.bbb.ccc',
			CAPTCHA_PROVIDER: 'capsolver',
			CAPSOLVER_API_KEY: 'key',
		});
		const client = new ClientQuest(config);
		expect(client.captcha.enabled).toBe(true);
		expect(client.captcha.providerId).toBe('capsolver');
		expect(client.reporter.configured).toBe(false);
		expect(client.websocketManager).toBeDefined();
	});

	it('reports a quest completion through the webhook facade', () => {
		const config = loadConfig({ TOKEN: 'aaa.bbb.ccc' });
		const client = new ClientQuest(config);
		expect(() => client.emitQuestCompleted('q-1', 'Quest One')).not.toThrow();
		expect(() => client.sendWebhookMessage('run aborted')).not.toThrow();
	});

	it('applies the configured build number override', async () => {
		const resolve = vi.spyOn(BuildInfo, 'resolve').mockResolvedValue(null);
		try {
			const config = loadConfig({ TOKEN: 'aaa.bbb.ccc', CLIENT_BUILD_NUMBER: '123456' });
			const client = new ClientQuest(config);
			await expect(client.resolveBuildNumber()).resolves.toBe(123_456);
		} finally {
			resolve.mockRestore();
		}
	});

	it('falls back to the scraped build number', async () => {
		const resolve = vi.spyOn(BuildInfo, 'resolve').mockResolvedValue(654_321);
		try {
			const client = new ClientQuest(loadConfig({ TOKEN: 'aaa.bbb.ccc' }));
			await expect(client.resolveBuildNumber()).resolves.toBe(654_321);
			expect(Constants.Properties.client_build_number).toBe(654_321);
		} finally {
			resolve.mockRestore();
		}
	});
});
