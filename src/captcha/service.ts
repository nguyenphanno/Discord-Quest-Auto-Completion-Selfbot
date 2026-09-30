/**
 * @file Captcha solving facade.
 *
 * Discord occasionally challenges reward claims with an hCaptcha. This service
 * turns the challenge carried by the rejected request into the headers that
 * unblock the retry, delegating the actual solving to whichever provider the
 * registry selected. When no provider is usable the failure is explicit instead
 * of an opaque rejection.
 */

import type { CaptchaChallenge, CaptchaProvider } from './providers/provider';
import { CaptchaProviderError } from './providers/provider';
import { CaptchaProviderRegistry } from './providers/registry';
import type { ProviderCredentials, ProviderResolution } from './providers/registry';
import { Constants } from '../discord/constants';
import type { CaptchaDataFromRequest } from '../quests/model/types';
import { Logger } from '../ui/logger';

export interface CaptchaServiceOptions {
	/** Explicit provider id (`CAPTCHA_PROVIDER`). */
	providerId?: string | null;
	/** API keys keyed by environment variable name. */
	credentials?: ProviderCredentials;
	/** Allow the interactive stdin provider. */
	allowManual?: boolean;
	/** Delay between result polls. */
	pollIntervalMs?: number;
	/** Hard limit for a single challenge. */
	timeoutMs?: number;
}

/** A solved challenge plus the headers needed to replay the request. */
export interface SolvedCaptcha {
	/** The token Discord must receive. */
	token: string;
	/** Provider that produced the token. */
	provider: string;
	/** Headers to attach to the retried request. */
	headers: Record<string, string>;
}

export class CaptchaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CaptchaError';
	}
}

export class CaptchaService {
	private readonly log = new Logger('captcha');
	private readonly resolution: ProviderResolution;
	private solvedCount = 0;
	private failedCount = 0;

	constructor(options: CaptchaServiceOptions = {}) {
		this.resolution = CaptchaProviderRegistry.resolve({
			providerId: options.providerId,
			credentials: options.credentials,
			allowManual: options.allowManual,
			settings: {
				pollIntervalMs: options.pollIntervalMs,
				timeoutMs: options.timeoutMs,
			},
		});

		if (this.resolution.provider) {
			this.log.info(
				`Captcha solving enabled via ${this.resolution.provider.label} (${this.resolution.provider.id})`,
			);
		} else if (this.resolution.reason) {
			this.log.debug(this.resolution.reason);
		}
	}

	get enabled(): boolean {
		return this.resolution.provider !== null;
	}

	/** Whether a credential was auto-detected rather than pinned explicitly. */
	get detected(): boolean {
		return this.resolution.detected;
	}

	get providerId(): string | null {
		return this.resolution.provider?.id ?? null;
	}

	get providerLabel(): string | null {
		return this.resolution.provider?.label ?? null;
	}

	/** Why no provider is available, when the service is disabled. */
	get unavailableReason(): string | null {
		return this.resolution.reason;
	}

	get stats(): { solved: number; failed: number } {
		return { solved: this.solvedCount, failed: this.failedCount };
	}

	/** Converts the wire challenge into the provider facing shape. */
	static toChallenge(data: CaptchaDataFromRequest): CaptchaChallenge {
		return {
			sitekey: data.captcha_sitekey,
			url: Constants.ORIGIN,
			service: 'hcaptcha',
			rqdata: data.captcha_rqdata,
			sessionId: data.captcha_session_id,
			rqtoken: data.captcha_rqtoken,
			isInvisible: false,
			userAgent: Constants.USER_AGENT,
		};
	}

	/**
	 * Solves the challenge carried by a rejected request.
	 * @throws {CaptchaError} when no provider is available or solving fails.
	 */
	async solve(data: CaptchaDataFromRequest): Promise<SolvedCaptcha> {
		const provider: CaptchaProvider | null = this.resolution.provider;
		if (!provider) {
			throw new CaptchaError(
				this.resolution.reason ??
					'Captcha solving is not configured. Claim the reward manually from the Discord client.',
			);
		}

		try {
			const solution = await provider.solveHcaptcha(CaptchaService.toChallenge(data));
			this.solvedCount++;
			this.log.debug(
				`Solved by ${solution.provider} (token starts with ${solution.token.slice(0, 24)}...)`,
			);
			return {
				token: solution.token,
				provider: solution.provider,
				headers: {
					'x-captcha-key': solution.token,
					'x-captcha-rqtoken': data.captcha_rqtoken,
					'x-captcha-session-id': data.captcha_session_id,
				},
			};
		} catch (error) {
			this.failedCount++;
			if (error instanceof CaptchaProviderError) {
				throw new CaptchaError(`${error.providerId}: ${error.message}`);
			}
			throw new CaptchaError(
				`Captcha solving failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** Provider balance, when the vendor exposes one. */
	async balance(): Promise<number | null> {
		const provider = this.resolution.provider;
		if (!provider?.getBalance) {
			return null;
		}
		return provider.getBalance();
	}

	/** Extracts a captcha challenge from a rejected request, if present. */
	static extractChallenge(rawError: unknown): CaptchaDataFromRequest | null {
		if (!rawError || typeof rawError !== 'object') {
			return null;
		}
		const candidate = rawError as Partial<CaptchaDataFromRequest>;
		if (candidate.captcha_key && candidate.captcha_sitekey) {
			return candidate as CaptchaDataFromRequest;
		}
		return null;
	}
}
