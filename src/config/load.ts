/** Environment loader for the v2 command line application. */
import { z } from 'zod';

import { CaptchaProviderRegistry } from '../captcha/providers/registry';
import { CAPTCHA_DEFAULTS } from '../captcha/providers/provider';
import { Constants } from '../discord/constants';
import { LogLevel, parseLogLevel } from '../ui/logger';
import type { QuestBotConfig } from './schema';

const truthy = new Set(['1', 'true', 'yes', 'on', 'y']);
const falsy = new Set(['0', 'false', 'no', 'off', 'n']);
const envSchema = z.record(z.string(), z.string().optional());

function value(env: NodeJS.ProcessEnv, key: string): string | null {
	const parsed = envSchema.parse(env)[key]?.trim();
	return parsed || null;
}

function boolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
	const raw = value(env, key)?.toLowerCase();
	if (!raw) return fallback;
	if (truthy.has(raw)) return true;
	if (falsy.has(raw)) return false;
	return fallback;
}

function number(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
	const raw = value(env, key);
	const parsed = raw === null ? Number.NaN : Number(raw);
	return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function list(env: NodeJS.ProcessEnv, key: string): string[] {
	return (value(env, key) ?? '').split(/[\s,]+/).filter(Boolean);
}

function webhookEvents(env: NodeJS.ProcessEnv) {
	const items = list(env, 'WEBHOOK_EVENTS').map((item) => item.toLowerCase());
	if (items.includes('none') || items.includes('off')) return { completed: false, failed: false, summary: false };
	if (!items.length || items.includes('all')) return { completed: true, failed: true, summary: true };
	return { completed: items.includes('completed'), failed: items.includes('failed'), summary: items.includes('summary') };
}

/** Resolves configuration without accessing process.env outside this boundary. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): QuestBotConfig {
	const credentials: Record<string, string | null> = {};
	for (const key of CaptchaProviderRegistry.credentialEnvNames()) credentials[key] = value(env, key);
	const configuredBuild = number(env, 'CLIENT_BUILD_NUMBER', Number.NaN, 1);
	const color = value(env, 'LOG_COLOR');
	const configuredWebhook = value(env, 'WEBHOOK_URL');
	const webhookUrl = configuredWebhook && /^https:\/\/discord(app)?\.com\/api(\/v\d+)?\/webhooks\//.test(configuredWebhook) ? configuredWebhook : null;
	return {
		token: value(env, 'TOKEN') ?? '',
		webhookUrl,
		captcha: {
			provider: value(env, 'CAPTCHA_PROVIDER'), allowManual: boolean(env, 'CAPTCHA_MANUAL', false), credentials,
			pollIntervalMs: number(env, 'CAPTCHA_POLL_INTERVAL_MS', CAPTCHA_DEFAULTS.pollIntervalMs, 250),
			timeoutMs: number(env, 'CAPTCHA_TIMEOUT_MS', CAPTCHA_DEFAULTS.timeoutMs, 5_000),
		},
		headers: {
			acceptLanguage: value(env, 'DISCORD_ACCEPT_LANGUAGE') ?? Constants.DEFAULT_ACCEPT_LANGUAGE,
			discordLocale: value(env, 'DISCORD_LOCALE') ?? Constants.DEFAULT_DISCORD_LOCALE,
			timezone: value(env, 'DISCORD_TIMEZONE') ?? Constants.DEFAULT_TIMEZONE,
		},
		logLevel: parseLogLevel(value(env, 'LOG_LEVEL') ?? undefined, LogLevel.Info),
		logJson: boolean(env, 'LOG_JSON', false), logAscii: boolean(env, 'LOG_ASCII', false),
		logColor: color === null ? null : boolean(env, 'LOG_COLOR', true), logTimestamps: boolean(env, 'LOG_TIMESTAMPS', true),
		isCi: boolean(env, 'GITHUB_ACTIONS', false) || boolean(env, 'CI', false), dryRun: boolean(env, 'DRY_RUN', false),
		webhookEvents: webhookEvents(env),
		cache: { enabled: boolean(env, 'CACHE_ENABLED', true), directory: value(env, 'CACHE_DIR') ?? '.cache', skipSettled: boolean(env, 'CACHE_SKIP_SETTLED', false) },
		redeemRewards: boolean(env, 'REDEEM_REWARDS', false), fetchExcludedQuests: boolean(env, 'FETCH_EXCLUDED_QUESTS', false),
		concurrency: number(env, 'QUEST_CONCURRENCY', 2, 0), includeQuestIds: list(env, 'QUEST_INCLUDE'), excludeQuestIds: list(env, 'QUEST_EXCLUDE'),
		http: { timeoutMs: number(env, 'HTTP_TIMEOUT_MS', 20_000, 1_000), retries: number(env, 'HTTP_RETRIES', 2, 0), retryDelayMs: number(env, 'HTTP_RETRY_DELAY_MS', 700, 0) },
		buildNumber: Number.isFinite(configuredBuild) ? configuredBuild : null,
		watchPollMs: number(env, 'WATCH_POLL_MS', 0, 0), proxyUrl: value(env, 'PROXY_URL'),
		reportDirectory: value(env, 'REPORT_DIR') ?? 'reports', enrollCooldownMs: number(env, 'ENROLL_COOLDOWN_MS', 45 * 60 * 1000, 0),
	};
}
