/**
 * @file `ClientQuest` - the patched Discord client.
 *
 * Two library behaviours are overridden without touching the library itself:
 *
 *  1. `@discordjs/rest` gets a custom `makeRequest` so every outgoing call
 *     carries the impersonated client fingerprint instead of a bot token.
 *  2. `WebSocketShard#send` rewrites the gateway `IDENTIFY` payload with the
 *     desktop client properties and an empty intent set.
 */

import { Client, WebhooksAPI } from '@discordjs/core';
import type { APIGatewayBotInfo } from '@discordjs/core';
import type { RequestInit } from 'undici';
import type { ResponseLike } from '@discordjs/rest';
import { DefaultRestOptions, REST, RESTEvents } from '@discordjs/rest';
import type { RateLimitData } from '@discordjs/rest';
import { WebSocketManager, WebSocketShard } from '@discordjs/ws';
import { GatewayOpcodes } from 'discord-api-types/v10';
import type { GatewayIdentifyData, GatewaySendPayload } from 'discord-api-types/v10';

import type { QuestBotConfig } from './_config';
import { Constants } from './_constants';
import { QuestManager } from '../domain/_quest-manager';
import type { AllQuestsResponse } from '../domain/_types';
import { BuildInfo } from '../services/_build-info';
import { CaptchaService } from '../services/_captcha';
import { DiscordSaysService } from '../services/_discord-says';
import { WebhookReporter } from '../services/_reporter';
import { Logger } from '../ui/_logger';
import { Async } from '../utils/_async';
import { DiscordHeaders } from '../core/_headers';
import type { HeaderProfile } from '../core/_headers';

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

const originalShardSend = WebSocketShard.prototype.send;

/** Rewrites the IDENTIFY payload so the gateway sees a desktop client. */
WebSocketShard.prototype.send = async function (payload: GatewaySendPayload) {
	if (payload.op === GatewayOpcodes.Identify) {
		payload.d = {
			token: payload.d.token,
			properties: {
				...Constants.Properties,
				is_fast_connect: false,
				gateway_connect_reasons: 'AppSkeleton',
			},
			capabilities: 0,
			presence: payload.d.presence,
			compress: payload.d.compress,
			client_state: {
				guild_versions: {},
			},
		} as unknown as GatewayIdentifyData;
	}
	return originalShardSend.call(this, payload);
};

export class ClientQuest extends Client {
	/** Populated by `fetchQuests`. */
	public questManager: QuestManager | null = null;
	public readonly websocketManager: WebSocketManager;
	/** Legacy webhook API handle kept for API compatibility. */
	public readonly webhook = new WebhooksAPI(new REST());
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
		this.discordSays = new DiscordSaysService(this, config.http);
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
		await QuestManager.closeDispatcher();
	}

	/** Loads `GET /quests/@me` into a fresh `QuestManager`. */
	async fetchQuests(fetchExcludedQuests = false): Promise<QuestManager> {
		this.log.debug('Fetching quests from /quests/@me');
		const response = (await this.rest.get(Constants.Endpoints.quests)) as AllQuestsResponse;
		const manager = await QuestManager.fromResponse(this, response, fetchExcludedQuests, {
			maxRedeemAttempts: Constants.Tuning.maxRedeemAttempts,
			dryRun: this.config.dryRun,
		});
		this.questManager = manager;
		const stats = manager.stats();
		this.log.debug(
			`Quest cache loaded: ${stats.total} total, ${stats.pending} pending, ${stats.claimable} claimable`,
		);
		return manager;
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

