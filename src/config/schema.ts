/**
 * @file Configuration types shared by the loader, Discord client and UI.
 */

import type { HeaderProfile } from '../discord/headers';
import type { LogLevel } from '../ui/logger';

export interface HttpConfig {
	timeoutMs: number;
	retries: number;
	retryDelayMs: number;
}

export interface CaptchaConfig {
	provider: string | null;
	allowManual: boolean;
	credentials: Record<string, string | null>;
	pollIntervalMs: number;
	timeoutMs: number;
}

export interface WebhookEventsConfig {
	completed: boolean;
	failed: boolean;
	summary: boolean;
}

export interface CacheConfig {
	enabled: boolean;
	directory: string;
	skipSettled: boolean;
}

export interface QuestBotConfig {
	token: string;
	webhookUrl: string | null;
	captcha: CaptchaConfig;
	headers: Required<HeaderProfile>;
	logLevel: LogLevel;
	logJson: boolean;
	logAscii: boolean;
	logColor: boolean | null;
	logTimestamps: boolean;
	isCi: boolean;
	dryRun: boolean;
	webhookEvents: WebhookEventsConfig;
	cache: CacheConfig;
	redeemRewards: boolean;
	fetchExcludedQuests: boolean;
	concurrency: number;
	includeQuestIds: string[];
	excludeQuestIds: string[];
	http: HttpConfig;
	buildNumber: number | null;
	watchPollMs: number;
	proxyUrl: string | null;
	reportDirectory: string;
	enrollCooldownMs: number;
}

export interface ValidationReport {
	errors: string[];
	warnings: string[];
	notices: string[];
}

export class ConfigError extends Error {
	constructor(
		message: string,
		readonly problems: string[],
	) {
		super(message);
		this.name = 'ConfigError';
	}
}
