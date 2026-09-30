/**
 * @file Protocol fingerprints, endpoint paths and tuning constants.
 *
 * The client-property objects below are protocol fingerprints: Discord uses
 * them to identify the "official client" that is talking. Their values are
 * intentionally frozen replicas of the desktop and Android builds and must not
 * be "improved" without matching the live clients first.
 */

import { randomUUID } from 'node:crypto';

export class Constants extends null {
	static readonly NAME = 'discord-quest-selfbot';
	static readonly VERSION = '1.1.0';
	static readonly API_VERSION = '10';
	static readonly GATEWAY_URL = 'wss://gateway.discord.gg';

	static readonly USER_AGENT =
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9236 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

	static readonly Properties = {
		os: 'Windows',
		browser: 'Discord Client',
		release_channel: 'stable',
		client_version: '1.0.9236',
		os_version: '10.0.19045',
		os_arch: 'x64',
		app_arch: 'x64',
		system_locale: 'en-US',
		has_client_mods: false,
		client_launch_id: randomUUID(),
		browser_user_agent: Constants.USER_AGENT,
		browser_version: '37.6.0',
		os_sdk_version: '19045',
		client_build_number: 539951,
		native_build_number: 81687,
		client_event_source: null,
		launch_signature: randomUUID(),
		client_heartbeat_session_id: randomUUID(),
		client_app_state: 'focused',
	};

	static readonly ANDROID_USER_AGENT = 'Discord-Android/316011;RNA';

	static readonly ANDROID_Properties = {
		os: 'Android',
		browser: 'Discord Android',
		device: 'b0q',
		system_locale: 'en-US',
		has_client_mods: false,
		client_version: '316.11 - rn',
		release_channel: 'googleRelease',
		device_vendor_id: randomUUID(),
		design_id: 2,
		browser_user_agent: '',
		browser_version: '',
		os_version: '28',
		client_build_number: 5169,
		client_event_source: null,
		client_launch_id: randomUUID(),
		launch_signature: '1771754995045142953',
		client_app_state: 'active',
		client_heartbeat_session_id: randomUUID(),
	};

	/** Token scheme the official REST clients send; the selfbot strips it. */
	static readonly SELF_BOT_TOKEN_PREFIX = 'Bot ';

	/** Internal header used to opt a single request into the Android profile. */
	static readonly ANDROID_HEADER = 'AndroidRequest';

	static readonly DEFAULT_DISCORD_LOCALE = 'en-US';
	static readonly DEFAULT_ACCEPT_LANGUAGE = 'vi';
	static readonly DEFAULT_TIMEZONE = 'Asia/Saigon';
	static readonly DEBUG_OPTIONS = 'bugReporterEnabled';
	static readonly ORIGIN = 'https://discord.com';
	static readonly REFERER = 'https://discord.com/channels/@me';
	static readonly FALLBACK_GATEWAY_MAX_CONCURRENCY = 1;

	/**
	 * Cipher list for reward claiming. Discord rejects the default Node cipher
	 * order on that route, so the desktop client's ordering is replayed.
	 */
	static readonly TLS_CIPHERS = [
		'TLS_AES_128_GCM_SHA256',
		'TLS_AES_256_GCM_SHA384',
		'TLS_CHACHA20_POLY1305_SHA256',
		'ECDHE-ECDSA-AES128-GCM-SHA256',
		'ECDHE-RSA-AES128-GCM-SHA256',
		'ECDHE-ECDSA-AES256-GCM-SHA384',
		'ECDHE-RSA-AES256-GCM-SHA384',
		'ECDHE-ECDSA-CHACHA20-POLY1305',
		'ECDHE-RSA-CHACHA20-POLY1305',
		'ECDHE-RSA-AES128-SHA',
		'ECDHE-RSA-AES256-SHA',
		'AES128-GCM-SHA256',
		'AES256-GCM-SHA384',
		'AES128-SHA',
		'AES256-SHA',
	].join(':');

	/** `locations` accepted by `POST /quests/{id}/enroll`. */
	static readonly QuestContentType = {
		QUEST_HOME_DESKTOP: 11,
		QUEST_HOME_MOBILE: 12,
		QUEST_SHARE_LINK: 19,
	} as const;

	/** Timing and retry tuning for the quest flows. */
	static readonly Tuning = {
		/** `POST /quests/{id}/claim-reward` attempts before giving up. */
		maxRedeemAttempts: 3,
		/** Heartbeat cadence for PLAY_ON_* and PLAY_ACTIVITY tasks. */
		heartbeatIntervalSeconds: 20,
		/** How far ahead of real time a video spoof may report progress. */
		videoMaxFutureSeconds: 10,
		/** Seconds of progress added per video tick. */
		videoSpeedSeconds: 7,
		/** Delay between video progress submissions (docs suggest 10-15s). */
		videoIntervalSeconds: 7,
		/** Build number extracted from the live web bundle. */
		buildNumberPattern: /buildNumber["\s:]+["\s]*(\d{5,7})/,
		/** Web asset holding the current client build number. */
		webAssetPattern: /\/assets\/web\.([a-f0-9]+)\.js/g,
	} as const;

	static readonly Endpoints = {
		quests: '/quests/@me' as const,
		quest: (questId: string): `/quests/${string}` => `/quests/${questId}`,
		enroll: (questId: string): `/quests/${string}/enroll` =>
			`/quests/${questId}/enroll`,
		claimReward: (questId: string): `/quests/${string}/claim-reward` =>
			`/quests/${questId}/claim-reward`,
		heartbeat: (questId: string): `/quests/${string}/heartbeat` =>
			`/quests/${questId}/heartbeat`,
		videoProgress: (questId: string): `/quests/${string}/video-progress` =>
			`/quests/${questId}/video-progress`,
		publicApplications: '/applications/public' as const,
		proxyTickets: (applicationId: string): `/applications/${string}/proxy-tickets` =>
			`/applications/${applicationId}/proxy-tickets`,
		oauthAuthorize: '/oauth2/authorize' as const,
		oauthTokens: '/oauth2/tokens' as const,
		discordSaysAuthorize: (applicationId: string): string =>
			`https://${applicationId}.discordsays.com/.proxy/acf/authorize`,
		discordSaysProgress: (applicationId: string): string =>
			`https://${applicationId}.discordsays.com/.proxy/acf/quest/progress`,
	} as const;

	static questUrl(questId: string): string {
		return `https://discord.com/quests/${questId}`;
	}
}
