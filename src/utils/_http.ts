/**
 * @file Thin `undici` wrapper adding per-request timeouts, bounded retries and
 * structured logging. Used for the non-REST calls (Discord web/CDN assets, the
 * `discordsays.com` activity proxy and captcha providers).
 */

import { fetch } from 'undici';
import type { RequestInit, Response } from 'undici';
import { Async } from './_async';
import { Logger } from '../ui/_logger';

export interface HttpOptions {
	/** Per-attempt timeout in milliseconds. */
	timeoutMs?: number;
	/** Total attempts including the first one. */
	retries?: number;
	/** Base delay before a retry (exponential). */
	retryDelayMs?: number;
	/** Human readable label used in log lines. */
	label?: string;
	/** Logger scope for the request trace. */
	scope?: string;
	/** Silence the per-attempt debug lines. */
	quiet?: boolean;
}

export interface HttpDefaults {
	timeoutMs: number;
	retries: number;
	retryDelayMs: number;
}

/** Error raised when a response arrives with a non-2xx status. */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly statusText: string,
		readonly url: string,
		readonly body: string,
	) {
		super(`HTTP ${status} ${statusText} -> ${url}`);
		this.name = 'HttpError';
	}
}

/** Statuses that are safe to retry automatically. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class Http extends null {
	static defaults: HttpDefaults = {
		timeoutMs: 20_000,
		retries: 2,
		retryDelayMs: 700,
	};

	static configure(defaults: Partial<HttpDefaults> = {}): void {
		Http.defaults = { ...Http.defaults, ...defaults };
	}

	static isRetryableStatus(status: number): boolean {
		return RETRYABLE_STATUSES.has(status);
	}

	/** Honours `retry-after` (seconds) and `x-ratelimit-reset-after`. */
	static retryAfterMs(response: Response, fallbackMs: number): number {
		const retryAfter = response.headers.get('retry-after');
		if (retryAfter) {
			const seconds = Number(retryAfter);
			if (Number.isFinite(seconds) && seconds >= 0) {
				return Math.round(seconds * 1000);
			}
		}
		const reset = response.headers.get('x-ratelimit-reset-after');
		if (reset) {
			const seconds = Number(reset);
			if (Number.isFinite(seconds) && seconds >= 0) {
				return Math.round(seconds * 1000);
			}
		}
		return fallbackMs;
	}

	private static async fetchOnce(
		url: string,
		init: RequestInit,
		timeoutMs: number,
	): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Performs a request with retries. A retryable status is only retried while
	 * attempts remain, after which the response itself is returned so callers
	 * can keep inspecting `response.ok` like before.
	 */
	static async request(
		url: string,
		init: RequestInit = {},
		options: HttpOptions = {},
	): Promise<Response> {
		const log = new Logger(options.scope ?? 'http');
		const attempts = Math.max(1, options.retries ?? Http.defaults.retries);
		const timeoutMs = options.timeoutMs ?? Http.defaults.timeoutMs;
		const baseDelay = options.retryDelayMs ?? Http.defaults.retryDelayMs;
		const label = options.label ?? `${init.method ?? 'GET'} ${url}`;
		let lastError: unknown;

		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				if (!options.quiet) {
					log.debug(
						attempt > 1 ? `retry ${attempt}/${attempts}: ${label}` : `request: ${label}`,
					);
				}
				const response = await Http.fetchOnce(url, init, timeoutMs);
				if (Http.isRetryableStatus(response.status) && attempt < attempts) {
					const delay = Http.retryAfterMs(response, baseDelay * attempt);
					log.warn(
						`${label} answered ${response.status}; retrying in ${delay}ms (${attempt}/${attempts})`,
					);
					await Async.sleep(delay);
					continue;
				}
				if (!options.quiet) {
					log.debug(`${response.status} ${response.statusText} <- ${label}`);
				}
				return response;
			} catch (error) {
				lastError = error;
				if (attempt >= attempts) {
					break;
				}
				const delay = baseDelay * attempt;
				log.warn(
					`${label} failed: ${Async.errorMessage(error)}; retrying in ${delay}ms (${attempt}/${attempts})`,
				);
				await Async.sleep(delay);
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error(`Request failed after ${attempts} attempt(s): ${label}`);
	}

	/** Reads the body defensively so error reporting never throws. */
	static async safeText(response: Response): Promise<string> {
		try {
			return await response.text();
		} catch {
			return '';
		}
	}

	/** Request + parse, raising `HttpError` for any non-2xx status. */
	static async json<T>(
		url: string,
		init: RequestInit = {},
		options: HttpOptions = {},
	): Promise<T> {
		const response = await Http.request(url, init, options);
		const raw = await Http.safeText(response);
		if (!response.ok) {
			throw new HttpError(response.status, response.statusText, url, raw.slice(0, 500));
		}
		try {
			return JSON.parse(raw) as T;
		} catch (error) {
			throw new HttpError(
				response.status,
				'Invalid JSON body',
				url,
				Async.errorMessage(error),
			);
		}
	}

	/** Request + text body, raising `HttpError` for any non-2xx status. */
	static async text(
		url: string,
		init: RequestInit = {},
		options: HttpOptions = {},
	): Promise<string> {
		const response = await Http.request(url, init, options);
		const raw = await Http.safeText(response);
		if (!response.ok) {
			throw new HttpError(response.status, response.statusText, url, raw.slice(0, 500));
		}
		return raw;
	}
}
