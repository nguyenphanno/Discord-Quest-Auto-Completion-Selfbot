import { describe, expect, it } from 'vitest';

import { achievementInActivityHandler } from '../../../../src/quests/handlers/achievement-in-activity';
import { playActivityHandler } from '../../../../src/quests/handlers/play-activity';
import { playOnPlatformHandler } from '../../../../src/quests/handlers/play-on-platform';
import { watchVideoHandler } from '../../../../src/quests/handlers/watch-video';
import { Constants } from '../../../../src/discord/constants';
import { QuestTaskConfigType } from '../../../../src/quests/model/types';
import type { QuestApi } from '../../../../src/quests/api/quest-api';
import { createFakeClock, createHandlerContext } from '../../../fixtures/fake-clock';
import { FakeQuestApi } from '../../../fixtures/fake-quest-api';
import { quest, taskProgress, userStatus } from '../../../fixtures/quest-builder';

const enrolledVideoQuest = (id: string, target: number) =>
	quest({ id, tasks: { [QuestTaskConfigType.WATCH_VIDEO]: target }, userStatus: userStatus() });

describe('watchVideoHandler', () => {
	it('handles both desktop and mobile video tasks', () => {
		expect(watchVideoHandler.types).toEqual([
			QuestTaskConfigType.WATCH_VIDEO,
			QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE,
		]);
	});

	it('refuses a quest without a task', () => {
		expect(watchVideoHandler.canHandle(quest({ id: 'q-bare' }))).toBe(false);
	});

	it('accepts a quest with a supported task', () => {
		expect(watchVideoHandler.canHandle(enrolledVideoQuest('q-1', 20))).toBe(true);
	});

	it('never reports progress further ahead than the tolerance allows', async () => {
		const api = new FakeQuestApi();
		const clock = createFakeClock();
		const startMs = clock.now();
		const { ctx } = createHandlerContext({
			quest: enrolledVideoQuest('q-video', 20),
			api,
			taskType: QuestTaskConfigType.WATCH_VIDEO,
			clock,
		});
		await watchVideoHandler.run(ctx);
		expect(api.timestamps.length).toBeGreaterThan(0);
		for (const timestamp of api.timestamps) {
			const elapsed = (clock.now() - startMs) / 1000;
			expect(timestamp).toBeLessThanOrEqual(elapsed + Constants.Tuning.videoMaxFutureSeconds + 1);
		}
	});

	it('walks the clock forward across the whole target', async () => {
		const api = new FakeQuestApi();
		const clock = createFakeClock();
		const { ctx, current } = createHandlerContext({
			quest: enrolledVideoQuest('q-video', 20),
			api,
			taskType: QuestTaskConfigType.WATCH_VIDEO,
			clock,
		});
		await watchVideoHandler.run(ctx);
		// 20s at 7s per tick, plus at most one extra call pinning the target.
		expect(api.timestamps.length).toBeLessThanOrEqual(4);
		expect(current().taskProgress(QuestTaskConfigType.WATCH_VIDEO)).toBeGreaterThan(0);
	});

	it('stops as soon as the server reports completion', async () => {
		const api = new FakeQuestApi({
			videoStates: [
				userStatus({ progress: taskProgress('WATCH_VIDEO', 7) }),
				userStatus({ completed_at: '2026-01-01T00:10:00.000Z' }),
			],
		});
		const { ctx, current } = createHandlerContext({
			quest: enrolledVideoQuest('q-video', 600),
			api,
			taskType: QuestTaskConfigType.WATCH_VIDEO,
			clock: createFakeClock(),
		});
		await watchVideoHandler.run(ctx);
		expect(api.timestamps).toHaveLength(2);
		expect(current().isCompleted()).toBe(true);
	});

	it('sends one final call at the target when the server never completes', async () => {
		const api = new FakeQuestApi();
		const { ctx } = createHandlerContext({
			quest: enrolledVideoQuest('q-video', 14),
			api,
			taskType: QuestTaskConfigType.WATCH_VIDEO,
			clock: createFakeClock(),
		});
		await watchVideoHandler.run(ctx);
		expect(api.timestamps[api.timestamps.length - 1]).toBe(14);
	});

	it('throws when the signal is aborted before the first tick', async () => {
		const controller = new AbortController();
		controller.abort();
		const { ctx } = createHandlerContext({
			quest: enrolledVideoQuest('q-video', 20),
			api: new FakeQuestApi(),
			taskType: QuestTaskConfigType.WATCH_VIDEO,
			clock: createFakeClock(),
			signal: controller.signal,
		});
		await expect(watchVideoHandler.run(ctx)).rejects.toThrow('aborted');
	});
});

