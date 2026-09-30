/**
 * @file Header construction for the impersonated Discord clients.
 *
 * Two profiles are supported, mirroring the desktop Electron build and the
 * Android React-Native build. The REST hook rewrites every outgoing request so
 * the `Authorization: Bot <token>` scheme inserted by `@discordjs/rest` is
 * downgraded to the raw user token a real client sends, then layers the
 * desktop or Android fingerprint on top.
 */

import type { RequestInit } from 'undici';
import { Constants } from './constants';

export interface HeaderProfile {
	/** `accept-language` request header. */
	acceptLanguage?: string;
	/** `x-discord-locale` request header. */
	discordLocale?: string;
	/** `x-discord-timezone` request header. */
	timezone?: string;
}

export class DiscordHeaders extends null {
	/** Base64 encoded `x-super-properties` payload. */
	static encodeSuperProperties(properties: object): string {
		return Buffer.from(JSON.stringify(properties)).toString('base64');
	}

	/** Overlay of `b` onto a copy of `a`, matching `Headers.set` semantics. */
	static merge(a: Headers, b: Headers): Headers {
		const result = new Headers(a);
		b.forEach((value, key) => {
			result.set(key, value);
		});
		return result;
	}

	/** Desktop Electron fingerprint. */
	static desktop(
		withClientProperties = true,
		withOriginAndReferer = true,
		profile: HeaderProfile = {},
	): Headers {
		const headers = new Headers();
		headers.append(
			'accept-language',
			profile.acceptLanguage ?? Constants.DEFAULT_ACCEPT_LANGUAGE,
		);
		headers.append('User-Agent', Constants.USER_AGENT);
		if (withOriginAndReferer) {
			headers.append('origin', Constants.ORIGIN);
			headers.append('referer', Constants.REFERER);
		}
		headers.append('pragma', 'no-cache');
		headers.append('priority', 'u=1, i');
		headers.append('sec-ch-ua', '"Not)A;Brand";v="8", "Chromium";v="138"');
		headers.append('sec-ch-ua-mobile', '?0');
		headers.append('sec-ch-ua-platform', '"Windows"');
		headers.append('sec-fetch-dest', 'empty');
		headers.append('sec-fetch-mode', 'cors');
		headers.append('sec-fetch-site', 'same-origin');
		if (withClientProperties) {
			headers.append(
				'x-super-properties',
				DiscordHeaders.encodeSuperProperties(Constants.Properties),
			);
		}
		return headers;
	}

	/** Android React-Native fingerprint. */
	static android(withClientProperties = true, profile: HeaderProfile = {}): Headers {
		const headers = new Headers();
		headers.append(
			'accept-language',
			profile.acceptLanguage ?? Constants.DEFAULT_ACCEPT_LANGUAGE,
		);
		headers.append('User-Agent', Constants.ANDROID_USER_AGENT);
		if (withClientProperties) {
			headers.append(
				'x-super-properties',
				DiscordHeaders.encodeSuperProperties(Constants.ANDROID_Properties),
			);
		}
		return headers;
	}

	/**
	 * Rewrites the headers of an outgoing REST call. Returning a fresh object
	 * keeps `RequestInit` immutable while `@discordjs/rest` still receives the
	 * `Headers` instance it expects.
	 */
	static applyToRestRequest(init: RequestInit, profile: HeaderProfile = {}): RequestInit {
		let headers = new Headers((init.headers ?? {}) as Record<string, string>);
		const isAndroidRequest = headers.get(Constants.ANDROID_HEADER) === 'true';
		headers.delete(Constants.ANDROID_HEADER);

		const authorization = headers.get('Authorization');
		if (authorization) {
			headers.set(
				'Authorization',
				authorization.replace(Constants.SELF_BOT_TOKEN_PREFIX, ''),
			);
		}

		headers.append('accept-language', profile.acceptLanguage ?? Constants.DEFAULT_ACCEPT_LANGUAGE);
		headers.append('x-debug-options', Constants.DEBUG_OPTIONS);
		headers.append('x-discord-locale', profile.discordLocale ?? Constants.DEFAULT_DISCORD_LOCALE);
		headers.append('x-discord-timezone', profile.timezone ?? Constants.DEFAULT_TIMEZONE);

		headers = DiscordHeaders.merge(
			headers,
			isAndroidRequest
				? DiscordHeaders.android(true, profile)
				: DiscordHeaders.desktop(true, true, profile),
		);

		return { ...init, headers: headers as unknown as Record<string, string> };
	}

	/**
	 * Headers required by the `discordsays.com` activity proxy that serves the
	 * ACHIEVEMENT_IN_ACTIVITY quest flow.
	 */
	static activity(
		questId: string,
		authToken = '',
		activityReferrer?: string,
	): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'X-Auth-Token': authToken,
			'X-Discord-Quest-ID': questId,
		};
		if (activityReferrer) {
			headers.Referer = activityReferrer;
		}
		return headers;
	}
}
