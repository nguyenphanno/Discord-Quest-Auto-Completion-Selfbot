/**
 * @file Protocol fingerprints, endpoint paths and tuning constants.
 *
 * The client-property objects below are protocol fingerprints: Discord uses
 * them to identify the "official client" that is talking. Their values are
 * intentionally frozen replicas of the desktop and Android builds and must not
 * be "improved" without matching the live clients first.
 */

import {
	ANDROID_USER_AGENT as ANDROID_UA,
	AndroidFingerprint,
	DesktopFingerprint,
	TLS_CIPHERS as TLS_CIPHER_LIST,
	USER_AGENT as DESKTOP_UA,
} from './fingerprints';

export class Constants extends null {
	static readonly NAME = 'discord-quest-selfbot';
	static readonly VERSION = '2.0.0';
	static readonly API_VERSION = '10';
	static readonly GATEWAY_URL = 'wss://gateway.discord.gg';

	static readonly USER_AGENT = DESKTOP_UA;

	static readonly Properties = DesktopFingerprint;

	static readonly ANDROID_USER_AGENT = ANDROID_UA;

	static readonly ANDROID_Properties = AndroidFingerprint;

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

	/** Cipher list replayed on the claim route; see `fingerprints.ts`. */
	static readonly TLS_CIPHERS = TLS_CIPHER_LIST;

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
