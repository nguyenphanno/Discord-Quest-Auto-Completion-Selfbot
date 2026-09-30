/**
 * @file Validation, masking and preflight rows for a loaded config.
 */

import { CaptchaProviderRegistry } from '../captcha/providers/registry';
import type { QuestBotConfig, ValidationReport } from './schema';

function captchaOptions(config: QuestBotConfig) {
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

export function configErrors(config: QuestBotConfig): string[] {
	const errors: string[] = [];
	if (!config.token) {
		errors.push('TOKEN is missing. Add it to .env or to the TOKEN secret.');
	} else {
		if (config.token.startsWith('Bot ')) {
			errors.push('TOKEN starts with "Bot ". Paste the raw user token without that prefix.');
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
	if (config.proxyUrl) {
		try {
			const parsed = new URL(config.proxyUrl);
			if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol)) {
				errors.push('PROXY_URL must use http, https, socks4 or socks5.');
			}
		} catch {
			errors.push('PROXY_URL is not a valid URL.');
		}
	}
	return errors;
}

export function configWarnings(config: QuestBotConfig): string[] {
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

export function configNotices(config: QuestBotConfig): string[] {
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

export function configReport(config: QuestBotConfig): ValidationReport {
	return {
		errors: configErrors(config),
		warnings: configWarnings(config),
		notices: configNotices(config),
	};
}

export function maskToken(token: string): string {
	if (!token) {
		return '<missing>';
	}
	if (token.length <= 12) {
		return `${token.slice(0, 2)}${'*'.repeat(Math.max(0, token.length - 2))}`;
	}
	return `${token.slice(0, 6)}${'*'.repeat(8)}${token.slice(-4)}`;
}

export function describeConfig(config: QuestBotConfig): Array<[string, string]> {
	const events = config.webhookEvents;
	const enabledEvents = (['completed', 'failed', 'summary'] as const).filter(
		(name) => events[name],
	);
	return [
		['Token', maskToken(config.token)],
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
		['Captcha', CaptchaProviderRegistry.labelFor(captchaOptions(config))],
		[
			'Cache',
			config.cache.enabled
				? `${config.cache.directory}${config.cache.skipSettled ? ' (skip settled)' : ''}`
				: 'disabled',
		],
		['Proxy', config.proxyUrl ? 'configured' : 'disabled'],
		['Watch', config.watchPollMs > 0 ? `${config.watchPollMs}ms` : 'off'],
		['Build', config.buildNumber ? String(config.buildNumber) : 'auto-detect'],
	];
}
