import { describe, expect, it } from 'vitest';

import {
	configErrors,
	configReport,
	describeConfig,
	maskToken,
} from '../../../src/config/describe';
import { loadConfig } from '../../../src/config/load';
import { Constants } from '../../../src/discord/constants';

const TOKEN = 'aaa.bbb.ccc';
const WEBHOOK = 'https://discord.com/api/webhooks/1/x';

describe('loadConfig', () => {
	it('defaults the quest concurrency to 2', () => {
		expect(loadConfig({ TOKEN }).concurrency).toBe(2);
	});

	it('keeps 0 as "unbounded" when the operator sets it explicitly', () => {
		expect(loadConfig({ TOKEN, QUEST_CONCURRENCY: '0' }).concurrency).toBe(0);
	});

	it('falls back to the default for a non numeric concurrency', () => {
		expect(loadConfig({ TOKEN, QUEST_CONCURRENCY: 'many' }).concurrency).toBe(2);
	});

	it('parses comma and space separated quest id lists', () => {
		const config = loadConfig({ TOKEN, QUEST_INCLUDE: '1, 2 3', QUEST_EXCLUDE: '4,5' });
		expect(config.includeQuestIds).toEqual(['1', '2', '3']);
		expect(config.excludeQuestIds).toEqual(['4', '5']);
	});

	it('accepts only Discord webhook URLs', () => {
		expect(loadConfig({ TOKEN, WEBHOOK_URL: WEBHOOK }).webhookUrl).toBe(WEBHOOK);
		expect(loadConfig({ TOKEN, WEBHOOK_URL: 'https://example.com/hook' }).webhookUrl).toBeNull();
	});

	it('defaults every webhook event to enabled', () => {
		expect(loadConfig({ TOKEN }).webhookEvents).toEqual({
			completed: true,
			failed: true,
			summary: true,
		});
	});

	it('disables every webhook event for WEBHOOK_EVENTS=none', () => {
		expect(loadConfig({ TOKEN, WEBHOOK_EVENTS: 'none' }).webhookEvents).toEqual({
			completed: false,
			failed: false,
			summary: false,
		});
	});

	it('keeps only the named webhook events', () => {
		expect(loadConfig({ TOKEN, WEBHOOK_EVENTS: 'failed' }).webhookEvents).toEqual({
			completed: false,
			failed: true,
			summary: false,
		});
	});

	it('reads the documented truthy and falsy values', () => {
		expect(loadConfig({ TOKEN, DRY_RUN: 'yes' }).dryRun).toBe(true);
		expect(loadConfig({ TOKEN, DRY_RUN: 'on' }).dryRun).toBe(true);
		expect(loadConfig({ TOKEN, DRY_RUN: 'off' }).dryRun).toBe(false);
		expect(loadConfig({ TOKEN, DRY_RUN: 'nonsense' }).dryRun).toBe(false);
	});

	it('exposes the v2 expansions with their defaults', () => {
		const config = loadConfig({ TOKEN });
		expect(config.watchPollMs).toBe(0);
		expect(config.proxyUrl).toBeNull();
		expect(config.cache.skipSettled).toBe(false);
		expect(config.reportDirectory).toBe('reports');
		expect(config.enrollCooldownMs).toBe(45 * 60 * 1000);
	});

	it('reads the v2 environment keys', () => {
		const config = loadConfig({
			TOKEN,
			WATCH_POLL_MS: '600000',
			PROXY_URL: 'http://127.0.0.1:8080',
			CACHE_SKIP_SETTLED: 'true',
			CACHE_DIR: '.state',
			REPORT_DIR: 'artifacts',
			ENROLL_COOLDOWN_MS: '60000',
		});
		expect(config.watchPollMs).toBe(600_000);
		expect(config.proxyUrl).toBe('http://127.0.0.1:8080');
		expect(config.cache.skipSettled).toBe(true);
		expect(config.cache.directory).toBe('.state');
		expect(config.reportDirectory).toBe('artifacts');
		expect(config.enrollCooldownMs).toBe(60_000);
	});

	it('defaults the request fingerprint to the frozen constants', () => {
		const config = loadConfig({ TOKEN });
		expect(config.headers.timezone).toBe(Constants.DEFAULT_TIMEZONE);
		expect(config.headers.discordLocale).toBe(Constants.DEFAULT_DISCORD_LOCALE);
		expect(config.headers.acceptLanguage).toBe(Constants.DEFAULT_ACCEPT_LANGUAGE);
	});

	it('honours header overrides', () => {
		const config = loadConfig({
			TOKEN,
			DISCORD_TIMEZONE: 'Europe/Berlin',
			DISCORD_LOCALE: 'de',
			DISCORD_ACCEPT_LANGUAGE: 'de-DE',
		});
		expect(config.headers).toEqual({
			timezone: 'Europe/Berlin',
			discordLocale: 'de',
			acceptLanguage: 'de-DE',
		});
	});

	it('detects CI sessions', () => {
		expect(loadConfig({ TOKEN, GITHUB_ACTIONS: 'true' }).isCi).toBe(true);
		expect(loadConfig({ TOKEN, CI: '1' }).isCi).toBe(true);
		expect(loadConfig({ TOKEN }).isCi).toBe(false);
	});

	it('clamps the HTTP tuning to sane minimums', () => {
		const config = loadConfig({ TOKEN, HTTP_TIMEOUT_MS: '1', HTTP_RETRIES: '-4' });
		expect(config.http.timeoutMs).toBe(20_000);
		expect(config.http.retries).toBe(2);
	});
});

