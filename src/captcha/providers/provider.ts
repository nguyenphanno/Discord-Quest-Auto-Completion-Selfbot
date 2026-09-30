/**
 * @file Captcha provider contracts.
 *
 * Discord raises an hCaptcha challenge when it suspects a reward claim is
 * automated. A provider turns that challenge into a token that can be replayed
 * as `x-captcha-key`. Several vendors are supported; every one of them
 * implements the same small interface so the rest of the code base never has to
 * know which service answered.
 */

/** Everything a provider needs to solve a challenge. */
export interface CaptchaChallenge {
	/** hCaptcha site key taken from the rejected request. */
	sitekey: string;
	/** Page the challenge was issued for. */
	url: string;
	/** Challenge service, only hCaptcha is currently issued by Discord. */
	service: 'hcaptcha';
	/** Opaque data Discord attaches to the challenge. */
	rqdata?: string;
	/** Session id of the challenge. */
	sessionId?: string;
	/** Token that ties the solution back to the challenge. */
	rqtoken?: string;
	/** Whether the challenge was rendered invisibly. */
	isInvisible?: boolean;
	/** User agent that must be replayed with the token. */
	userAgent?: string;
}

/** A solved challenge. */
export interface CaptchaSolution {
	/** The token to send back to Discord. */
	token: string;
	/** Identifier of the provider that solved the challenge. */
	provider: string;
	/** User agent the vendor wants replayed with the token. */
	userAgent?: string;
}

/** Everything the registry can rely on. */
export interface CaptchaProvider {
	/** Stable identifier used in `CAPTCHA_PROVIDER`. */
	readonly id: string;
	/** Human readable name used in logs and documentation. */
	readonly label: string;
	/** Whether the provider can run without credentials. */
	readonly requiresCredentials: boolean;
	/** Solves the challenge. */
	solveHcaptcha(challenge: CaptchaChallenge): Promise<CaptchaSolution>;
	/** Optional account balance lookup. */
	getBalance?(): Promise<number | null>;
	/** One line description for the preflight block. */
	describe(): string;
}

/** Raised when a provider cannot solve a challenge. */
export class CaptchaProviderError extends Error {
	constructor(
		message: string,
		readonly providerId: string,
		readonly code?: string,
	) {
		super(message);
		this.name = 'CaptchaProviderError';
	}
}

/** Raised when a provider did not answer before the deadline. */
export class CaptchaTimeoutError extends CaptchaProviderError {
	constructor(providerId: string, taskId: string, timeoutMs: number) {
		super(
			`Task ${taskId} was not solved within ${Math.round(timeoutMs / 1000)}s`,
			providerId,
			'TIMEOUT',
		);
		this.name = 'CaptchaTimeoutError';
	}
}

/** Shared tuning for task-based and polling providers. */
export interface CaptchaProviderOptions {
	/** Delay between two result polls. */
	pollIntervalMs?: number;
	/** Hard limit for a single challenge. */
	timeoutMs?: number;
	/** Per-request timeout. */
	requestTimeoutMs?: number;
}

export const CAPTCHA_DEFAULTS = {
	pollIntervalMs: 3_000,
	timeoutMs: 120_000,
	requestTimeoutMs: 20_000,
} as const;

/** Normalises the caller supplied options against the defaults. */
export function resolveOptions(
	options: CaptchaProviderOptions = {},
): Required<CaptchaProviderOptions> {
	return {
		pollIntervalMs: options.pollIntervalMs ?? CAPTCHA_DEFAULTS.pollIntervalMs,
		timeoutMs: options.timeoutMs ?? CAPTCHA_DEFAULTS.timeoutMs,
		requestTimeoutMs: options.requestTimeoutMs ?? CAPTCHA_DEFAULTS.requestTimeoutMs,
	};
}

/** Reads a vendor error out of a loosely typed response. */
export interface CaptchaWireResponse {
	errorId?: number | string;
	errorCode?: string | number | null;
	errorDescription?: string | null;
	status?: string;
	taskId?: string | number;
	solution?: Record<string, unknown>;
	balance?: number | string;
	request?: string | number;
}

/** Extracts the balance from a vendor response, tolerating strings. */
export function readBalance(response: CaptchaWireResponse): number | null {
	const raw = response.balance ?? response.request;
	if (raw === undefined || raw === null) {
		return null;
	}
	const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
	return Number.isFinite(value) ? value : null;
}
