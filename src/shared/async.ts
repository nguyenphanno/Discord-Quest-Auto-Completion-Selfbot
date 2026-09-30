/**
 * @file Promise / concurrency helpers: bounded parallelism, retries, sleeping
 * and timeouts. Kept dependency free so any layer can use it.
 */

export interface RetryOptions {
	/** Total attempts including the first one. Defaults to 1 (no retry). */
	attempts?: number;
	/** Base delay between attempts in milliseconds. Defaults to 500. */
	delayMs?: number;
	/** Multiplier applied per retry. Defaults to 2. */
	backoff?: number;
	/** Upper bound for the computed delay. Defaults to 30s. */
	maxDelayMs?: number;
	/** Decides whether a failure is worth retrying. Defaults to always. */
	shouldRetry?: (error: unknown, attempt: number) => boolean;
	/** Invoked before sleeping, useful for logging. */
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export class Async extends null {
	/** Resolves after `ms`, optionally abortable. */
	static sleep(ms: number, signal?: AbortSignal): Promise<void> {
		const delay = Math.max(0, ms);
		if (signal?.aborted) {
			return Promise.reject(new Error('Sleep aborted'));
		}
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				signal?.removeEventListener('abort', onAbort);
				resolve();
			}, delay);
			const onAbort = () => {
				clearTimeout(timer);
				reject(new Error('Sleep aborted'));
			};
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	/** Rejects with a descriptive error when `promise` outlives `ms`. */
	static withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
		if (!Number.isFinite(ms) || ms <= 0) {
			return promise;
		}
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${label} timed out after ${ms}ms`)),
				ms,
			);
			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	/** Exponential backoff retry wrapper around an async operation. */
	static async retry<T>(
		operation: (attempt: number) => Promise<T>,
		options: RetryOptions = {},
	): Promise<T> {
		const attempts = Math.max(1, Math.floor(options.attempts ?? 1));
		const delayMs = Math.max(0, options.delayMs ?? 500);
		const backoff = options.backoff ?? 2;
		const maxDelayMs = Math.max(0, options.maxDelayMs ?? 30_000);

		let lastError: unknown;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				return await operation(attempt);
			} catch (error) {
				lastError = error;
				if (attempt >= attempts) {
					break;
				}
				if (options.shouldRetry && !options.shouldRetry(error, attempt)) {
					break;
				}
				const delay = Math.min(maxDelayMs, delayMs * backoff ** (attempt - 1));
				options.onRetry?.(error, attempt, delay);
				await Async.sleep(delay);
			}
		}
		throw lastError;
	}

	/**
	 * Runs `worker` over `items` while never exceeding `limit` concurrent calls.
	 *
	 * A `limit` of `0` (or any value `>= items.length`) keeps the original
	 * unbounded `Promise.allSettled` behaviour for backwards compatibility.
	 * Results are returned in input order, mirroring `Promise.allSettled`.
	 */
	static async mapLimit<T, R>(
		items: readonly T[],
		limit: number,
		worker: (item: T, index: number) => Promise<R>,
	): Promise<Array<PromiseSettledResult<R>>> {
		if (items.length === 0) {
			return [];
		}
		const concurrency = limit <= 0 ? items.length : Math.min(limit, items.length);
		const results = new Array<PromiseSettledResult<R>>(items.length);
		let cursor = 0;

		const runner = async (): Promise<void> => {
			for (let index = cursor++; index < items.length; index = cursor++) {
				const item = items[index];
				if (item === undefined) {
					results[index] = { status: 'rejected', reason: new Error(`No item at index ${index}`) };
					continue;
				}
				try {
					results[index] = {
						status: 'fulfilled',
						value: await worker(item, index),
					};
				} catch (reason) {
					results[index] = { status: 'rejected', reason };
				}
			}
		};

		await Promise.all(Array.from({ length: concurrency }, () => runner()));
		return results;
	}

	/** Awaits `promise` but never rejects - returns `fallback` on failure. */
	static async settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
		try {
			return await promise;
		} catch {
			return fallback;
		}
	}

	/** Normalises anything thrown into a human readable message. */
	static errorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === 'string') {
			return error;
		}
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}

	/** Extracts a stack trace when available, otherwise the message. */
	static errorStack(error: unknown): string {
		if (error instanceof Error && error.stack) {
			return error.stack;
		}
		return Async.errorMessage(error);
	}
}
