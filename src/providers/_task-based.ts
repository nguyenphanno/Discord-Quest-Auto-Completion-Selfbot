/**
 * @file Shared implementation for vendors that speak the
 * `createTask` / `getTaskResult` protocol.
 *
 * YesCaptcha, Anti-Captcha, CapMonster Cloud, CapSolver and the 2Captcha v2 API
 * all expose the same request/response shape, so one client serves all of them.
 * Only the base URL, the hCaptcha task type name and a few body fields differ
 * per vendor.
 */

import type { RequestInit } from 'undici';
import { Async } from '../utils/_async';
import { Http } from '../utils/_http';
import type {
	CaptchaChallenge,
	CaptchaProvider,
	CaptchaProviderOptions,
	CaptchaSolution,
	CaptchaWireResponse,
} from './_provider';
import {
	CaptchaProviderError,
	CaptchaTimeoutError,
	readBalance,
	resolveOptions,
} from './_provider';

/** Vendor specific parts of the shared protocol. */
export interface TaskBasedVendor {
	/** Stable identifier used in `CAPTCHA_PROVIDER`. */
	id: string;
	/** Human readable name. */
	label: string;
	/** API origin, e.g. `https://api.capsolver.com`. */
	baseUrl: string;
	/** Path of the create-task endpoint. */
	createTaskPath?: string;
	/** Path of the result endpoint. */
	getTaskResultPath?: string;
	/** Path of the balance endpoint. */
	getBalancePath?: string;
	/** Task type name this vendor uses for hCaptcha. */
	hcaptchaTaskType?: string;
	/** Extra fields merged into every request body. */
	extraBody?: Record<string, unknown>;
	/** Short note shown in the provider list. */
	note: string;
}

type ReadyResponse = CaptchaWireResponse & { status: 'ready' };
type ProcessingResponse = CaptchaWireResponse & { status: 'processing' };

const DEFAULT_TASK_TYPE = 'HCaptchaTaskProxyless';

export class TaskBasedCaptchaProvider implements CaptchaProvider {
	readonly id: string;
	readonly label: string;
	readonly requiresCredentials = true;

	private readonly options: Required<CaptchaProviderOptions>;
	private readonly headers: Headers;
	private lastTaskId: string | null = null;

	constructor(
		private readonly vendor: TaskBasedVendor,
		private readonly apiKey: string,
		options: CaptchaProviderOptions = {},
	) {
		if (!apiKey) {
			throw new CaptchaProviderError(
				`${vendor.label} requires an API key`,
				vendor.id,
				'MISSING_KEY',
			);
		}
		this.id = vendor.id;
		this.label = vendor.label;
		this.options = resolveOptions(options);
		this.headers = new Headers({
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'User-Agent': 'discord-quest-selfbot',
		});
	}

	/** Task id of the most recent challenge, useful when debugging. */
	get taskId(): string | null {
		return this.lastTaskId;
	}

	private post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
		const init: RequestInit = {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify({
				clientKey: this.apiKey,
				...payload,
				...this.vendor.extraBody,
			}),
		};
		return Http.json<T>(`${this.vendor.baseUrl}${path}`, init, {
			timeoutMs: this.options.requestTimeoutMs,
			// Polling and retries are managed here, so a single attempt suffices.
			retries: 1,
			scope: 'captcha',
			quiet: true,
			label: `${this.vendor.id} ${path}`,
		});
	}

	private assertOk(response: CaptchaWireResponse): void {
		const failed =
			response.errorId === 1 ||
			response.errorId === '1' ||
			(response.errorCode !== undefined && response.errorCode !== null);
		if (!failed) {
			return;
		}
		throw new CaptchaProviderError(
			`${this.vendor.label} rejected the request: ${response.errorCode ?? 'unknown error'}${
				response.errorDescription ? ` (${response.errorDescription})` : ''
			}`,
			this.vendor.id,
			String(response.errorCode ?? 'ERROR'),
		);
	}

	/** Extracts the token from a solution payload, tolerating vendor naming. */
	private static readToken(response: ReadyResponse): string | null {
		const solution = response.solution ?? {};
		const candidate =
			solution.gRecaptchaResponse ?? solution.token ?? solution.text ?? response.request;
		return typeof candidate === 'string' && candidate !== '' ? candidate : null;
	}

	async solveHcaptcha(challenge: CaptchaChallenge): Promise<CaptchaSolution> {
		const task: Record<string, unknown> = {
			type: this.vendor.hcaptchaTaskType ?? DEFAULT_TASK_TYPE,
			websiteURL: challenge.url,
			websiteKey: challenge.sitekey,
		};
		if (challenge.userAgent) {
			task.userAgent = challenge.userAgent;
		}
		if (challenge.isInvisible !== undefined) {
			task.isInvisible = challenge.isInvisible;
		}
		if (challenge.rqdata) {
			task.rqdata = challenge.rqdata;
		}

		const created = await this.post<CaptchaWireResponse>(
			this.vendor.createTaskPath ?? '/createTask',
			{ task },
		);
		this.assertOk(created);

		const taskId = created.taskId === undefined ? null : String(created.taskId);
		if (!taskId) {
			// Some vendors answer an inline/synchronous task without an id.
			const inlineToken = TaskBasedCaptchaProvider.readToken(created as ReadyResponse);
			if (inlineToken) {
				return { token: inlineToken, provider: this.id };
			}
			throw new CaptchaProviderError(
				`${this.vendor.label} did not return a task id`,
				this.vendor.id,
				'NO_TASK_ID',
			);
		}
		this.lastTaskId = taskId;

		const deadline = Date.now() + this.options.timeoutMs;
		while (Date.now() < deadline) {
			const result = await this.post<ReadyResponse | ProcessingResponse>(
				this.vendor.getTaskResultPath ?? '/getTaskResult',
				{ taskId },
			);
			this.assertOk(result);
			if (result.status === 'ready') {
				const token = TaskBasedCaptchaProvider.readToken(result);
				if (!token) {
					throw new CaptchaProviderError(
						`${this.vendor.label} returned a ready task without a token`,
						this.vendor.id,
						'NO_TOKEN',
					);
				}
				const userAgent = result.solution?.userAgent;
				return {
					token,
					provider: this.id,
					userAgent: typeof userAgent === 'string' ? userAgent : undefined,
				};
			}
			await Async.sleep(
				Math.min(this.options.pollIntervalMs, Math.max(0, deadline - Date.now())),
			);
		}

		throw new CaptchaTimeoutError(this.vendor.id, taskId, this.options.timeoutMs);
	}

	async getBalance(): Promise<number | null> {
		try {
			const response = await this.post<CaptchaWireResponse>(
				this.vendor.getBalancePath ?? '/getBalance',
				{},
			);
			this.assertOk(response);
			return readBalance(response);
		} catch {
			return null;
		}
	}

	describe(): string {
		return `${this.vendor.label} via ${this.vendor.baseUrl} - ${this.vendor.note}`;
	}
}

