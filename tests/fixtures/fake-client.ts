/**
 * @file `ClientQuest` double for the application tests.
 *
 * The real client owns a gateway websocket and a REST pool, neither of which can
 * exist offline. This double answers the same surface: `connect` emits a ready
 * payload (or fails), `rest` serves a recorded board, and every reporter method
 * is a spy so nothing is delivered.
 */

import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { GatewayDispatchEvents } from 'discord-api-types/v10';

import type { AllQuestsResponse } from '../../src/quests/model/types';
import { userStatus } from './quest-builder';

export interface FakeClientOptions {
	/** Board returned by `GET /quests/@me`. */
	board?: AllQuestsResponse;
	/** When set, `connect()` rejects with this error. */
	connectError?: Error;
	/** When set, `POST /quests/{id}/claim-reward` rejects with this error. */
	claimError?: Error;
	/** Body returned by the claim route. */
	claimResponse?: unknown;
}

export type FakeClient = EventEmitter & Record<string, unknown>;

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
	const client = new EventEmitter() as FakeClient;
	Object.assign(client, {
		rest: {
			get: vi.fn(async () => options.board ?? { quests: [], excluded_quests: [] }),
			post: vi.fn(async (route: string) => {
				if (route.endsWith('/claim-reward')) {
					if (options.claimError) {
						throw options.claimError;
					}
					return (
						options.claimResponse ?? {
							user_id: '1',
							quest_id: 'q-2',
							claimed_at: '2026-01-01T00:11:00.000Z',
							reward_code: null,
						}
					);
				}
				if (route.endsWith('/video-progress')) {
					return userStatus({ completed_at: '2026-01-01T00:10:00.000Z' });
				}
				return userStatus();
			}),
		},
		captcha: { solve: vi.fn(async () => ({ token: 't', provider: 'test', headers: {} })) },
		discordSays: {
			authorize: vi.fn(async () => ({ token: null, error: 'unavailable', activityReferrer: '' })),
			progress: vi.fn(async () => ({ success: false, error: 'unavailable' })),
			listAuthorizedTokens: vi.fn(async () => []),
			deauthorize: vi.fn(async () => true),
		},
		reporter: {
			resolve: vi.fn(async () => false),
			flush: vi.fn(async () => undefined),
			send: vi.fn(),
			error: vi.fn(),
			summary: vi.fn(),
			questCompleted: vi.fn(),
			questFailed: vi.fn(),
		},
		connect: vi.fn(async () => {
			if (options.connectError) {
				throw options.connectError;
			}
			client.emit(GatewayDispatchEvents.Ready, {
				data: { user: { id: '1', username: 'tester' } },
			});
		}),
		destroy: vi.fn(async () => undefined),
		resolveBuildNumber: vi.fn(async () => null),
		sendWebhookMessage: vi.fn(),
		emitQuestCompleted: vi.fn(),
	});
	return client;
}

/** Reads the recorded POST routes off the double. */
export function postedRoutes(client: FakeClient): string[] {
	const rest = client['rest'] as { post: ReturnType<typeof vi.fn> };
	return rest.post.mock.calls.map(([route]) => String(route));
}
