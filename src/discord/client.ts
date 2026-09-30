/**
 * @file `ClientQuest` - the patched Discord client.
 *
 * Three library behaviours are overridden without touching the library itself:
 *
 *  1. `@discordjs/rest` gets a custom `makeRequest` so every outgoing call
 *     carries the impersonated client fingerprint instead of a bot token.
 *  2. The gateway `IDENTIFY` payload is rewritten by `installIdentifyPatch()`
 *     (see `gateway.ts`) with the desktop properties and an empty intent set.
 *  3. Reward claims go through a dedicated undici pool that replays the desktop
 *     cipher order, because Discord rejects the default Node ordering there.
 */

import { Client } from '@discordjs/core';
import type { APIGatewayBotInfo } from '@discordjs/core';
import type { RequestInit } from 'undici';
import { buildConnector, Client as UndiciClient } from 'undici';
import type { ResponseLike } from '@discordjs/rest';
import { DefaultRestOptions, REST, RESTEvents } from '@discordjs/rest';
import type { RateLimitData } from '@discordjs/rest';
import { WebSocketManager } from '@discordjs/ws';

import type { QuestBotConfig } from '../config/schema';
import { CaptchaService } from '../captcha/service';
import { DiscordSaysService } from '../quests/api/discord-says';
import { WebhookReporter } from '../reporting/webhook-reporter';
import { Logger } from '../ui/logger';
import { Async } from '../shared/async';
import { Constants } from './constants';
import { BuildInfo } from './build-info';
import { DiscordHeaders } from './headers';
import type { HeaderProfile } from './headers';
import { installIdentifyPatch } from './gateway';

/** Header profile applied to every REST call; set once by the constructor. */
let activeHeaderProfile: Required<HeaderProfile> = {
	acceptLanguage: Constants.DEFAULT_ACCEPT_LANGUAGE,
	discordLocale: Constants.DEFAULT_DISCORD_LOCALE,
	timezone: Constants.DEFAULT_TIMEZONE,
};

/** Swaps the bot token scheme for the raw user token and adds the fingerprint. */
async function makeRequest(url: string, init: RequestInit): Promise<ResponseLike> {
	return DefaultRestOptions.makeRequest(
		url,
		DiscordHeaders.applyToRestRequest(init, activeHeaderProfile),
	);
}

/** Shared claim pool; created lazily so a read-only run never opens it. */
let claimDispatcher: UndiciClient | null = null;

/** Undici pool replaying the desktop cipher order on `claim-reward`. */
export function getClaimDispatcher(): UndiciClient {
	if (!claimDispatcher) {
		claimDispatcher = new UndiciClient(Constants.ORIGIN, {
			connect: buildConnector({ ciphers: Constants.TLS_CIPHERS }),
		});
	}
	return claimDispatcher;
}

/** Releases the shared claim pool during shutdown. */
export async function closeClaimDispatcher(): Promise<void> {
	const dispatcher = claimDispatcher;
	claimDispatcher = null;
	if (dispatcher) {
		await dispatcher.close().catch(() => undefined);
	}
}

export class ClientQuest extends Client {
	public readonly websocketManager: WebSocketManager;
	public readonly captcha: CaptchaService;
	public readonly discordSays: DiscordSaysService;
	public readonly reporter: WebhookReporter;
	public readonly config: QuestBotConfig;

	private readonly log = new Logger('client');
	private destroyed = false;

	constructor(config: QuestBotConfig) {
		if (!config.token) {
			throw new Error('A token is required to initialise the client.');
		}

		// Patching the shard prototype is process wide, so it happens once here
		// instead of at module import time (which would leak into unit tests).
		installIdentifyPatch();

		activeHeaderProfile = config.headers;

		const rest = new REST({ version: Constants.API_VERSION, makeRequest }).setToken(
			config.token,
		);
		rest.on(RESTEvents.RateLimited, (info: RateLimitData) => {
			this.log.warn(
				[
					`Rate limited on ${info.method} ${info.route}`,
					`scope: ${info.scope}${info.global ? ' (global)' : ''}`,
					`limit: ${info.limit} requests`,
					`retry after: ${info.retryAfter}ms (${(info.retryAfter / 1000).toFixed(2)}s)`,
				].join('\n'),
			);
		});

		const gateway = new WebSocketManager({
			token: config.token,
			intents: 0,
			rest,
			readyTimeout: 120_000,
		});
		// The public gateway endpoint is used verbatim; the shard count is fixed
		// to one because a user account is never sharded.
		gateway.fetchGatewayInformation = (): Promise<APIGatewayBotInfo> =>
			Promise.resolve({
				url: Constants.GATEWAY_URL,
				shards: 1,
				session_start_limit: {
					total: 1000,
					remaining: 1000,
					reset_after: 14_400_000,
					max_concurrency: Constants.FALLBACK_GATEWAY_MAX_CONCURRENCY,
				},
			});

		super({ rest, gateway });

		this.websocketManager = gateway;
		this.config = config;
		this.captcha = new CaptchaService({
			providerId: config.captcha.provider,
			credentials: config.captcha.credentials,
			allowManual: config.captcha.allowManual,
			pollIntervalMs: config.captcha.pollIntervalMs,
			timeoutMs: config.captcha.timeoutMs,
		});
		this.discordSays = new DiscordSaysService(this as never, config.http);
		this.reporter = new WebhookReporter(config.webhookUrl, config.webhookEvents);

		gateway.on('error', (error: unknown) => {
			this.log.debug(`Gateway error: ${Async.errorMessage(error)}`);
		});
	}

	/**
	 * Resolves the client build number (config override wins) and validates the
	 * webhook, then opens the gateway connection.
	 */
	async connect(): Promise<void> {
		const preflight = await Promise.allSettled([
			this.resolveBuildNumber(),
			this.reporter.resolve(),
		]);
		preflight.forEach((result) => {
			if (result.status === 'rejected') {
				this.log.debug(`Preflight step failed: ${Async.errorMessage(result.reason)}`);
			}
		});

		try {
			await this.websocketManager.connect();
		} catch (error) {
			// The caller reports the full failure with its stack; keep this line
			// concise so the same error is not printed twice with two traces.
			this.log.error(`Failed to connect to the Discord gateway: ${Async.errorMessage(error)}`);
			this.reporter.error(`Gateway connection failed: ${Async.errorMessage(error)}`);
			throw error;
		}
	}

	/** Applies the newest known `client_build_number` to the fingerprint. */
	async resolveBuildNumber(): Promise<number | null> {
		const scraped = await BuildInfo.resolve();
		const applied = this.config.buildNumber ?? scraped;
		if (applied) {
			BuildInfo.apply(applied);
			this.log.debug(`Using client build number ${applied}`);
		}
		return applied;
	}

	/** Closes the gateway connection and the shared claim pool. */
	async destroy(): Promise<void> {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		try {
			await this.websocketManager.destroy();
		} catch (error) {
			this.log.debug(`Gateway shutdown reported: ${Async.errorMessage(error)}`);
		}
		await closeClaimDispatcher();
	}

	/** Sends a plain report through the configured webhook. */
	sendWebhookMessage(content: string): void {
		this.reporter.send(content);
	}

	/** Reports a completed quest. */
	emitQuestCompleted(questId: string, questName?: string): void {
		this.reporter.questCompleted(questId, questName ?? 'a quest');
	}
}

