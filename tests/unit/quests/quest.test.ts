import { describe, expect, it } from 'vitest';

import { Quest } from '../../../src/quests/model/quest';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import {
	ENROLLED_AT,
	LONG_PAST,
	quest,
	questPayload,
	userStatus,
} from '../../fixtures/quest-builder';

describe('Quest', () => {
	it('exposes the derived values the quest flow keeps asking for', () => {
		const subject = quest({
			id: 'q1',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 },
			rewardName: 'A Reward',
			applicationName: 'A Game',
		});
		expect(subject.id).toBe('q1');
		expect(subject.name).toBe('q1');
		expect(subject.applicationId).toBe('900000000000000001');
		expect(subject.applicationName).toBe('A Game');
		expect(subject.taskType()).toBe(QuestTaskConfigType.WATCH_VIDEO);
		expect(subject.rewardLabel()).toBe('A Reward');
		expect(subject.redeemPlatform()).toBe(0);
		expect(subject.isEnrolledQuest()).toBe(false);
	});

	it('withUserStatus returns a new quest and leaves the original untouched', () => {
		const original = Quest.create(questPayload({ id: 'q1' }));
		const next = original.withUserStatus(
			userStatus({ enrolled_at: '2026-02-01T00:00:00.000Z' }),
		);
		expect(original.userStatus).toBeNull();
		expect(next).not.toBe(original);
		expect(next.userStatus?.enrolled_at).toBe('2026-02-01T00:00:00.000Z');
		expect(next.id).toBe(original.id);
	});

	it('accepts a null status when resetting a quest', () => {
		const enrolled = quest({ id: 'q2', userStatus: userStatus() });
		expect(enrolled.withUserStatus(null).userStatus).toBeNull();
	});

	it('reports completion, enrollment and claiming from the status', () => {
		const completed = quest({
			id: 'q3',
			userStatus: userStatus({ completed_at: '2026-01-02T00:00:00.000Z' }),
		});
		expect(completed.isCompleted()).toBe(true);
		expect(completed.isEnrolledQuest()).toBe(true);
		expect(completed.hasClaimedRewards()).toBe(false);

		const claimed = quest({
			id: 'q4',
			userStatus: userStatus({
				completed_at: '2026-01-02T00:00:00.000Z',
				claimed_at: '2026-01-03T00:00:00.000Z',
			}),
		});
		expect(claimed.hasClaimedRewards()).toBe(true);
	});

	it('detects expiry and reports the remaining seconds', () => {
		const expired = quest({ id: 'q5', expiresAt: LONG_PAST });
		expect(expired.isExpired(new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
		expect(expired.secondsRemaining(new Date('2026-06-01T00:00:00.000Z'))).toBeLessThan(0);

		const live = quest({ id: 'q6' });
		expect(live.isExpired(new Date('2026-06-01T00:00:00.000Z'))).toBe(false);
		expect(live.secondsRemaining(new Date('2026-06-01T00:00:00.000Z'))).toBeGreaterThan(0);
	});

	it('treats an unparseable expiry as never expiring', () => {
		const subject = quest({ id: 'q7', expiresAt: 'not-a-date' });
		expect(subject.isExpired()).toBe(false);
		expect(subject.secondsRemaining()).toBe(Number.POSITIVE_INFINITY);
	});

	it('requires the Android profile only for mobile-only video quests', () => {
		const mobile = quest({
			id: 'q8',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE]: 20 },
		});
		const desktop = quest({ id: 'q9', tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 } });
		const both = quest({
			id: 'q10',
			tasks: {
				[QuestTaskConfigType.WATCH_VIDEO]: 20,
				[QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE]: 20,
			},
		});
		expect(mobile.isAndroidProfile()).toBe(true);
		expect(desktop.isAndroidProfile()).toBe(false);
		expect(both.isAndroidProfile()).toBe(false);
	});

	it('resolves the primary task in the historical priority order', () => {
		const subject = quest({
			id: 'q11',
			tasks: {
				[QuestTaskConfigType.PLAY_ON_DESKTOP]: 30,
				[QuestTaskConfigType.WATCH_VIDEO]: 20,
			},
		});
		expect(subject.taskType()).toBe(QuestTaskConfigType.WATCH_VIDEO);
		expect(subject.primaryTask()?.target).toBe(20);
	});

	it('falls back to the task key when the payload omits the type', () => {
		const payload = questPayload({ id: 'q12' });
		payload.config.task_config_v2.tasks = {
			[QuestTaskConfigType.PLAY_ON_XBOX]: { event_name: 'PLAY_ON_XBOX', target: 900 },
		};
		expect(Quest.create(payload).primaryTask()?.type).toBe(QuestTaskConfigType.PLAY_ON_XBOX);
	});

	it('returns nulls for quests without a supported task or reward platform', () => {
		const subject = quest({ id: 'q13', platforms: [] });
		expect(subject.taskType()).toBeNull();
		expect(subject.primaryTask()).toBeNull();
		expect(subject.redeemPlatform()).toBeNull();
		expect(subject.rewardLabel()).toBe('Test Reward');
	});

	it('computes task progress and the completion ratio', () => {
		const subject = quest({
			id: 'q14',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 },
			userStatus: userStatus({
				progress: {
					WATCH_VIDEO: {
						event_name: 'WATCH_VIDEO',
						value: 5,
						updated_at: ENROLLED_AT,
						completed_at: null,
					},
				},
			}),
		});
		expect(subject.taskProgress('WATCH_VIDEO')).toBe(5);
		expect(subject.completionRatio('WATCH_VIDEO', 20)).toBe(25);
		expect(subject.taskProgress('MISSING')).toBe(0);
		expect(subject.completionRatio('MISSING', 0)).toBe(0);
	});

	it('renders a one line debug description', () => {
		const subject = quest({ id: 'q15', tasks: { [QuestTaskConfigType.PLAY_ACTIVITY]: 60 } });
		expect(subject.toString()).toBe('Quest(q15, q15, task=PLAY_ACTIVITY)');
	});
});