describe('playOnPlatformHandler', () => {
	it('declares every console and desktop platform task', () => {
		expect(playOnPlatformHandler.types).toEqual([
			QuestTaskConfigType.PLAY_ON_DESKTOP,
			QuestTaskConfigType.PLAY_ON_DESKTOP_V2,
			QuestTaskConfigType.PLAY_ON_XBOX,
			QuestTaskConfigType.PLAY_ON_PLAYSTATION,
		]);
	});

	it('sends a regular heartbeat then a terminal one', async () => {
		const api = new FakeQuestApi();
		const { ctx } = createHandlerContext({
			quest: quest({
				id: 'q-play',
				tasks: { [QuestTaskConfigType.PLAY_ON_DESKTOP]: 600 },
				userStatus: userStatus(),
			}),
			api,
			taskType: QuestTaskConfigType.PLAY_ON_DESKTOP,
			clock: createFakeClock(),
		});
		await playOnPlatformHandler.run(ctx);
		expect(api.calls).toEqual(['heartbeat', 'heartbeat:terminal']);
	});

	it('skips the regular heartbeat for an already completed quest', async () => {
		const api = new FakeQuestApi();
		const { ctx } = createHandlerContext({
			quest: quest({
				id: 'q-play',
				tasks: { [QuestTaskConfigType.PLAY_ON_XBOX]: 600 },
				userStatus: userStatus({ completed_at: '2026-01-01T00:10:00.000Z' }),
			}),
			api,
			taskType: QuestTaskConfigType.PLAY_ON_XBOX,
			clock: createFakeClock(),
		});
		await playOnPlatformHandler.run(ctx);
		expect(api.calls).toEqual(['heartbeat:terminal']);
	});
});

describe('playActivityHandler', () => {
	it('uses the activity stream key on both heartbeats', async () => {
		const api = new FakeQuestApi();
		const { ctx } = createHandlerContext({
			quest: quest({
				id: 'q-activity',
				tasks: { [QuestTaskConfigType.PLAY_ACTIVITY]: 60 },
				userStatus: userStatus(),
			}),
			api,
			taskType: QuestTaskConfigType.PLAY_ACTIVITY,
			clock: createFakeClock(),
		});
		await playActivityHandler.run(ctx);
		expect(api.calls).toEqual(['heartbeat', 'heartbeat:terminal']);
	});

	it('throws when the signal is aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const { ctx } = createHandlerContext({
			quest: quest({
				id: 'q-activity',
				tasks: { [QuestTaskConfigType.PLAY_ACTIVITY]: 60 },
				userStatus: userStatus(),
			}),
			api: new FakeQuestApi(),
			taskType: QuestTaskConfigType.PLAY_ACTIVITY,
			clock: createFakeClock(),
			signal: controller.signal,
		});
		await expect(playActivityHandler.run(ctx)).rejects.toThrow('aborted');
	});
});

describe('achievementInActivityHandler', () => {
	it('delegates to the activity API when it is available', async () => {
		const seen: Array<[string, string, number]> = [];
		const api = {
			completeActivity: async (questId: string, applicationId: string, target: number) => {
				seen.push([questId, applicationId, target]);
			},
		} as unknown as QuestApi;
		const { ctx } = createHandlerContext({
			quest: quest({ id: 'q-ach', tasks: { [QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY]: 5 } }),
			api,
			taskType: QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY,
			clock: createFakeClock(),
		});
		await achievementInActivityHandler.run(ctx);
		expect(seen).toEqual([['q-ach', '900000000000000001', 5]]);
	});

	it('fails with a clear message when the API cannot drive activities', async () => {
		const { ctx } = createHandlerContext({
			quest: quest({ id: 'q-ach', tasks: { [QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY]: 5 } }),
			api: new FakeQuestApi(),
			taskType: QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY,
			clock: createFakeClock(),
		});
		await expect(achievementInActivityHandler.run(ctx)).rejects.toThrow(/unavailable/);
	});
});
