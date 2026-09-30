import { describe, expect, it } from 'vitest';

import { defaultRegistry } from '../../../src/quests/handlers/default-registry';
import { TaskHandlerRegistry } from '../../../src/quests/handlers/registry';
import { streamUnsupportedHandler, unsupportedTaskHandler } from '../../../src/quests/handlers/unsupported';
import { QuestTaskConfigType } from '../../../src/quests/model/types';
import { quest } from '../../fixtures/quest-builder';

describe('TaskHandlerRegistry', () => {
	const videoQuest = quest({ id: 'q-1', tasks: { [QuestTaskConfigType.WATCH_VIDEO]: 20 } });

	it('resolves a handler for a registered task type', () => {
		expect(defaultRegistry().forTask(QuestTaskConfigType.WATCH_VIDEO, videoQuest)).toBeDefined();
	});

	it('resolves console play tasks to the platform handler', () => {
		const registry = defaultRegistry();
		for (const type of [
			QuestTaskConfigType.PLAY_ON_DESKTOP,
			QuestTaskConfigType.PLAY_ON_XBOX,
			QuestTaskConfigType.PLAY_ON_PLAYSTATION,
		]) {
			expect(registry.forTask(type, quest({ id: `q-${type}`, tasks: { [type]: 10 } }))).toBeDefined();
		}
	});

	it('returns undefined for a task nothing can handle', () => {
		expect(new TaskHandlerRegistry([]).forTask(QuestTaskConfigType.WATCH_VIDEO, videoQuest)).toBe(
			undefined,
		);
	});

	it('skips a handler whose canHandle refuses the quest', () => {
		expect(
			defaultRegistry().forTask(QuestTaskConfigType.WATCH_VIDEO, quest({ id: 'q-bare' })),
		).toBeUndefined();
	});

	it('exposes the stream skip handler with its stable detail', () => {
		const handler = defaultRegistry().forTask(QuestTaskConfigType.STREAM_ON_DESKTOP, videoQuest);
		expect(handler).toBe(streamUnsupportedHandler);
		expect(handler?.unsupportedDetail).toBe('stream unsupported');
	});

	it('exposes the in-game skip handler with its stable detail', () => {
		const handler = defaultRegistry().forTask(QuestTaskConfigType.ACHIEVEMENT_IN_GAME, videoQuest);
		expect(handler).toBe(unsupportedTaskHandler);
		expect(handler?.unsupportedDetail).toBe('unsupported task');
	});

	it('marks no working handler as unsupported', () => {
		expect(
			defaultRegistry().forTask(QuestTaskConfigType.WATCH_VIDEO, videoQuest)?.unsupportedDetail,
		).toBeUndefined();
	});
});
