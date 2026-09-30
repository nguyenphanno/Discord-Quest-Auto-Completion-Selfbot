import { describe, expect, it } from 'vitest';

import { CaptchaError, CaptchaService } from '../../../src/captcha/service';
import { CaptchaProviderError, resolveOptions, readBalance } from '../../../src/captcha/providers/provider';
import { CAPTCHA_DEFAULTS } from '../../../src/captcha/providers/provider';
import { Constants } from '../../../src/discord/constants';
import type { CaptchaDataFromRequest } from '../../../src/quests/model/types';

const CHALLENGE: CaptchaDataFromRequest = {
	captcha_key: ['E0:key'],
	captcha_sitekey: 'site-key',
	captcha_service: 'hcaptcha',
	captcha_session_id: 'session-1',
	captcha_rqdata: 'rqdata',
	captcha_rqtoken: 'rqtoken',
};

describe('CaptchaService', () => {
	it('is disabled without a configured provider', () => {
		const service = new CaptchaService();
		expect(service.enabled).toBe(false);
		expect(service.providerId).toBeNull();
		expect(service.unavailableReason).toBeTruthy();
	});

	it('refuses to solve while disabled', async () => {
		await expect(new CaptchaService().solve(CHALLENGE)).rejects.toBeInstanceOf(CaptchaError);
	});

	it('adopts the selected provider', () => {
		const service = new CaptchaService({
			providerId: 'capsolver',
			credentials: { CAPSOLVER_API_KEY: 'key' },
		});
		expect(service.enabled).toBe(true);
		expect(service.providerId).toBe('capsolver');
		expect(service.providerLabel).toBe('CapSolver');
	});

	it('flags auto-detection', () => {
		const service = new CaptchaService({ credentials: { CAPSOLVER_API_KEY: 'key' } });
		expect(service.detected).toBe(true);
	});

	it('returns no balance when the vendor exposes none', async () => {
		const service = new CaptchaService({
			providerId: 'capsolver',
			credentials: { CAPSOLVER_API_KEY: 'key' },
		});
		await expect(service.balance()).resolves.toBeNull();
	});

	it('converts the wire challenge into the provider shape', () => {
		const challenge = CaptchaService.toChallenge(CHALLENGE);
		expect(challenge).toMatchObject({
			sitekey: 'site-key',
			service: 'hcaptcha',
			rqdata: 'rqdata',
			sessionId: 'session-1',
			rqtoken: 'rqtoken',
			url: Constants.ORIGIN,
		});
	});

	it('recognises a challenge on a rejected request', () => {
		expect(CaptchaService.extractChallenge(CHALLENGE)).toEqual(CHALLENGE);
	});

	it('ignores errors that carry no challenge', () => {
		expect(CaptchaService.extractChallenge({ message: 'nope' })).toBeNull();
		expect(CaptchaService.extractChallenge(null)).toBeNull();
		expect(CaptchaService.extractChallenge('text')).toBeNull();
	});

	it('starts with empty counters', () => {
		expect(new CaptchaService().stats).toEqual({ solved: 0, failed: 0 });
	});
});

describe('captcha provider helpers', () => {
	it('fills the provider defaults', () => {
		expect(resolveOptions()).toEqual(CAPTCHA_DEFAULTS);
		expect(resolveOptions({ timeoutMs: 10 }).timeoutMs).toBe(10);
	});

	it('reads a numeric or string balance', () => {
		expect(readBalance({ balance: 1.5 })).toBe(1.5);
		expect(readBalance({ balance: '2.5' })).toBe(2.5);
		expect(readBalance({ request: 3 })).toBe(3);
		expect(readBalance({})).toBeNull();
		expect(readBalance({ balance: 'many' })).toBeNull();
	});

	it('carries the provider id and code on a provider error', () => {
		const error = new CaptchaProviderError('rejected', 'yescaptcha', 'ERROR_10008');
		expect(error.name).toBe('CaptchaProviderError');
		expect(error.providerId).toBe('yescaptcha');
		expect(error.code).toBe('ERROR_10008');
	});
});
