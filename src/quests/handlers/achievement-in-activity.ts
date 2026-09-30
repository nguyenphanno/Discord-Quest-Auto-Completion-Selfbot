import { QuestTaskConfigType } from '../model/types';
import type { TaskHandler } from './types';

interface ActivityQuestApi {
	completeActivity(questId: string, applicationId: string, target: number): Promise<void>;
}

function supportsActivityApi(api: object): api is ActivityQuestApi {
	return 'completeActivity' in api && typeof (api as { completeActivity?: unknown }).completeActivity === 'function';
}

export const achievementInActivityHandler: TaskHandler = {
	types: [QuestTaskConfigType.ACHIEVEMENT_IN_ACTIVITY],
	canHandle: () => true,
	async run(context): Promise<void> {
		if (!supportsActivityApi(context.api)) {
			throw new Error('Activity completion is unavailable for this QuestApi.');
		}
		const target = context.quest.tasks[context.taskType]?.target ?? 0;
		await context.api.completeActivity(context.quest.id, context.quest.applicationId, target);
	},
};
