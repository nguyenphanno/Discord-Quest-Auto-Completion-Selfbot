import { describe, expect, it } from 'vitest';

import { Async } from '../../../src/shared/async';
import { AppError } from '../../../src/shared/errors';
import { Http, HttpError } from '../../../src/shared/http';
import { Time } from '../../../src/shared/time';

describe('Async', () => {
	it('sleeps for at least zero milliseconds', async () => {
		await expect(Async.sleep(-5)).resolves.toBeUndefined();
	});

	it('rejects immediately when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(Async.sleep(1_000, controller.signal)).rejects.toThrow('Sleep aborted');
	});

	it('rejects a running sleep when the signal aborts', async () => {
		const controller = new AbortController();
		const pending = Async.sleep(5_000, controller.signal);
		controller.abort();
		await expect(pending).rejects.toThrow('Sleep aborted');
	});

	it('ignores a non-positive timeout', async () => {
		await expect(Async.withTimeout(Promise.resolve('ok'), 0)).resolves.toBe('ok');
		await expect(Async.withTimeout(Promise.resolve('ok'), Number.NaN)).resolves.toBe('ok');
	});

	it('rejects a promise that outlives its timeout', async () => {
		const never = new Promise<string>(() => undefined);
		await expect(Async.withTimeout(never, 5, 'slow call')).rejects.toThrow(/slow call timed out/);
	});

	it('propagates the original rejection through withTimeout', async () => {
		await expect(Async.withTimeout(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow('boom');
	});

	it('retries until the operation succeeds', async () => {
		let attempts = 0;
		const result = await Async.retry(
			async () => {
				attempts += 1;
				if (attempts < 3) {
					throw new Error('nope');
				}
				return 'done';
			},
			{ attempts: 3, delayMs: 0 },
		);
		expect(result).toBe('done');
		expect(attempts).toBe(3);
	});

	it('rethrows the last error once the attempts run out', async () => {
		await expect(
			Async.retry(async () => Promise.reject(new Error('always')), { attempts: 2, delayMs: 0 }),
		).rejects.toThrow('always');
	});

	it('stops early when shouldRetry declines', async () => {
		let attempts = 0;
		await expect(
			Async.retry(
				async () => {
					attempts += 1;
					throw new Error('fatal');
				},
				{ attempts: 5, delayMs: 0, shouldRetry: () => false },
			),
		).rejects.toThrow('fatal');
		expect(attempts).toBe(1);
	});

	it('caps the delay at maxDelayMs', async () => {
		const delays: number[] = [];
		await expect(
			Async.retry(
				async (attempt) => {
					if (attempt < 3) {
						throw new Error('again');
					}
					return attempt;
				},
				{
					attempts: 3,
					delayMs: 1_000,
					backoff: 10,
					maxDelayMs: 1_500,
					onRetry: (_e, _a, delay) => delays.push(delay),
				},
			),
		).resolves.toBe(3);
		expect(delays).toEqual([1_000, 1_500]);
	});

	it('never exceeds the concurrency limit', async () => {
		let running = 0;
		let peak = 0;
		await Async.mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
			running += 1;
			peak = Math.max(peak, running);
			await Async.sleep(1);
			running -= 1;
		});
		expect(peak).toBeLessThanOrEqual(2);
	});

	it('keeps input order and isolates rejections', async () => {
		const results = await Async.mapLimit([1, 2, 3], 0, async (item) => {
			if (item === 2) {
				throw new Error('two failed');
			}
			return item;
		});
		expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
	});

	it('returns an empty array for no items', async () => {
		await expect(Async.mapLimit([], 4, async () => 1)).resolves.toEqual([]);
	});

	it('falls back instead of rejecting in settle', async () => {
		await expect(Async.settle(Promise.reject(new Error('x')), 'fallback')).resolves.toBe('fallback');
		await expect(Async.settle(Promise.resolve('value'), 'fallback')).resolves.toBe('value');
	});

	it('normalises anything thrown into a message', () => {
		expect(Async.errorMessage(new Error('boom'))).toBe('boom');
		expect(Async.errorMessage('plain')).toBe('plain');
		expect(Async.errorMessage({ code: 1 })).toBe('{"code":1}');
	});

	it('returns a stack trace when the error carries one', () => {
		expect(Async.errorStack(new Error('boom'))).toContain('Error: boom');
		expect(Async.errorStack('plain')).toBe('plain');
	});
});

