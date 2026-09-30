/**
 * @file 2Captcha - `https://2captcha.com` (legacy `in.php` / `res.php` API).
 *
 * 2Captcha also exposes the newer `createTask` protocol, but its classic API is
 * still the better supported one and is implemented here to prove the provider
 * layer is genuinely pluggable rather than five copies of one client.
 */

import type { CaptchaChallenge, CaptchaProvider, CaptchaProviderOptions, CaptchaSolution } from './provider';
import { CaptchaProviderError, CaptchaTimeoutError, readBalance, resolveOptions } from './provider';
import { Async } from '../../shared/async';
import { Http } from '../../shared/http';

const BASE_URL = 'https://2captcha.com';
const NOT_READY = 'CAPCHA_NOT_READY';

interface ClassicResponse {
	status: 0 | 1;
	request: string;
}

export class TwoCaptchaProvider implements CaptchaProvider {
	readonly id = '2captcha';
	readonly label = '2Captcha';
	readonly requiresCredentials = true;

	private readonly options: Required<CaptchaProviderOptions>;

	constructor(
		private readonly apiKey: string,
		options: CaptchaProviderOptions = {},
	) {
		if (!apiKey) {
			throw new CaptchaProviderError('2Captcha requires an API key', this.id, 'MISSING_KEY');
		}
		this.options = resolveOptions(options);
	}

	private request(options: {
		path: string;
		method: 'GET' | 'POST';
		query?: Record<string, string>;
		body?: Record<string, unknown>;
	}): Promise<ClassicResponse> {
		const url = new URL(`${BASE_URL}${options.path}`);
		url.searchParams.set('key', this.apiKey);
		url.searchParams.set('json', '1');
		for (const [key, value] of Object.entries(options.query ?? {})) {
			url.searchParams.set(key, value);
		}
		return Http.json<ClassicResponse>(
			url.toString(),
			options.method === 'POST'
				? {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ...options.body, json: 1 }),
					}
				: { method: 'GET' },
			{
				timeoutMs: this.options.requestTimeoutMs,
				retries: 1,
				scope: 'captcha',
				quiet: true,
				label: `2captcha ${options.path}`,
			},
		);
	}

	/** Classic API returns `status: 0` with a machine readable reason. */
	private static assertOk(response: ClassicResponse, allowNotReady = false): boolean {
		if (response.status === 1) {
			return true;
		}
		if (allowNotReady && response.request === NOT_READY) {
			return false;
		}
		throw new CaptchaProviderError(
			`2Captcha rejected the request: ${response.request}`,
			'2captcha',
			response.request,
		);
	}

	async solveHcaptcha(challenge: CaptchaChallenge): Promise<CaptchaSolution> {
		const body: Record<string, unknown> = {
			method: 'hcaptcha',
			sitekey: challenge.sitekey,
			pageurl: challenge.url,
		};
		if (challenge.userAgent) {
			body.useragent = challenge.userAgent;
		}
		if (challenge.isInvisible) {
			body.invisible = 1;
		}
		if (challenge.rqdata) {
			body.data = challenge.rqdata;
		}

		const created = await this.request({ path: '/in.php', method: 'POST', body });
		TwoCaptchaProvider.assertOk(created);
		const taskId = created.request;
		if (!taskId) {
			throw new CaptchaProviderError(
				'2Captcha did not return a task id',
				this.id,
				'NO_TASK_ID',
			);
		}

		const deadline = Date.now() + this.options.timeoutMs;
		while (Date.now() < deadline) {
			const result = await this.request({
				path: '/res.php',
				method: 'GET',
				query: { action: 'get', id: taskId },
			});
			if (TwoCaptchaProvider.assertOk(result, true) && result.request) {
				return { token: result.request, provider: this.id };
			}
			await Async.sleep(
				Math.min(this.options.pollIntervalMs, Math.max(0, deadline - Date.now())),
			);
		}

		throw new CaptchaTimeoutError(this.id, taskId, this.options.timeoutMs);
	}

	async getBalance(): Promise<number | null> {
		try {
			const response = await this.request({
				path: '/res.php',
				method: 'GET',
				query: { action: 'getbalance' },
			});
			return readBalance({ request: response.request });
		} catch {
			return null;
		}
	}

	describe(): string {
		return '2Captcha via the classic in.php / res.php API - broad coverage, per-solve pricing';
	}
}

export function createTwoCaptchaProvider(
	apiKey: string,
	options: CaptchaProviderOptions = {},
): CaptchaProvider {
	return new TwoCaptchaProvider(apiKey, options);
}
