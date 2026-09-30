import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Http, HttpError } from '../../src/shared/http';

type Handler = (path: string, attempt: number) => { status: number; body: string };

let server: Server;
let base = '';
let attempts = 0;
let handler: Handler = () => ({ status: 200, body: 'ok' });

beforeAll(async () => {
	server = createServer((request, response) => {
		attempts += 1;
		const result = handler(request.url ?? '/', attempts);
		response.writeHead(result.status, { 'content-type': 'text/plain' });
		response.end(result.body);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address && typeof address === 'object') {
		base = `http://127.0.0.1:${address.port}`;
	}
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Http over a local server', () => {
	it('returns the response for a 2xx answer', async () => {
		attempts = 0;
		handler = () => ({ status: 200, body: 'hello' });
		const response = await Http.request(`${base}/ok`, {}, { quiet: true });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('hello');
	});

	it('retries a retryable status until it succeeds', async () => {
		attempts = 0;
		handler = (_path, attempt) =>
			attempt < 3 ? { status: 503, body: 'busy' } : { status: 200, body: 'recovered' };
		const response = await Http.request(
			`${base}/retry`,
			{},
			{ retries: 3, retryDelayMs: 0, quiet: true },
		);
		expect(response.status).toBe(200);
		expect(attempts).toBe(3);
	});

	it('returns the last response once the attempts run out', async () => {
		attempts = 0;
		handler = () => ({ status: 500, body: 'always down' });
		const response = await Http.request(
			`${base}/down`,
			{},
			{ retries: 2, retryDelayMs: 0, quiet: true },
		);
		expect(response.status).toBe(500);
		expect(attempts).toBe(2);
	});

	it('does not retry a non retryable status', async () => {
		attempts = 0;
		handler = () => ({ status: 403, body: 'nope' });
		const response = await Http.request(
			`${base}/forbidden`,
			{},
			{ retries: 3, retryDelayMs: 0, quiet: true },
		);
		expect(response.status).toBe(403);
		expect(attempts).toBe(1);
	});

	it('parses a JSON body', async () => {
		handler = () => ({ status: 200, body: '{"value":42}' });
		await expect(Http.json<{ value: number }>(`${base}/json`, {}, { quiet: true })).resolves.toEqual({
			value: 42,
		});
	});

	it('raises HttpError for a non 2xx JSON request', async () => {
		handler = () => ({ status: 404, body: 'missing' });
		const error = await Http.json(`${base}/missing`, {}, { quiet: true }).catch(
			(thrown: unknown) => thrown,
		);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(404);
		expect((error as HttpError).body).toBe('missing');
	});

	it('raises HttpError for an unparseable JSON body', async () => {
		handler = () => ({ status: 200, body: 'not json' });
		const error = await Http.json(`${base}/broken`, {}, { quiet: true }).catch(
			(thrown: unknown) => thrown,
		);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).statusText).toBe('Invalid JSON body');
	});

	it('reads a text body and raises on an error status', async () => {
		handler = () => ({ status: 200, body: 'plain' });
		await expect(Http.text(`${base}/text`, {}, { quiet: true })).resolves.toBe('plain');

		handler = () => ({ status: 418, body: 'teapot' });
		await expect(Http.text(`${base}/teapot`, {}, { quiet: true })).rejects.toBeInstanceOf(HttpError);
	});

	it('gives up with the last transport error', async () => {
		const error = await Http.request(
			'http://127.0.0.1:1/none',
			{},
			{ retries: 2, retryDelayMs: 0, timeoutMs: 200, quiet: true },
		).catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(Error);
	});
});