describe('Http', () => {
	it('marks only the documented statuses as retryable', () => {
		for (const status of [408, 425, 429, 500, 502, 503, 504]) {
			expect(Http.isRetryableStatus(status)).toBe(true);
		}
		for (const status of [200, 400, 401, 403, 404, 422]) {
			expect(Http.isRetryableStatus(status)).toBe(false);
		}
	});

	it('honours retry-after in seconds', () => {
		expect(Http.retryAfterMs({ headers: new Headers({ 'retry-after': '2' }) } as never, 700)).toBe(
			2_000,
		);
	});

	it('falls back to the rate-limit reset header', () => {
		const response = { headers: new Headers({ 'x-ratelimit-reset-after': '0.5' }) } as never;
		expect(Http.retryAfterMs(response, 700)).toBe(500);
	});

	it('falls back to the supplied delay when no header is present', () => {
		expect(Http.retryAfterMs({ headers: new Headers() } as never, 700)).toBe(700);
	});

	it('ignores a malformed retry-after header', () => {
		const response = { headers: new Headers({ 'retry-after': 'soon' }) } as never;
		expect(Http.retryAfterMs(response, 700)).toBe(700);
	});

	it('merges new defaults without losing the untouched ones', () => {
		const before = Http.defaults;
		Http.configure({ timeoutMs: 1_000 });
		expect(Http.defaults).toEqual({ ...before, timeoutMs: 1_000 });
		Http.defaults = before;
	});

	it('reads a body defensively', async () => {
		const broken = {
			text: async () => {
				throw new Error('stream closed');
			},
		} as never;
		await expect(Http.safeText(broken)).resolves.toBe('');
	});
});

describe('HttpError', () => {
	it('carries the status and a readable message', () => {
		const error = new HttpError(404, 'Not Found', 'https://example.test', 'missing');
		expect(error.name).toBe('HttpError');
		expect(error.status).toBe(404);
		expect(error.body).toBe('missing');
		expect(error.message).toBe('HTTP 404 Not Found -> https://example.test');
	});
});

describe('AppError', () => {
	it('keeps a machine readable code next to the message', () => {
		const error = new AppError('ENROLL_BLOCKED', 'blocked until tomorrow');
		expect(error.name).toBe('AppError');
		expect(error.code).toBe('ENROLL_BLOCKED');
		expect(error.message).toBe('blocked until tomorrow');
		expect(error).toBeInstanceOf(Error);
	});
});

describe('Time', () => {
	it('formats a clock stamp', () => {
		expect(Time.clock(new Date(2026, 0, 1, 9, 5, 3, 7))).toBe('09:05:03.007');
	});

	it('formats a compact duration', () => {
		expect(Time.duration(0)).toBe('0s');
		expect(Time.duration(45)).toBe('45s');
		expect(Time.duration(125)).toBe('2m 05s');
		expect(Time.duration(3_723)).toBe('1h 02m 03s');
		expect(Time.duration(-10)).toBe('0s');
	});

	it('uses the historical minute wording for quest waits', () => {
		expect(Time.humanize(1_500)).toBe('25 minute(s)');
		expect(Time.humanize(0)).toBe('0 minute(s)');
	});

	it('parses any Discord timestamp shape and rejects junk', () => {
		expect(Time.parse('2026-01-01T00:00:00.000Z')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(Time.parse(new Date(0))?.getTime()).toBe(0);
		expect(Time.parse('not-a-date')).toBeNull();
		expect(Time.parse(null)).toBeNull();
	});

	it('describes the remaining time of a deadline', () => {
		const from = new Date('2026-01-01T00:00:00.000Z');
		expect(Time.remaining('2026-01-01T00:01:00.000Z', from)).toMatchObject({
			expired: false,
			ms: 60_000,
		});
		expect(Time.remaining('2025-12-31T23:59:00.000Z', from)).toMatchObject({ expired: true });
		expect(Time.remaining('nonsense', from)).toMatchObject({ human: 'unknown' });
	});

	it('renders relative timestamps', () => {
		const from = new Date('2026-01-01T00:00:00.000Z');
		expect(Time.relative('2026-01-01T00:00:00.500Z', from)).toBe('just now');
		expect(Time.relative('2026-01-01T01:00:00.000Z', from)).toBe('in 1h 00m 00s');
		expect(Time.relative('2025-12-31T23:00:00.000Z', from)).toBe('1h 00m 00s ago');
		expect(Time.relative('nonsense', from)).toBe('unknown');
	});

	it('clamps the completion percentage', () => {
		expect(Time.percent(5, 20)).toBe(25);
		expect(Time.percent(50, 20)).toBe(100);
		expect(Time.percent(-5, 20)).toBe(0);
		expect(Time.percent(1, 0)).toBe(0);
		expect(Time.percent(1, Number.NaN)).toBe(0);
	});
});
