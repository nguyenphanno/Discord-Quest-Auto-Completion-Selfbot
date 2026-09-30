/**
 * @file Webhook reporter.
 *
 * Completions, failures and the end-of-run summary are delivered through a
 * Discord webhook when `WEBHOOK_URL` is configured. Delivery is queued so
 * messages keep their order, and no failure ever propagates into the quest
 * flow - reporting must never break the bot.
 */

import { WebhooksAPI } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import type { WebhookEventsConfig } from '../config/schema';
import { Constants } from '../discord/constants';
import { Logger } from '../ui/logger';
import { Http } from '../shared/http';
import { Time } from '../shared/time';

export class WebhookReporter {
	private readonly log = new Logger('webhook');
	private readonly api = new WebhooksAPI(new REST());
	private webhookId: string | null = null;
	private webhookToken: string | null = null;
	/** Serialises deliveries so messages arrive in the order they were queued. */
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly webhookUrl: string | null = null,
		private readonly events: WebhookEventsConfig = {
			completed: true,
			failed: true,
			summary: true,
		},
	) {}

	/** Whether a webhook URL was supplied at all. */
	get configured(): boolean {
		return Boolean(this.webhookUrl);
	}

	/** Whether the webhook was validated and can receive messages. */
	get enabled(): boolean {
		return this.webhookId !== null && this.webhookToken !== null;
	}

	/** Validates the URL and extracts the id/token pair. Never throws. */
	async resolve(): Promise<boolean> {
		if (!this.webhookUrl) {
			this.log.debug('No WEBHOOK_URL configured; reporting is disabled');
			return false;
		}
		try {
			const response = await Http.request(
				this.webhookUrl,
				{},
				{ scope: 'webhook', quiet: true, retries: 1, label: 'GET webhook' },
			);
			if (!response.ok) {
				this.log.warn(
					`WEBHOOK_URL responded with ${response.status}; reporting is disabled`,
				);
				return false;
			}
		} catch (error) {
			this.log.warn(
				`WEBHOOK_URL could not be reached: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}

		const parts = this.webhookUrl.split('/');
		const index = parts.findIndex((part) => part === 'webhooks');
		if (index === -1 || parts.length < index + 3) {
			this.log.warn('WEBHOOK_URL is malformed; reporting is disabled');
			return false;
		}
		this.webhookId = parts[index + 1] ?? null;
		this.webhookToken = parts[index + 2] ?? null;
		this.log.info('Webhook reporting is ready');
		return true;
	}

	/**
	 * Queues a plain message. Fire-and-forget by design: reporting failures are
	 * logged at debug level only.
	 */
	send(content: string): void {
		if (!this.enabled) {
			return;
		}
		const webhookId = this.webhookId as string;
		const webhookToken = this.webhookToken as string;
		this.queue = this.queue
			.then(() => this.api.execute(webhookId, webhookToken, { content }))
			.then(() => undefined)
			.catch((error: unknown) => {
				this.log.debug(
					`Webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}

	/** `**Quest completed** - Opera GX` followed by the quest link. */
	questCompleted(questId: string, questName: string): void {
		if (!this.events.completed) {
			return;
		}
		this.send(
			[
				`**Quest completed** - ${questName}`,
				`${Constants.questUrl(questId)}`,
				`-# ${Time.stamp()}`,
			].join('\n'),
		);
	}

	/** Failure report for a single quest. */
	questFailed(questName: string, reason: string): void {
		if (!this.events.failed) {
			return;
		}
		this.send([`**Quest failed** - ${questName}`, `\`\`\`${reason}\`\`\``].join('\n'));
	}

	/** End-of-run block built from aligned `label -> value` rows. */
	summary(title: string, rows: ReadonlyArray<readonly [string, string]>): void {
		if (!this.events.summary) {
			return;
		}
		const body = rows.map(([label, value]) => `**${label}** :: ${value}`).join('\n');
		this.send([`__${title}__`, body, `-# ${Time.stamp()}`].join('\n'));
	}

	/**
	 * Unexpected runtime failure (connection lost, fatal error, ...).
	 * Always delivered - failures here are never considered noise.
	 */
	error(message: string): void {
		this.send([`**Runtime error**`, `\`\`\`${message.slice(0, 1_400)}\`\`\``].join('\n'));
	}

	/** Waits until every queued delivery settled. */
	async flush(): Promise<void> {
		await this.queue;
	}
}
