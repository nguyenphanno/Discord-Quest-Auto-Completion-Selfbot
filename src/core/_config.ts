/**
 * @file Environment driven configuration with validation.
 *
 * Everything the application needs is resolved once at startup, validated and
 * then passed down explicitly. Nothing below this module reads `process.env`
 * for behaviour, which keeps the runtime deterministic and testable.
 */

import type { HeaderProfile } from './_headers';
import { Constants } from './_constants';
import { LogLevel, parseLogLevel } from '../ui/_logger';
import { CaptchaProviderRegistry } from '../providers/_registry';
import { CAPTCHA_DEFAULTS } from '../providers/_provider';

export interface HttpConfig {
	timeoutMs: number;
	retries: number;
	retryDelayMs: number;
}

/** Captcha solving configuration. */
export interface CaptchaConfig {
	/** Explicit provider id (`CAPTCHA_PROVIDER`); `null` auto-detects. */
	provider: string | null;
	/** Allow the interactive stdin provider. */
	allowManual: boolean;
	/** API keys keyed by environment variable name. */
	credentials: Record<string, string | null>;
	/** Delay between result polls. */
	pollIntervalMs: number;
	/** Hard limit for a single challenge. */
	timeoutMs: number;
}

/** Which reports are delivered to the webhook. */
export interface WebhookEventsConfig {
	/** Per-quest completion notices. */
	completed: boolean;
	/** Per-quest failure notices. */
	failed: boolean;
	/** The end-of-run summary block. */
	summary: boolean;
}

/** Local run cache configuration. */
export interface CacheConfig {
	/** Whether the cache is read and written at all. */
	enabled: boolean;
	/** Directory holding the cache file. */
	directory: string;
}

export interface QuestBotConfig {
	/** Raw user token used for REST and gateway authentication. */
	token: string;
	/** Optional webhook used to report quest completions. */
	webhookUrl: string | null;
	/** Captcha solving configuration. */
	captcha: CaptchaConfig;
	/** Header profile applied to every outgoing request. */
	headers: Required<HeaderProfile>;
	/** Minimum log level that gets printed. */
	logLevel: LogLevel;
	/** Emit newline-delimited JSON logs. */
	logJson: boolean;
	/** Use ASCII-only glyphs. */
	logAscii: boolean;
	/** Force colour output; `null` keeps automatic detection. */
	logColor: boolean | null;
	/** Prefix log lines with a timestamp. */
	logTimestamps: boolean;
	/** Running inside GitHub Actions (or another CI). */
	isCi: boolean;
	/** Report only what would happen, without enrolling or claiming. */
	dryRun: boolean;
	/** Which notices are delivered to the webhook. */
	webhookEvents: WebhookEventsConfig;
	/** Local run cache. */
	cache: CacheConfig;
	/** Claim rewards for already completed quests. */
	redeemRewards: boolean;
	/** Resolve the full config of excluded quests too. */
	fetchExcludedQuests: boolean;
	/** Max concurrent quest workers; `0` keeps the legacy unbounded fan-out. */
	concurrency: number;
	/** Restrict processing to these quest ids. */
	includeQuestIds: string[];
	/** Skip these quest ids. */
	excludeQuestIds: string[];
	/** HTTP tuning for non-REST calls. */
	http: HttpConfig;
	/** Optional pinned client build number. */
	buildNumber: number | null;
}

export interface ValidationReport {
	errors: string[];
	warnings: string[];
	/** Informational hints that do not need operator attention. */
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

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
	const value = env[key];
	if (value === undefined) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
	const value = readString(env, key);
	if (value === null) {
		return fallback;
	}
	const normalised = value.toLowerCase();
	if (['1', 'true', 'yes', 'on', 'y'].includes(normalised)) {
		return true;
	}
	if (['0', 'false', 'no', 'off', 'n'].includes(normalised)) {
		return false;
	}
	return fallback;
}

function readNumber(
	env: NodeJS.ProcessEnv,
	key: string,
	fallback: number,
	minimum?: number,
): number {
	const value = readString(env, key);
	if (value === null) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	if (minimum !== undefined && parsed < minimum) {
		return fallback;
	}
	return parsed;
}

