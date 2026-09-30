import { QuestTaskConfigType } from '../model/types';
import type { TaskHandler } from './types';

export const streamUnsupportedHandler: TaskHandler = {
	types: [QuestTaskConfigType.STREAM_ON_DESKTOP],
	unsupportedDetail: 'stream unsupported',
	canHandle: () => true,
	async run(): Promise<void> {},
};

export const unsupportedTaskHandler: TaskHandler = {
	types: [QuestTaskConfigType.ACHIEVEMENT_IN_GAME],
	unsupportedDetail: 'unsupported task',
	canHandle: () => true,
	async run(): Promise<void> {},
};
