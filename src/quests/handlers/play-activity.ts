import { Constants } from '../../discord/constants';
import { ProgressBar } from '../../ui/progress';
import { Time } from '../../shared/time';
import { QuestTaskConfigType } from '../model/types';
import type { TaskHandler } from './types';

export const playActivityHandler: TaskHandler = {
	types: [QuestTaskConfigType.PLAY_ACTIVITY],
	canHandle: () => true,
	async run(context): Promise<void> {
		let current = context.quest;
		const target = current.tasks[context.taskType]?.target ?? 0;
		while (!current.isCompleted()) {
			if (context.signal.aborted) throw new Error('aborted');
			const done = current.taskProgress(context.taskType);
			const status = await context.api.postHeartbeat(current.id, { stream_key: 'call:1:1', terminal: false });
			current = current.withUserStatus(status);
			context.setQuest(current);
			context.log.info(`Spoofed your activity to ${current.applicationName}. Wait for ${Time.humanize(target - done)} more. ${ProgressBar.withTiming(done, target)}`);
			if (!current.isCompleted()) await context.clock.sleep(Constants.Tuning.heartbeatIntervalSeconds * 1000, context.signal);
		}
		const status = await context.api.postHeartbeat(current.id, { stream_key: 'call:1:1', terminal: true });
		context.setQuest(current.withUserStatus(status));
	},
};