function readList(env: NodeJS.ProcessEnv, key: string): string[] {
	const value = readString(env, key);
	if (value === null) {
		return [];
	}
	return value
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/** Reads every captcha API key the provider registry knows about. */
function readCredentials(env: NodeJS.ProcessEnv): Record<string, string | null> {
	const credentials: Record<string, string | null> = {};
	for (const name of CaptchaProviderRegistry.credentialEnvNames()) {
		credentials[name] = readString(env, name);
	}
	return credentials;
}

/**
 * Resolves `WEBHOOK_EVENTS`. An empty value means "leave the defaults on",
 * `none` / `off` disables every notice.
 */
function readWebhookEvents(env: NodeJS.ProcessEnv): {
	completed: boolean;
	failed: boolean;
	summary: boolean;
} {
	const requested = readList(env, 'WEBHOOK_EVENTS').map((entry) => entry.toLowerCase());
	if (requested.some((entry) => entry === 'none' || entry === 'off')) {
		return { completed: false, failed: false, summary: false };
	}
	if (requested.length === 0 || requested.includes('all')) {
		return { completed: true, failed: true, summary: true };
	}
	return {
		completed: requested.includes('completed'),
		failed: requested.includes('failed'),
		summary: requested.includes('summary'),
	};
}

export class Config extends null {
	/** Resolves the complete configuration from the environment. */
	static load(env: NodeJS.ProcessEnv = process.env): QuestBotConfig {
		const colorValue = readString(env, 'LOG_COLOR');
		const buildNumber = readNumber(env, 'CLIENT_BUILD_NUMBER', Number.NaN, 1);
		return {
			token: readString(env, 'TOKEN') ?? '',
			webhookUrl: readString(env, 'WEBHOOK_URL'),
			captcha: {
				provider: readString(env, 'CAPTCHA_PROVIDER'),
				allowManual: readBoolean(env, 'CAPTCHA_MANUAL', false),
				credentials: readCredentials(env),
				pollIntervalMs: readNumber(
					env,
					'CAPTCHA_POLL_INTERVAL_MS',
					CAPTCHA_DEFAULTS.pollIntervalMs,
					250,
				),
				timeoutMs: readNumber(env, 'CAPTCHA_TIMEOUT_MS', CAPTCHA_DEFAULTS.timeoutMs, 5_000),
			},
			headers: {
				acceptLanguage:
					readString(env, 'DISCORD_ACCEPT_LANGUAGE') ?? Constants.DEFAULT_ACCEPT_LANGUAGE,
				discordLocale:
					readString(env, 'DISCORD_LOCALE') ?? Constants.DEFAULT_DISCORD_LOCALE,
				timezone: readString(env, 'DISCORD_TIMEZONE') ?? Constants.DEFAULT_TIMEZONE,
			},
			logLevel: parseLogLevel(readString(env, 'LOG_LEVEL') ?? undefined, LogLevel.Info),
			logJson: readBoolean(env, 'LOG_JSON', false),
			logAscii: readBoolean(env, 'LOG_ASCII', false),
			logColor: colorValue === null ? null : readBoolean(env, 'LOG_COLOR', true),
			logTimestamps: readBoolean(env, 'LOG_TIMESTAMPS', true),
			isCi: readBoolean(env, 'GITHUB_ACTIONS', false) || readBoolean(env, 'CI', false),
			dryRun: readBoolean(env, 'DRY_RUN', false),
			webhookEvents: readWebhookEvents(env),
			cache: {
				enabled: readBoolean(env, 'CACHE_ENABLED', true),
				directory: readString(env, 'CACHE_DIR') ?? '.cache',
			},
			redeemRewards: readBoolean(env, 'REDEEM_REWARDS', false),
			fetchExcludedQuests: readBoolean(env, 'FETCH_EXCLUDED_QUESTS', false),
			concurrency: readNumber(env, 'QUEST_CONCURRENCY', 0, 0),
			includeQuestIds: readList(env, 'QUEST_INCLUDE'),
			excludeQuestIds: readList(env, 'QUEST_EXCLUDE'),
			http: {
				timeoutMs: readNumber(env, 'HTTP_TIMEOUT_MS', 20_000, 1_000),
				retries: readNumber(env, 'HTTP_RETRIES', 2, 1),
				retryDelayMs: readNumber(env, 'HTTP_RETRY_DELAY_MS', 700, 0),
			},
			buildNumber: Number.isFinite(buildNumber) ? buildNumber : null,
		};
	}

	/** Problems that must be fixed before the bot can run. */
	static errors(config: QuestBotConfig): string[] {
		const errors: string[] = [];
		if (!config.token) {
			errors.push('TOKEN is missing. Add it to .env or to the TOKEN secret.');
		} else {
			if (config.token.startsWith('Bot ')) {
				errors.push(
					'TOKEN starts with "Bot ". Paste the raw user token without that prefix.',
				);
			}
			if (config.token.startsWith('MFA.')) {
				errors.push(
					'TOKEN looks like an MFA login token. Use the session token of an authenticated client instead.',
				);
			}
			if (config.token.split('.').length < 3) {
				errors.push('TOKEN does not look like a valid Discord token.');
			}
		}
		if (
			config.webhookUrl &&
			!/^https:\/\/discord(app)?\.com\/api(\/v\d+)?\/webhooks\//.test(config.webhookUrl)
		) {
			errors.push(
				'WEBHOOK_URL is not a Discord webhook URL (expected https://discord.com/api/webhooks/...).',
			);
		}
		return errors;
	}

	/** Non-fatal advice surfaced during preflight. */
	static warnings(config: QuestBotConfig): string[] {
		const warnings: string[] = [];
		const configured = CaptchaProviderRegistry.configuredIds(config.captcha.credentials);
		if (config.dryRun) {
			warnings.push('DRY_RUN is enabled: nothing will be enrolled or claimed.');
		}
		if (configured.includes('yescaptcha')) {
			warnings.push(
				'YesCaptcha is configured. Discord rejects a large share of its hCaptcha solutions with error 10008.',
			);
		}
		if (configured.length > 1) {
			warnings.push(
				`Multiple captcha providers are configured (${configured.join(', ')}); set CAPTCHA_PROVIDER to pick one explicitly.`,
			);
		}
		if (config.isCi) {
			warnings.push(
				'Running on CI violates the GitHub Actions Acceptable Use Policy and can lead to suspension.',
			);
		}
		return warnings;
	}

	/** Informational hints printed at info level. */
	static notices(config: QuestBotConfig): string[] {
		const notices: string[] = [];
		if (!config.webhookUrl) {
			notices.push('WEBHOOK_URL is not set; completion reports will not be delivered.');
		}
		if (config.concurrency === 0) {
			notices.push(
				'Concurrency is unlimited; set QUEST_CONCURRENCY (e.g. 3) if you hit rate limits.',
			);
		}
		const configured = CaptchaProviderRegistry.configuredIds(config.captcha.credentials);
		if (configured.length === 0 && !config.captcha.allowManual) {
			notices.push(
				'No captcha provider configured; a challenge during reward claiming will be reported instead of solved.',
			);
		}
		return notices;
	}

	/** Resolution options derived from the captcha configuration. */
	private static captchaOptions(config: QuestBotConfig) {
		return {
			providerId: config.captcha.provider,
			credentials: config.captcha.credentials,
			allowManual: config.captcha.allowManual,
			settings: {
				pollIntervalMs: config.captcha.pollIntervalMs,
				timeoutMs: config.captcha.timeoutMs,
			},
		};
	}

	static report(config: QuestBotConfig): ValidationReport {
		return {
			errors: Config.errors(config),
			warnings: Config.warnings(config),
			notices: Config.notices(config),
		};
	}

	/** Throws a `ConfigError` carrying every problem at once. */
	static assertValid(config: QuestBotConfig): void {
		const problems = Config.errors(config);
		if (problems.length > 0) {
			throw new ConfigError('Invalid configuration', problems);
		}
	}

	/** Masks a token for safe display: `MTIzNDU2********a1b2`. */
	static maskToken(token: string): string {
		if (!token) {
			return '<missing>';
		}
		if (token.length <= 12) {
			return `${token.slice(0, 2)}${'*'.repeat(Math.max(0, token.length - 2))}`;
		}
		return `${token.slice(0, 6)}${'*'.repeat(8)}${token.slice(-4)}`;
	}

	/** Rows for the preflight information block. Never includes the token. */
	static describe(config: QuestBotConfig): Array<[string, string]> {
		const events = config.webhookEvents;
		const enabledEvents = (['completed', 'failed', 'summary'] as const).filter(
			(name) => events[name],
		);
		return [
			['Token', Config.maskToken(config.token)],
			['Session', config.isCi ? 'GitHub Actions' : 'local'],
			['Mode', config.dryRun ? 'dry run (no writes)' : 'live'],
			['Timezone', config.headers.timezone],
			['Locale', `${config.headers.acceptLanguage} / ${config.headers.discordLocale}`],
			['Concurrency', config.concurrency === 0 ? 'unlimited' : String(config.concurrency)],
			['Redeem', config.redeemRewards ? 'enabled' : 'disabled'],
			[
				'Webhook',
				config.webhookUrl
					? `configured (${enabledEvents.length > 0 ? enabledEvents.join(', ') : 'quiet'})`
					: 'disabled',
			],
			['Captcha', CaptchaProviderRegistry.labelFor(Config.captchaOptions(config))],
			['Cache', config.cache.enabled ? config.cache.directory : 'disabled'],
			['Build', config.buildNumber ? String(config.buildNumber) : 'auto-detect'],
		];
	}
}

