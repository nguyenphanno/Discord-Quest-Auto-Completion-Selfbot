import { describe, expect, it, vi } from 'vitest';

import { TaskBasedCaptchaProvider } from '../../../src/captcha/providers/task-based';
import type { TaskBasedVendor } from '../../../src/captcha/providers/task-based';
import { CaptchaProviderError, CaptchaTimeoutError } from '../../../src/captcha/providers/provider';
import { Http } from '../../../src/shared/http';
import type { CaptchaChallenge } from '../../../src/captcha/providers/provider';

const VENDOR: TaskBasedVendor = {
	id: 'test-vendor',
	label: 'Test Vendor',
	baseUrl: 'https://vendor.test',
	note: 'tested offline',
};

const CHALLENGE: CaptchaChallenge = {
	sitekey: 'site-key',
	url: 'https://discord.com',
	service: 'hcaptcha',
};

/** Answers the vendor calls in order, so polling stays deterministic. */
function stubVendor(responses: unknown[]) {
	const queue = [...responses];
	const post = vi.spyOn(Http, 'json').mockImplementation(async () => {
		const next = queue.shift();
		if (next === undefined) {
			throw new Error('unexpected extra vendor call');
		}
		return next;
	});
	return post;
}

describe('TaskBasedCaptchaProvider', () => {
	it('refuses to start without an API key', () => {
		expect(() => new TaskBasedCaptchaProvider(VENDOR, '')).toThrow(CaptchaProviderError);
	});

	it('polls until the task is ready', async () => {
		const post = stubVendor([
			{ taskId: 7, errorId: 0 },
			{ status: 'processing' },
			{ status: 'ready', solution: { gRecaptchaResponse: 'token-1' } },
		]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key', { pollIntervalMs: 0 });
			await expect(provider.solveHcaptcha(CHALLENGE)).resolves.toEqual({
				token: 'token-1',
				provider: 'test-vendor',
				userAgent: undefined,
			});
			expect(provider.taskId).toBe('7');
		} finally {
			post.mockRestore();
		}
	});

	it('accepts an inline solution with no task id', async () => {
		const post = stubVendor([{ solution: { token: 'inline-token' } }]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key');
			await expect(provider.solveHcaptcha(CHALLENGE)).resolves.toMatchObject({
				token: 'inline-token',
			});
		} finally {
			post.mockRestore();
		}
	});

	it('fails when the vendor returns neither a task id nor a token', async () => {
		const post = stubVendor([{ errorId: 0 }]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key');
			await expect(provider.solveHcaptcha(CHALLENGE)).rejects.toThrow(/did not return a task id/);
		} finally {
			post.mockRestore();
		}
	});

	it('surfaces a vendor error code', async () => {
		const post = stubVendor([
			{ errorId: 1, errorCode: 'ERROR_KEY_DOES_NOT_EXIST', errorDescription: 'bad key' },
		]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key');
			await expect(provider.solveHcaptcha(CHALLENGE)).rejects.toThrow(/bad key/);
		} finally {
			post.mockRestore();
		}
	});

	it('fails when a ready task carries no token', async () => {
		const post = stubVendor([{ taskId: 1, errorId: 0 }, { status: 'ready' }]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key', { pollIntervalMs: 0 });
			await expect(provider.solveHcaptcha(CHALLENGE)).rejects.toThrow(/without a token/);
		} finally {
			post.mockRestore();
		}
	});

	it('replays the user agent the vendor returned', async () => {
		const post = stubVendor([
			{ taskId: 1, errorId: 0 },
			{ status: 'ready', solution: { text: 'token-2', userAgent: 'UA/1.0' } },
		]);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key', { pollIntervalMs: 0 });
			await expect(provider.solveHcaptcha(CHALLENGE)).resolves.toMatchObject({
				token: 'token-2',
				userAgent: 'UA/1.0',
			});
		} finally {
			post.mockRestore();
		}
	});

	it('times out when the task never becomes ready', async () => {
		const post = vi.spyOn(Http, 'json').mockResolvedValue({
			taskId: 1,
			status: 'processing',
			errorId: 0,
		} as never);
		try {
			const provider = new TaskBasedCaptchaProvider(VENDOR, 'key', {
				pollIntervalMs: 1,
				timeoutMs: 10,
			});
			await expect(provider.solveHcaptcha(CHALLENGE)).rejects.toBeInstanceOf(CaptchaTimeoutError);
		} finally {
			post.mockRestore();
		}
	});

	it('reads the balance and swallows vendor errors', async () => {
		const post = stubVendor([{ balance: 4.5, errorId: 0 }]);
		try {
			await expect(new TaskBasedCaptchaProvider(VENDOR, 'key').getBalance()).resolves.toBe(4.5);
		} finally {
			post.mockRestore();
		}

		const failing = vi.spyOn(Http, 'json').mockRejectedValue(new Error('offline'));
		try {
			await expect(new TaskBasedCaptchaProvider(VENDOR, 'key').getBalance()).resolves.toBeNull();
		} finally {
			failing.mockRestore();
		}
	});

	it('describes itself for the preflight block', () => {
		expect(new TaskBasedCaptchaProvider(VENDOR, 'key').describe()).toBe(
			'Test Vendor via https://vendor.test - tested offline',
		);
	});
});
