/**
 * @file Discord REST adapter for the `QuestApi` port.
 *
 * Every protocol detail lives here so the handlers and the engine stay
 * transport agnostic: endpoints, the Android header, the desktop cipher pool
 * used on the claim route, and the hCaptcha retry all belong to this layer.
 */

import { CaptchaService } from '../../captcha/service';
import { getClaimDispatcher } from '../../discord/client';
import type { ClientQuest } from '../../discord/client';
import { Constants } from '../../discord/constants';
import { Async } from '../../shared/async';
import { AppError } from '../../shared/errors';
import { Logger } from '../../ui/logger';
import type { Quest } from '../model/quest';
import type {
	AllQuestsResponse,
	ClaimedQuest,
	OAuth2TokenInfo,
	Quest as QuestShape,
	QuestUserStatus,
} from '../model/types';
import type { QuestApi } from './quest-api';

export class DiscordQuestApi implements QuestApi {
	private readonly log = new Logger('quest-api');

	constructor(private readonly client: ClientQuest) {}

	async fetchBoard(includeExcluded: boolean): Promise<AllQuestsResponse> {
		const board = (await this.client.rest.get(Constants.Endpoints.quests)) as AllQuestsResponse;
		if (board.quest_enrollment_blocked_until) {
			throw new AppError(
				'ENROLL_BLOCKED',
				`Quest enrollment is blocked until ${board.quest_enrollment_blocked_until}`,
			);
		}
		if (!includeExcluded) {
			return board;
		}
		// Excluded quests are only reachable through their own endpoint, and the
		// account cannot participate in them; they are still useful for listing.
		const resolved = await Promise.all(
			(board.excluded_quests ?? [])
				.filter((quest) => quest.id)
				.map(async ({ id }) => ({
					id,
					config: await this.fetchQuest(id),
					user_status: null,
					preview: false,
				})),
		);
		return { ...board, quests: [...(board.quests ?? []), ...resolved] };
	}

	async fetchQuest(questId: string): Promise<QuestShape['config']> {
		return (await this.client.rest.get(
			Constants.Endpoints.quest(questId),
		)) as QuestShape['config'];
	}

	async enroll(quest: Quest, profile: 'desktop' | 'android'): Promise<QuestUserStatus> {
		const android = profile === 'android';
		return (await this.client.rest.post(Constants.Endpoints.enroll(quest.id), {
			body: {
				location: android
					? Constants.QuestContentType.QUEST_HOME_MOBILE
					: Constants.QuestContentType.QUEST_HOME_DESKTOP,
				is_targeted: false,
				metadata_sealed: null,
				traffic_metadata_raw: quest.raw.traffic_metadata_raw,
				traffic_metadata_sealed: quest.raw.traffic_metadata_sealed,
			},
			headers: { [Constants.ANDROID_HEADER]: android ? 'true' : 'false' },
		})) as QuestUserStatus;
	}

	async postVideoProgress(questId: string, timestamp: number): Promise<QuestUserStatus> {
		return (await this.client.rest.post(Constants.Endpoints.videoProgress(questId), {
			body: { timestamp },
		})) as QuestUserStatus;
	}

	async postHeartbeat(
		questId: string,
		body: Record<string, unknown>,
	): Promise<QuestUserStatus> {
		return (await this.client.rest.post(Constants.Endpoints.heartbeat(questId), {
			body,
		})) as QuestUserStatus;
	}

	/**
	 * Claims a reward, transparently solving an hCaptcha challenge when Discord
	 * raises one and a provider is configured.
	 */
	async claimReward(
		quest: Quest,
		captchaHeaders?: Record<string, string>,
	): Promise<ClaimedQuest> {
		return this.attemptClaim(quest, captchaHeaders, 0);
	}

	private async attemptClaim(
		quest: Quest,
		captchaHeaders: Record<string, string> | undefined,
		attempt: number,
	): Promise<ClaimedQuest> {
		const platform = quest.redeemPlatform();
		if (platform === null) {
			throw new AppError('UNSUPPORTED_TASK', `No reward platform advertised for ${quest.name}`);
		}
		try {
			return (await this.client.rest.post(Constants.Endpoints.claimReward(quest.id), {
				body: {
					platform,
					location: Constants.QuestContentType.QUEST_HOME_DESKTOP,
					is_targeted: false,
					metadata_raw: null,
					metadata_sealed: null,
					traffic_metadata_raw: quest.raw.traffic_metadata_raw,
					traffic_metadata_sealed: quest.raw.traffic_metadata_sealed,
				},
				headers: captchaHeaders,
				dispatcher: getClaimDispatcher(),
			})) as ClaimedQuest;
		} catch (error) {
			const rawError = (error as { rawError?: unknown } | null)?.rawError;
			const challenge = CaptchaService.extractChallenge(rawError);
			if (!challenge) {
				throw error;
			}
			if (attempt >= Constants.Tuning.maxRedeemAttempts) {
				throw new AppError(
					'CAPTCHA_REJECTED',
					`Giving up on "${quest.name}" after ${attempt} captcha attempt(s)`,
				);
			}
			this.log.warn(`Captcha required to claim "${quest.name}"; solving and retrying`);
			let headers: Record<string, string>;
			try {
				const solution = await this.client.captcha.solve(challenge);
				headers = solution.headers;
				this.log.debug(`Captcha solved by ${solution.provider}`);
			} catch (captchaError) {
				throw new AppError(
					'CAPTCHA_REJECTED',
					`Captcha solving failed for "${quest.name}": ${Async.errorMessage(captchaError)}`,
				);
			}
			return this.attemptClaim(quest, headers, attempt + 1);
		}
	}

	/**
	 * `ACHIEVEMENT_IN_ACTIVITY`: authorize the quest application, exchange the
	 * code for an activity token through the discordsays proxy, report progress
	 * and then revoke the authorization again.
	 */
	async completeActivity(questId: string, applicationId: string, target: number): Promise<void> {
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: applicationId,
			scope: 'identify applications.commands applications.entitlements',
			state: '',
		});
		const authorization = (await this.client.rest.post(Constants.Endpoints.oauthAuthorize, {
			query,
			body: {
				permissions: '0',
				authorize: true,
				integration_type: 1,
				location_context: { guild_id: '10000', channel_id: '10000', channel_type: 10000 },
			},
		})) as { location?: string };
		const code = authorization.location
			? new URL(authorization.location).searchParams.get('code')
			: null;
		if (!code) {
			throw new Error(`No auth code returned for application ${applicationId}`);
		}
		const auth = await this.client.discordSays.authorize(applicationId, questId, code);
		if (!auth.token || auth.error) {
			throw new Error(auth.error ?? `Could not authorize activity ${applicationId}`);
		}
		const progress = await this.client.discordSays.progress(
			applicationId,
			questId,
			auth.token,
			target,
			auth.activityReferrer,
		);
		if (!progress.success || progress.error) {
			throw new Error(progress.error ?? `Could not complete activity ${applicationId}`);
		}
		try {
			const tokens = await this.client.discordSays.listAuthorizedTokens();
			const token = tokens.find(
				(item: OAuth2TokenInfo) => item.application?.id === applicationId,
			);
			if (token) {
				await this.client.discordSays.deauthorize(token.id, applicationId);
			}
		} catch {
			// Revoking the OAuth grant is best effort; the quest is already done.
		}
	}
}

