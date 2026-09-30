import { Constants } from '../../discord/constants';
import { ProgressBar } from '../../ui/progress';
import { Time } from '../../shared/time';
import { QuestTaskConfigType } from '../model/types';
import type { TaskHandler } from './types';

export const watchVideoHandler: TaskHandler = {
	types: [QuestTaskConfigType.WATCH_VIDEO, QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE],
	canHandle: (quest) => Boolean(quest.primaryTask()),
	async run(context): Promise<void> {
		const { quest, taskType, api, clock, signal, log, setQuest } = context;
		const target = quest.tasks[taskType]?.target ?? 0;
		let done = quest.taskProgress(taskType);
		const enrolledAt = Time.parse(quest.userStatus?.enrolled_at)?.getTime() ?? clock.now();
		let completed = quest.isCompleted();
		let ticks = 0;
		log.info(`Spoofing video for "${quest.name}" (${Time.duration(target - done)} to go)`);
		while (done < target && !completed) {
			if (signal.aborted) throw new Error('aborted');
			const maxAllowed = Math.floor((clock.now() - enrolledAt) / 1000) + Constants.Tuning.videoMaxFutureSeconds;
			if (maxAllowed - done < Constants.Tuning.videoSpeedSeconds) {
				await clock.sleep(Constants.Tuning.videoIntervalSeconds * 1000, signal);
				continue;
			}
			const next = Math.min(target, done + Constants.Tuning.videoSpeedSeconds);
			const status = await api.postVideoProgress(quest.id, Math.min(target, next + Math.random()));
			const updated = quest.withUserStatus(status);
			setQuest(updated);
			completed = updated.isCompleted();
			done = next;
			ticks++;
			const bar = ProgressBar.withTiming(done, target);
			if (ticks % 8 === 0) log.info(`Watching "${quest.name}" ${bar}`);
			else log.debug(`video progress "${quest.name}" ${bar}`);
			if (!completed && done < target) await clock.sleep(Constants.Tuning.videoIntervalSeconds * 1000, signal);
		}
		if (!completed && !signal.aborted) {
			const status = await api.postVideoProgress(quest.id, target);
			setQuest(quest.withUserStatus(status));
		}
	},
};
