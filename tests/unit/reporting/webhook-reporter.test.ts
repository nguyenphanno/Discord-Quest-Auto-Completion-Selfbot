import { describe, expect, it, vi } from 'vitest';

import { WebhookReporter } from '../../../src/reporting/webhook-reporter';
import { Http } from '../../../src/shared/http';

const VALID_URL = 'https://discord.com/api/webhooks/1234/token-abc';

const NO_EVENTS = { completed: false, failed: false, summary: false };
const ALL_EVENTS = { completed: true, failed: true, summary: true };

/** Replaces `Http.request` so no test ever opens a socket. */
function stubHttp(response: () => Partial<Response> & Record<string, unknown>) {
	return vi
		.spyOn(Http, 'request')
		.mockImplementation(async () => response() as unknown as Awaited<ReturnType<typeof Http.request>>);
}

describe('WebhookReporter', () => {
	it('is not configured without a url', async () => {
		const reporter = new WebhookReporter(null);
		expect(reporter.configured).toBe(false);
		expect(reporter.enabled).toBe(false);
		await expect(reporter.resolve()).resolves.toBe(false);
	});

	it('is disabled when the webhook answers with an error status', async () => {
		const stub = stubHttp(() => ({ ok: false, status: 404 }));
		try {
			const reporter = new WebhookReporter(VALID_URL);
			await expect(reporter.resolve()).resolves.toBe(false);
			expect(reporter.enabled).toBe(false);
		} finally {
			stub.mockRestore();
		}
	});

	it('is disabled when the webhook cannot be reached', async () => {
		const stub = vi.spyOn(Http, 'request').mockRejectedValue(new Error('ECONNREFUSED'));
		try {
			await expect(new WebhookReporter(VALID_URL).resolve()).resolves.toBe(false);
		} finally {
			stub.mockRestore();
		}
	});

	it('is disabled for a malformed url', async () => {
		const stub = stubHttp(() => ({ ok: true, status: 200 }));
		try {
			await expect(new WebhookReporter('https://example.test/nope').resolve()).resolves.toBe(false);
		} finally {
			stub.mockRestore();
		}
	});

	it('extracts the id and token from a valid url', async () => {
		const stub = stubHttp(() => ({ ok: true, status: 200 }));
		try {
			const reporter = new WebhookReporter(VALID_URL, ALL_EVENTS);
			await expect(reporter.resolve()).resolves.toBe(true);
			expect(reporter.enabled).toBe(true);
		} finally {
			stub.mockRestore();
		}
	});

	it('delivers nothing when every event is switched off', async () => {
		const sent: unknown[] = [];
		const execute = vi.fn(async (id: string) => {
			sent.push(id);
		});
		const reporter = new WebhookReporter(VALID_URL, NO_EVENTS);
		Object.assign(reporter as unknown as { api: { execute: unknown } }, { api: { execute } });
		Object.assign(reporter as unknown as { webhookId: string | null }, { webhookId: '1' });
		Object.assign(reporter as unknown as { webhookToken: string | null }, { webhookToken: 't' });
		reporter.questCompleted('q-1', 'Quest One');
		reporter.questFailed('Quest One', 'boom');
		reporter.summary('Run summary', [['Processed', '1']]);
		await reporter.flush();
		expect(sent).toEqual([]);
	});

	it('always delivers a runtime error, whatever the event switches say', async () => {
		const sent: string[] = [];
		const execute = vi.fn(async (_id: string, _token: string, payload: { content: string }) => {
			sent.push(payload.content);
		});
		const reporter = new WebhookReporter(VALID_URL, NO_EVENTS);
		Object.assign(reporter as unknown as { api: { execute: unknown } }, { api: { execute } });
		Object.assign(reporter as unknown as { webhookId: string | null }, { webhookId: '1' });
		Object.assign(reporter as unknown as { webhookToken: string | null }, { webhookToken: 't' });
		reporter.error('gateway connection failed');
		await reporter.flush();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain('Runtime error');
	});

	it('delivers an enabled event to the webhook', async () => {
		const sent: string[] = [];
		const execute = vi.fn(async (_id: string, _token: string, payload: { content: string }) => {
			sent.push(payload.content);
		});
		const reporter = new WebhookReporter(VALID_URL, ALL_EVENTS);
		Object.assign(reporter as unknown as { api: { execute: unknown } }, { api: { execute } });
		Object.assign(reporter as unknown as { webhookId: string | null }, { webhookId: '1' });
		Object.assign(reporter as unknown as { webhookToken: string | null }, { webhookToken: 't' });
		reporter.questCompleted('q-1', 'Quest One');
		reporter.questFailed('Quest Two', 'boom');
		reporter.summary('Run summary', [['Processed', '2']]);
		await reporter.flush();
		expect(sent).toHaveLength(3);
		expect(sent[0]).toContain('Quest completed');
		expect(sent[1]).toContain('Quest failed');
		expect(sent[2]).toContain('Run summary');
	});

	it('drops every message while disabled', async () => {
		const sent: unknown[] = [];
		const execute = vi.fn(async (id: string, token: string) => {
			sent.push([id, token]);
		});
		const reporter = new WebhookReporter(VALID_URL, ALL_EVENTS);
		Object.assign(reporter as unknown as { api: { execute: unknown } }, {
			api: { execute },
		});
		reporter.send('ignored');
		await reporter.flush();
		expect(sent).toEqual([]);
	});
});