describe('loadConfig robustness', () => {
	it('reads the real process.env without throwing', () => {
		// Regression: parsing the whole environment as a Zod record failed
		// because `process.env` is a host object, not a plain record, which
		// surfaced as a raw stack before the CANNOT START panel could render.
		expect(() => loadConfig(process.env)).not.toThrow();
	});

	it('tolerates a missing .env by falling back to the defaults', () => {
		const config = loadConfig({} as NodeJS.ProcessEnv);
		expect(config.token).toBe('');
		expect(config.concurrency).toBe(2);
		expect(config.reportDirectory).toBe('reports');
	});

	it('ignores non string values instead of crashing', () => {
		const hostile = { TOKEN: 42, QUEST_CONCURRENCY: {}, DRY_RUN: [] } as unknown as NodeJS.ProcessEnv;
		expect(() => loadConfig(hostile)).not.toThrow();
		expect(loadConfig(hostile).token).toBe('');
	});

	it('treats a whitespace-only value as unset', () => {
		const config = loadConfig({ TOKEN: '   ', QUEST_CONCURRENCY: '  ' } as NodeJS.ProcessEnv);
		expect(config.token).toBe('');
		expect(config.concurrency).toBe(2);
	});

	it('trims the token it does receive', () => {
		expect(loadConfig({ TOKEN: '  aaa.bbb.ccc  ' } as NodeJS.ProcessEnv).token).toBe('aaa.bbb.ccc');
	});
});

describe('configErrors', () => {
	it('reports a missing token', () => {
		expect(configErrors(loadConfig({ TOKEN: '' })).join('\n')).toMatch(/TOKEN is missing/);
	});

	it('rejects a Bot prefixed token', () => {
		expect(configErrors(loadConfig({ TOKEN: 'Bot a.b.c' })).join('\n')).toMatch(
			/starts with "Bot "/,
		);
	});

	it('rejects an MFA login token', () => {
		expect(configErrors(loadConfig({ TOKEN: 'MFA.abcdef' })).join('\n')).toMatch(
			/MFA login token/,
		);
	});

	it('rejects a token without three segments', () => {
		expect(configErrors(loadConfig({ TOKEN: 'abcdef' })).join('\n')).toMatch(
			/does not look like a valid Discord token/,
		);
	});

	it('accepts a well formed token', () => {
		expect(configErrors(loadConfig({ TOKEN }))).toEqual([]);
	});

	it('rejects a non Discord webhook URL', () => {
		const config = { ...loadConfig({ TOKEN }), webhookUrl: 'https://example.com/hook' };
		expect(configErrors(config).join('\n')).toMatch(/WEBHOOK_URL is not a Discord webhook URL/);
	});

	it('rejects an unparseable proxy URL', () => {
		const config = { ...loadConfig({ TOKEN }), proxyUrl: 'not-a-url' };
		expect(configErrors(config).join('\n')).toMatch(/PROXY_URL is not a valid URL/);
	});

	it('rejects a proxy URL with an unsupported scheme', () => {
		const config = { ...loadConfig({ TOKEN }), proxyUrl: 'ftp://127.0.0.1' };
		expect(configErrors(config).join('\n')).toMatch(
			/PROXY_URL must use http, https, socks4 or socks5/,
		);
	});

	it('accepts a socks5 proxy URL', () => {
		const config = { ...loadConfig({ TOKEN }), proxyUrl: 'socks5://127.0.0.1:1080' };
		expect(configErrors(config)).toEqual([]);
	});
});

