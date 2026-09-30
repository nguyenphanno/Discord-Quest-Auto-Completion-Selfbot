import { describe, expect, it } from 'vitest';

import { applyQuestFilters, boardStats } from '../../../src/quests/engine/filters';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import { ENROLLED_AT, LONG_PAST, quest, userStatus } from '../../fixtures/quest-builder';

const completed = quest({
	id: 'completed',
	userStatus: userStatus({ completed_at: '2026-01-02T00:00:00.000Z' }),
});
const claimed = quest({
	id: 'claimed',
	userStatus: userStatus({
		completed_at: '2026-01-02T00:00:00.000Z',
		claimed_at: '2026-01-03T00:00:00.000Z',
	}),
});
const expired = quest({ id: 'expired', expiresAt: LONG_PAST });
const pending = quest({ id: 'pending' });
const now = new Date('2026-06-01T00:00:00.000Z');

describe('applyQuestFilters', () => {
	it('returns every quest when both lists are empty', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' }), quest({ id: 'c' })];
		expect(applyQuestFilters(quests, [], []).map((item) => item.id)).toEqual(['a', 'b', 'c']);
	});

	it('keeps only the included ids when an include list is given', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' }), quest({ id: 'c' })];
		expect(applyQuestFilters(quests, ['a', 'c'], []).map((item) => item.id)).toEqual(['a', 'c']);
	});

	it('drops excluded ids', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' }), quest({ id: 'c' })];
		expect(applyQuestFilters(quests, [], ['b']).map((item) => item.id)).toEqual(['a', 'c']);
	});

	it('lets exclude win when an id appears in both lists', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' })];
		expect(applyQuestFilters(quests, ['a', 'b'], ['b']).map((item) => item.id)).toEqual(['a']);
	});

	it('returns an empty list when everything is excluded', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' })];
		expect(applyQuestFilters(quests, [], ['a', 'b'])).toEqual([]);
	});

	it('returns an empty list when the include list matches nothing', () => {
		const quests = [quest({ id: 'a' }), quest({ id: 'b' })];
		expect(applyQuestFilters(quests, ['x', 'y'], [])).toEqual([]);
	});

	it('never mutates the input array', () => {
		const quests = Object.freeze([quest({ id: 'a' }), quest({ id: 'b' })]);
		const filtered = applyQuestFilters(quests, [], ['a']);
		expect(filtered.map((item) => item.id)).toEqual(['b']);
		expect(quests).toHaveLength(2);
	});
});

describe('boardStats', () => {
	it('counts completed, claimable, expired and pending quests', () => {
		expect(boardStats([completed, claimed, expired, pending], now)).toEqual({
			total: 4,
			completed: 2,
			claimable: 1,
			expired: 1,
			pending: 1,
		});
	});

	it('handles an empty board', () => {
		expect(boardStats([], now)).toEqual({
			total: 0,
			completed: 0,
			claimable: 0,
			expired: 0,
			pending: 0,
		});
	});

	it('treats an enrolled quest as pending until it completes', () => {
		const enrolled = quest({ id: 'enrolled', userStatus: userStatus({ enrolled_at: ENROLLED_AT }) });
		const stats = boardStats([enrolled], now);
		expect(stats.pending).toBe(1);
		expect(stats.completed).toBe(0);
	});

	it('recognises a mobile-only video quest', () => {
		const mobile = quest({
			id: 'mobile',
			tasks: { [QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE]: 20 },
		});
		expect(mobile.taskType()).toBe(QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE);
		expect(boardStats([mobile], now).pending).toBe(1);
	});
});
