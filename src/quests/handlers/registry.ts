import type { Quest } from '../model/quest';
import type { QuestTaskConfigType } from '../model/types';
import type { TaskHandler } from './types';

export class TaskHandlerRegistry {
	constructor(private readonly handlers: readonly TaskHandler[]) {}

	forTask(type: QuestTaskConfigType, quest: Quest): TaskHandler | undefined {
		return this.handlers.find((handler) => handler.types.includes(type) && handler.canHandle(quest));
	}
}
