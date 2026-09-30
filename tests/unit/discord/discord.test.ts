import { describe, expect, it } from 'vitest';
import { WebSocketShard } from '@discordjs/ws';

import { Constants } from '../../../src/discord/constants';
import { identifyPatchInstalled, installIdentifyPatch } from '../../../src/discord/gateway';
import { AndroidFingerprint, ANDROID_USER_AGENT, DesktopFingerprint, TLS_CIPHERS, USER_AGENT } from '../../../src/discord/fingerprints';

describe('installIdentifyPatch', () => {
	it('is safe to call twice', () => {
		installIdentifyPatch();
		const first = WebSocketShard.prototype.send;
		installIdentifyPatch();
		expect(WebSocketShard.prototype.send).toBe(first);
	});

	it('reports that it is installed', () => {
		expect(identifyPatchInstalled()).toBe(true);
	});
});

describe('Constants', () => {
	it('reuses the frozen fingerprint objects instead of copying them', () => {
		expect(Constants.Properties).toBe(DesktopFingerprint);
		expect(Constants.ANDROID_Properties).toBe(AndroidFingerprint);
	});

	it('exposes distinct desktop and android user agents', () => {
		expect(Constants.USER_AGENT).not.toBe(Constants.ANDROID_USER_AGENT);
	});

	it('builds every quest endpoint from the id', () => {
		const id = '123456789012345678';
		expect(Constants.Endpoints.quest(id)).toBe(`/quests/${id}`);
		expect(Constants.Endpoints.enroll(id)).toBe(`/quests/${id}/enroll`);
		expect(Constants.Endpoints.claimReward(id)).toBe(`/quests/${id}/claim-reward`);
		expect(Constants.Endpoints.heartbeat(id)).toBe(`/quests/${id}/heartbeat`);
		expect(Constants.Endpoints.videoProgress(id)).toBe(`/quests/${id}/video-progress`);
	});

	it('keeps the quest board endpoint stable', () => {
		expect(Constants.Endpoints.quests).toBe('/quests/@me');
	});

	it('builds a public quest url for the summary links', () => {
		expect(Constants.questUrl('42')).toBe('https://discord.com/quests/42');
	});

	it('keeps the documented video and heartbeat tuning', () => {
		expect(Constants.Tuning.videoSpeedSeconds).toBe(7);
		expect(Constants.Tuning.videoMaxFutureSeconds).toBe(10);
		expect(Constants.Tuning.heartbeatIntervalSeconds).toBe(20);
		expect(Constants.Tuning.maxRedeemAttempts).toBe(3);
	});

	it('sends the token prefix the official clients use', () => {
		expect(Constants.SELF_BOT_TOKEN_PREFIX).toBe('Bot ');
	});

	it('replays a non-empty cipher list on the claim route', () => {
		expect(Constants.TLS_CIPHERS.length).toBeGreaterThan(0);
	});
});

describe('fingerprints', () => {
	it('identifies the desktop client with a build number', () => {
		expect(DesktopFingerprint.os).toBe('Windows');
		expect(DesktopFingerprint.browser).toBe('Discord Client');
		expect(DesktopFingerprint.client_build_number).toBeGreaterThan(0);
		expect(DesktopFingerprint.browser_user_agent).toBe(USER_AGENT);
	});

	it('identifies the android client without desktop session fields', () => {
		expect(AndroidFingerprint.os).toBe('Android');
		expect(AndroidFingerprint.browser).toBe('Discord Android');
		expect(AndroidFingerprint.device).toBeTruthy();
		expect('desktop' in AndroidFingerprint).toBe(false);
	});

	it('generates a fresh launch id per process', () => {
		expect(DesktopFingerprint.client_launch_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(DesktopFingerprint.launch_signature).not.toBe(DesktopFingerprint.client_launch_id);
	});

	it('replays the captured desktop cipher order on the claim route', () => {
		expect(TLS_CIPHERS.split(':')[0]).toBe('TLS_AES_128_GCM_SHA256');
		expect(TLS_CIPHERS).toContain('ECDHE-RSA-AES128-GCM-SHA256');
		expect(ANDROID_USER_AGENT).toMatch(/^Discord-Android\//);
	});
});
