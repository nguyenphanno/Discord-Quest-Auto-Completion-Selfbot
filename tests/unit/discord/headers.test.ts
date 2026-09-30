import { describe, expect, it } from 'vitest';

import { Constants } from '../../../src/discord/constants';
import { DiscordHeaders } from '../../../src/discord/headers';

function headerOf(headers: Headers, name: string): string | null {
	return headers.get(name);
}

describe('DiscordHeaders', () => {
	it('encodes super properties as base64 JSON', () => {
		const encoded = DiscordHeaders.encodeSuperProperties({ os: 'Windows' });
		expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('{"os":"Windows"}');
	});

	it('merges headers with set semantics', () => {
		const merged = DiscordHeaders.merge(
			new Headers({ a: '1', b: '2' }),
			new Headers({ b: '3', c: '4' }),
		);
		expect(merged.get('a')).toBe('1');
		expect(merged.get('b')).toBe('3');
		expect(merged.get('c')).toBe('4');
	});

	it('builds the desktop fingerprint headers', () => {
		const headers = DiscordHeaders.desktop();
		expect(headerOf(headers, 'User-Agent')).toBe(Constants.USER_AGENT);
		expect(headerOf(headers, 'origin')).toBe(Constants.ORIGIN);
		expect(headerOf(headers, 'referer')).toBe(Constants.REFERER);
		expect(headerOf(headers, 'x-super-properties')).toBeTruthy();
		expect(headerOf(headers, 'sec-ch-ua-platform')).toBe('"Windows"');
	});

	it('omits the origin block when asked', () => {
		const headers = DiscordHeaders.desktop(true, false);
		expect(headerOf(headers, 'origin')).toBeNull();
		expect(headerOf(headers, 'x-super-properties')).toBeTruthy();
	});

	it('omits the fingerprint when asked', () => {
		expect(headerOf(DiscordHeaders.desktop(false), 'x-super-properties')).toBeNull();
	});

	it('honours the profile overrides', () => {
		const headers = DiscordHeaders.desktop(true, true, {
			acceptLanguage: 'en-GB',
		});
		expect(headerOf(headers, 'accept-language')).toBe('en-GB');
	});

	it('builds the android fingerprint headers', () => {
		const headers = DiscordHeaders.android();
		expect(headerOf(headers, 'User-Agent')).toBe(Constants.ANDROID_USER_AGENT);
		expect(headerOf(headers, 'origin')).toBeNull();
		expect(headerOf(headers, 'x-super-properties')).toBeTruthy();
		expect(headerOf(DiscordHeaders.android(false), 'x-super-properties')).toBeNull();
	});

	it('strips the Bot prefix from the REST authorization header', () => {
		const patched = DiscordHeaders.applyToRestRequest({
			headers: { Authorization: 'Bot user.token.value' },
		});
		const headers = new Headers(patched.headers as Record<string, string>);
		expect(headerOf(headers, 'Authorization')).toBe('user.token.value');
	});

	it('adds the discord locale headers', () => {
		const patched = DiscordHeaders.applyToRestRequest({});
		const headers = new Headers(patched.headers as Record<string, string>);
		expect(headerOf(headers, 'x-discord-locale')).toBe(Constants.DEFAULT_DISCORD_LOCALE);
		expect(headerOf(headers, 'x-discord-timezone')).toBe(Constants.DEFAULT_TIMEZONE);
		expect(headerOf(headers, 'x-debug-options')).toBe(Constants.DEBUG_OPTIONS);
	});

	it('consumes the internal android marker and applies the android profile', () => {
		const patched = DiscordHeaders.applyToRestRequest({
			headers: { [Constants.ANDROID_HEADER]: 'true' },
		});
		const headers = new Headers(patched.headers as Record<string, string>);
		expect(headerOf(headers, Constants.ANDROID_HEADER)).toBeNull();
		expect(headerOf(headers, 'User-Agent')).toBe(Constants.ANDROID_USER_AGENT);
	});

	it('keeps the rest of the request init untouched', () => {
		const patched = DiscordHeaders.applyToRestRequest({ method: 'POST' });
		expect(patched.method).toBe('POST');
	});

	it('builds the activity proxy headers', () => {
		expect(DiscordHeaders.activity('quest-1', 'token')).toEqual({
			'Content-Type': 'application/json',
			'X-Auth-Token': 'token',
			'X-Discord-Quest-ID': 'quest-1',
		});
		expect(DiscordHeaders.activity('quest-1', 'token', 'https://ref.test').Referer).toBe(
			'https://ref.test',
		);
	});
});