describe('configReport', () => {
	it('warns about a dry run and about running on CI', () => {
		const report = configReport(loadConfig({ TOKEN, DRY_RUN: 'true', GITHUB_ACTIONS: 'true' }));
		expect(report.warnings.join('\n')).toMatch(/DRY_RUN is enabled/);
		expect(report.warnings.join('\n')).toMatch(/Acceptable Use Policy/);
	});

	it('warns when several captcha providers are configured', () => {
		const report = configReport(
			loadConfig({ TOKEN, CAPSOLVER_API_KEY: 'a', CAPMONSTER_API_KEY: 'b' }),
		);
		expect(report.warnings.join('\n')).toMatch(/Multiple captcha providers/);
	});

	it('never warns about a single well known provider', () => {
		const report = configReport(loadConfig({ TOKEN, CAPSOLVER_API_KEY: 'a' }));
		expect(report.warnings.join('\n')).not.toMatch(/Multiple captcha providers/);
	});

	it('warns when YesCaptcha is configured', () => {
		const report = configReport(loadConfig({ TOKEN, YES_CAPTCHA_API_KEY: 'key' }));
		expect(report.warnings.join('\n')).toMatch(/YesCaptcha is configured/);
	});

	it('notices a missing webhook, a missing captcha provider and unlimited concurrency', () => {
		const report = configReport(loadConfig({ TOKEN, QUEST_CONCURRENCY: '0' }));
		expect(report.notices.join('\n')).toMatch(/WEBHOOK_URL is not set/);
		expect(report.notices.join('\n')).toMatch(/No captcha provider configured/);
		expect(report.notices.join('\n')).toMatch(/Concurrency is unlimited/);
	});
});

describe('maskToken', () => {
	it('keeps only a short prefix and suffix', () => {
		expect(maskToken('abcdefghijklmnopqrst')).toBe('abcdef********qrst');
	});

	it('masks short tokens completely', () => {
		expect(maskToken('short')).toBe('sh***');
	});

	it('reports a missing token without echoing anything', () => {
		expect(maskToken('')).toBe('<missing>');
	});
});

describe('describeConfig', () => {
	it('renders the masked token and the runtime mode', () => {
		const rows = new Map(
			describeConfig(loadConfig({ TOKEN, DRY_RUN: 'true', QUEST_CONCURRENCY: '0' })),
		);
		expect(rows.get('Token')).toBe('aa*********');
		expect(rows.get('Mode')).toBe('dry run (no writes)');
		expect(rows.get('Concurrency')).toBe('unlimited');
		expect(rows.get('Watch')).toBe('off');
		expect(rows.get('Proxy')).toBe('disabled');
		expect(rows.get('Webhook')).toBe('disabled');
		expect(rows.get('Cache')).toBe('.cache');
		expect(rows.get('Build')).toBe('auto-detect');
	});

	it('renders the enabled integrations', () => {
		const rows = new Map(
			describeConfig(
				loadConfig({
					TOKEN,
					WEBHOOK_URL: WEBHOOK,
					PROXY_URL: 'http://127.0.0.1:8080',
					WATCH_POLL_MS: '1000',
					CAPSOLVER_API_KEY: 'key',
					CACHE_SKIP_SETTLED: 'true',
					CLIENT_BUILD_NUMBER: '539951',
				}),
			),
		);
		expect(rows.get('Webhook')).toBe('configured (completed, failed, summary)');
		expect(rows.get('Proxy')).toBe('configured');
		expect(rows.get('Watch')).toBe('1000ms');
		expect(rows.get('Captcha')).toMatch(/CapSolver/);
		expect(rows.get('Cache')).toBe('.cache (skip settled)');
		expect(rows.get('Build')).toBe('539951');
	});
});

