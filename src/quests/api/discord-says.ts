/**
 * @file `discordsays.com` activity bridge.
 *
 * ACHIEVEMENT_IN_ACTIVITY quests cannot be finished through the public REST
 * surface alone: the user has to authorize the quest application, the activity
 * proxy then exchanges that authorization code for an activity token, and the
 * progress is finally reported back through the same proxy.
 */

import type { HttpConfig } from '../../config/schema';
import type { ClientQuest } from '../../discord/client';
import { Constants } from '../../discord/constants';
import type { OAuth2TokenInfo, ProxyTicket } from '../model/types';
import { Logger } from '../../ui/logger';
import { DiscordHeaders } from '../../discord/headers';
import { Http } from '../../shared/http';

export interface ActivityAuthorization {
	/** Activity token, `null` when the exchange failed. */
	token: string | null;
	/** Failure reason when the exchange failed. */
	error: string | null;
	/** Referrer that must accompany the progress call. */
	activityReferrer: string;
}

export class DiscordSaysService {
	private readonly log = new Logger('activity');

	constructor(
		private readonly client: ClientQuest,
		private readonly http: HttpConfig,
	) {}

	private get requestOptions() {
		return {
			timeoutMs: this.http.timeoutMs,
			retries: this.http.retries,
			retryDelayMs: this.http.retryDelayMs,
			scope: 'http',
			quiet: true,
		};
	}

	/** Temporary ticket authorising the activity to act on the user's behalf. */
	async getProxyTicket(applicationId: string): Promise<string> {
		const ticket = (await this.client.rest.post(
			Constants.Endpoints.proxyTickets(applicationId),
			{ body: {} },
		)) as ProxyTicket;
		this.log.debug(`Proxy ticket acquired for application ${applicationId}`);
		return ticket.ticket;
	}

	/** Referrer URL that identifies the activity instance to the proxy. */
	async getActivityReferrer(applicationId: string): Promise<string> {
		const proxyTicket = await this.getProxyTicket(applicationId);
		const referrer = new URL(`https://${applicationId}.discordsays.com/`);
		referrer.searchParams.set('instance_id', 'example-cl-instance');
		referrer.searchParams.set('platform', 'desktop');
		referrer.searchParams.set('discord_proxy_ticket', proxyTicket);
		return referrer.toString();
	}

	/** Headers the activity proxy expects on every call. */
	getActivityHeaders(
		questId: string,
		authToken = '',
		activityReferrer?: string,
	): Record<string, string> {
		return DiscordHeaders.activity(questId, authToken, activityReferrer);
	}

	/** Exchanges the OAuth code for an activity token. */
	async authorize(
		applicationId: string,
		questId: string,
		authCode: string,
	): Promise<ActivityAuthorization> {
		let activityReferrer = '';
		try {
			activityReferrer = await this.getActivityReferrer(applicationId);
		} catch (error) {
			return {
				token: null,
				error: `Failed to obtain an activity referrer: ${error instanceof Error ? error.message : String(error)}`,
				activityReferrer: '',
			};
		}

		const headers = DiscordHeaders.merge(
			DiscordHeaders.desktop(false, false),
			new Headers(this.getActivityHeaders(questId, '', activityReferrer)),
		);

		try {
			const payload = await Http.json<{ token: string }>(
				Constants.Endpoints.discordSaysAuthorize(applicationId),
				{
					method: 'POST',
					body: JSON.stringify({ code: authCode }),
					headers,
				},
				{ ...this.requestOptions, label: `POST ${applicationId}.discordsays.com/authorize` },
			);
			if (!payload.token) {
				return {
					token: null,
					error: 'Activity authorize response did not include a token',
					activityReferrer,
				};
			}
			return { token: payload.token, error: null, activityReferrer };
		} catch (error) {
			return {
				token: null,
				error: error instanceof Error ? error.message : String(error),
				activityReferrer,
			};
		}
	}

	/** Reports the quest progress to the activity proxy. */
	async progress(
		applicationId: string,
		questId: string,
		token: string,
		questTarget: number,
		activityReferrer: string,
	): Promise<{ success: boolean; error: string | null }> {
		const headers = DiscordHeaders.merge(
			DiscordHeaders.desktop(false, false),
			new Headers(this.getActivityHeaders(questId, token, activityReferrer)),
		);

		try {
			await Http.text(
				Constants.Endpoints.discordSaysProgress(applicationId),
				{
					method: 'POST',
					body: JSON.stringify({ progress: questTarget }),
					headers,
				},
				{
					...this.requestOptions,
					label: `POST ${applicationId}.discordsays.com/quest/progress`,
				},
			);
			return { success: true, error: null };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/** Lists the applications the user currently authorized. */
	async listAuthorizedTokens(): Promise<OAuth2TokenInfo[]> {
		return (await this.client.rest.get(
			Constants.Endpoints.oauthTokens,
		)) as OAuth2TokenInfo[];
	}

	/** Revokes an application authorization, ignoring "already gone" errors. */
	async deauthorize(tokenId: string, applicationName: string): Promise<boolean> {
		try {
			await this.client.rest.delete(`${Constants.Endpoints.oauthTokens}/${tokenId}`);
			this.log.info(`Deauthorized application ${applicationName}`);
			return true;
		} catch (error) {
			this.log.warn(
				`Failed to deauthorize application ${applicationName}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}
}
