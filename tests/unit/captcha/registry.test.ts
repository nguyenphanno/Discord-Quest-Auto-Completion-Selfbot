import { describe, expect, it } from 'vitest';

import { CaptchaProviderRegistry } from '../../../src/captcha/providers/registry';

describe('CaptchaProviderRegistry', () => {
	it('exposes every documented vendor id', () => {
		expect(CaptchaProviderRegistry.ids()).toEqual([
			'capsolver',
			'capmonster',
			'anti-captcha',
			'2captcha',
			'yescaptcha',
			'manual',
		]);
	});

	it('lists the credential environment variables, excluding manual', () => {
		expect(CaptchaProviderRegistry.credentialEnvNames()).toEqual([
			'CAPSOLVER_API_KEY',
			'CAPMONSTER_API_KEY',
			'ANTI_CAPTCHA_API_KEY',
			'TWOCAPTCHA_API_KEY',
			'YES_CAPTCHA_API_KEY',
		]);
	});

	it('picks the fastest configured vendor during auto-detection', () => {
		const selection = CaptchaProviderRegistry.select({
			credentials: { CAPSOLVER_API_KEY: 'a', ANTI_CAPTCHA_API_KEY: 'b' },
		});
		expect(selection.descriptor?.id).toBe('capsolver');
		expect(selection.detected).toBe(true);
	});

	it('falls back to the next vendor by priority order', () => {
		const selection = CaptchaProviderRegistry.select({ credentials: { ANTI_CAPTCHA_API_KEY: 'b' } });
		expect(selection.descriptor?.id).toBe('anti-captcha');
	});

	it('lets an explicit provider id win over auto-detection', () => {
		const selection = CaptchaProviderRegistry.select({
			providerId: '2captcha',
			credentials: { CAPSOLVER_API_KEY: 'a', TWOCAPTCHA_API_KEY: 'b' },
		});
		expect(selection.descriptor?.id).toBe('2captcha');
	});

	it('rejects an unknown provider id with the list of known ones', () => {
		const selection = CaptchaProviderRegistry.select({ providerId: 'nope' });
		expect(selection.descriptor).toBeNull();
		expect(selection.reason).toContain('Unknown captcha provider "nope"');
		expect(selection.reason).toContain('capsolver');
	});

	it('rejects an explicit provider whose key is missing', () => {
		const selection = CaptchaProviderRegistry.select({ providerId: 'capsolver' });
		expect(selection.descriptor).toBeNull();
		expect(selection.reason).toContain('CAPSOLVER_API_KEY');
	});

	it('explains how to configure a provider when nothing is set', () => {
		const selection = CaptchaProviderRegistry.select();
		expect(selection.descriptor).toBeNull();
		expect(selection.reason).toContain('CAPTCHA_MANUAL=true');
	});

	it('builds a provider from the selected descriptor', () => {
		const resolution = CaptchaProviderRegistry.resolve({
			providerId: 'capsolver',
			credentials: { CAPSOLVER_API_KEY: 'key' },
		});
		expect(resolution.provider?.id).toBe('capsolver');
		expect(resolution.reason).toBeNull();
	});

	it('returns no provider together with the selection reason', () => {
		const resolution = CaptchaProviderRegistry.resolve({ providerId: 'nope' });
		expect(resolution.provider).toBeNull();
		expect(resolution.reason).toContain('Unknown captcha provider');
	});

	it('labels the active provider, marking auto-detection', () => {
		expect(
			CaptchaProviderRegistry.labelFor({ credentials: { CAPSOLVER_API_KEY: 'key' } }),
		).toBe('CapSolver (auto)');
		expect(
			CaptchaProviderRegistry.labelFor({
				providerId: 'capsolver',
				credentials: { CAPSOLVER_API_KEY: 'key' },
			}),
		).toBe('CapSolver');
		expect(CaptchaProviderRegistry.labelFor({ providerId: 'nope' })).toBe('disabled');
	});

	it('describes the state of every provider for the preflight block', () => {
		const rows = CaptchaProviderRegistry.describeAll({ CAPSOLVER_API_KEY: 'key' });
		expect(rows).toContainEqual(['capsolver', 'CapSolver - configured']);
		expect(rows).toContainEqual(['manual', 'Manual prompt - opt-in']);
		expect(rows.some(([, state]) => state === '2Captcha - needs TWOCAPTCHA_API_KEY')).toBe(true);
	});
});
