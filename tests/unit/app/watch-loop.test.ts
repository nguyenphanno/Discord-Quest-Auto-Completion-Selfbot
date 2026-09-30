import { describe, expect, it } from 'vitest';

import { runWatchLoop } from '../../../src/app/watch-loop';

describe('runWatchLoop', () => {
	it('runs again after the poll interval and stops once aborted', async () => {
		const calls: number[] = [];
		const controller = new AbortController();
		const result = await runWatchLoop({
			pollMs: 10,
			signal: controller.signal,
			runOnce: async () => {
				calls.push(calls.length + 1);
				if (calls.length >= 2) {
					controller.abort();
				}
				return 0;
			},
			sleep: async () => undefined,
		});
		expect(calls).toHaveLength(2);
		expect(result).toBe(0);
	});

	it('runs exactly once when the poll interval is disabled', async () => {
		let calls = 0;
		const result = await runWatchLoop({
			pollMs: 0,
			signal: new AbortController().signal,
			runOnce: async () => {
				calls += 1;
				return 1;
			},
			sleep: async () => undefined,
		});
		expect(calls).toBe(1);
		expect(result).toBe(1);
	});

	it('returns the exit code of the final run', async () => {
		const controller = new AbortController();
		let calls = 0;
		const result = await runWatchLoop({
			pollMs: 5,
			signal: controller.signal,
			runOnce: async () => {
				calls += 1;
				if (calls === 3) {
					controller.abort();
					return 1;
				}
				return 0;
			},
			sleep: async () => undefined,
		});
		expect(calls).toBe(3);
		expect(result).toBe(1);
	});

	it('stops when the sleep is interrupted', async () => {
		let calls = 0;
		const result = await runWatchLoop({
			pollMs: 5,
			signal: new AbortController().signal,
			runOnce: async () => {
				calls += 1;
				return 0;
			},
			sleep: async () => {
				throw new Error('Sleep aborted');
			},
		});
		expect(calls).toBe(1);
		expect(result).toBe(0);
	});

	it('never starts when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		const result = await runWatchLoop({
			pollMs: 5,
			signal: controller.signal,
			runOnce: async () => {
				calls += 1;
				return 0;
			},
			sleep: async () => undefined,
		});
		expect(calls).toBe(0);
		expect(result).toBe(0);
	});
});
