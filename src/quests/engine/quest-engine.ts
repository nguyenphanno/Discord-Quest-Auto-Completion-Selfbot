/**
 * @file Quest engine.
 *
 * The engine is the only place that decides *whether* work happens: it rejects
 * expired/completed quests, enforces the enrollment budget, resolves handlers
 * for the quest's task types and reports a `QuestRunResult` per quest. Every
 * Discord call goes through the `QuestApi` port, which keeps the whole flow unit
 * testable with a fake API and no network.
 */

import { Async } from '../../shared/async';
import { Logger } from '../../ui/logger';
import { SUPPORTED_TASK_ORDER, type Quest } from '../model/quest';
import type { QuestRunResult, QuestTaskConfigType } from '../model/types';
import type { QuestApi } from '../api/quest-api';
import type { EnrollBudget } from './enroll-budget';
import type { HandlerClock } from '../handlers/types';
import { TaskHandlerRegistry } from '../handlers/registry';

export interface QuestEngineOptions {
	/** Maximum quests driven at the same time; `0` means unbounded. */
	concurrency: number;
	/** Report the plan without enrolling, progressing or claiming. */
	dryRun: boolean;
	/** Delay applied per worker index to spread the first burst. */
	workerStaggerMs: number;
	/** Injectable time source; defaults to real time plus `Async.sleep`. */
	clock?: HandlerClock;
	/** Optional enrollment gate; `null` means "try every candidate". */
	enrollBudget?: EnrollBudget | null;
}

const defaultClock: HandlerClock = { now: Date.now, sleep: Async.sleep };

export class QuestEngine {
	private readonly log = new Logger('quest');
	private readonly clock: HandlerClock;
	private readonly budget: EnrollBudget | null;
	private readonly concurrency: number;
	private readonly dryRun: boolean;
	private readonly workerStaggerMs: number;

	constructor(
		private readonly api: QuestApi,
		private readonly handlers: TaskHandlerRegistry,
		options: QuestEngineOptions,
	) {
		this.clock = options.clock ?? defaultClock;
		this.budget = options.enrollBudget ?? null;
		this.concurrency = options.concurrency;
		this.dryRun = options.dryRun;
		this.workerStaggerMs = options.workerStaggerMs;
	}

	/** Drives every quest and returns one result per input quest, in order. */
	async run(quests: readonly Quest[], signal: AbortSignal): Promise<QuestRunResult[]> {
		const settled = await Async.mapLimit(quests, this.concurrency, async (quest, index) => {
			if (this.workerStaggerMs > 0 && index > 0) {
				await this.clock.sleep(index * this.workerStaggerMs, signal);
			}
			return this.runQuest(quest, index + 1, quests.length, signal);
		});
		return settled.map((item, index) => {
			if (item.status === 'fulfilled') {
				return item.value;
			}
			const quest = quests[index];
			const detail = Async.errorMessage(item.reason);
			return quest
				? this.failed(quest, 'UNKNOWN', detail)
				: { questId: 'unknown', questName: 'unknown', task: 'UNKNOWN', outcome: 'failed', detail };
		});
	}

	/** One line describing what a live run would do, resolved offline. */
	private plan(quest: Quest, taskName: QuestTaskConfigType | 'UNKNOWN'): string {
		const task = taskName === 'UNKNOWN' ? undefined : quest.tasks[taskName];
		const target = task?.target ?? 0;
		const profile = quest.isAndroidProfile() ? 'Android' : 'Desktop';
		return `"${quest.name}": ${quest.isEnrolledQuest() ? 'already enrolled' : `enrol (${profile})`} -> drive ${taskName} ${quest.taskProgress(taskName)}/${target}s -> claim "${quest.rewardLabel()}"`;
	}

	private failed(
		quest: Quest,
		task: QuestTaskConfigType | 'UNKNOWN',
		detail: string,
	): QuestRunResult {
		return { questId: quest.id, questName: quest.name, task, outcome: 'failed', detail };
	}

	private async runQuest(
		quest: Quest,
		index: number,
		total: number,
		signal: AbortSignal,
	): Promise<QuestRunResult> {
		let current = quest;
		const taskTypes = SUPPORTED_TASK_ORDER.filter((type) => Boolean(current.tasks[type]));
		const primary: QuestTaskConfigType | 'UNKNOWN' = taskTypes[0] ?? 'UNKNOWN';
		this.log.step(
			index,
			total,
			`${Logger.strong(current.name)} ${Logger.tag(String(primary), 'gray400')}`,
		);

		const base = { questId: current.id, questName: current.name, task: primary };
		if (signal.aborted) {
			return { ...base, outcome: 'skipped', detail: 'aborted', errorCode: 'ABORTED' };
		}
		if (current.isExpired()) {
			return { ...base, outcome: 'skipped', detail: 'expired' };
		}
		if (current.isCompleted()) {
			return { ...base, outcome: 'already-complete', detail: 'already completed' };
		}
		if (taskTypes.length === 0) {
			return {
				...base,
				task: 'UNKNOWN',
				outcome: 'skipped',
				detail: 'unsupported task',
				errorCode: 'UNSUPPORTED_TASK',
			};
		}
		if (!current.isEnrolledQuest() && this.budget?.isBlocked(new Date(this.clock.now()))) {
			this.log.warn(`Skipping "${current.name}": the enrollment cooldown is still active`);
			return {
				...base,
				outcome: 'skipped',
				detail: 'enrollment cooldown',
				errorCode: 'ENROLL_COOLDOWN',
			};
		}

		// `and` quests require every advertised task; otherwise the historical
		// behaviour of driving only the highest priority task is preserved.
		const selected =
			current.config.task_config_v2.join_operator === 'and' ? taskTypes : taskTypes.slice(0, 1);
		const resolved = selected.map((type) => [type, this.handlers.forTask(type, current)] as const);
		const unsupported = resolved.find(([, handler]) => !handler || handler.unsupportedDetail);
		if (unsupported) {
			return {
				...base,
				task: unsupported[0],
				outcome: 'skipped',
				detail: unsupported[1]?.unsupportedDetail ?? 'unsupported task',
				errorCode: 'UNSUPPORTED_TASK',
			};
		}

		if (this.dryRun) {
			const detail = this.plan(current, primary);
			this.log.info(`${Logger.tag('dry run', 'amber')} ${detail}`);
			return { ...base, outcome: 'skipped', detail };
		}

		try {
			if (!current.isEnrolledQuest()) {
				current = current.withUserStatus(
					await this.api.enroll(current, current.isAndroidProfile() ? 'android' : 'desktop'),
				);
				this.budget?.record(new Date(this.clock.now()));
			}
			for (const [task, handler] of resolved) {
				if (!handler) {
					continue;
				}
				if (signal.aborted) {
					return { ...base, task, outcome: 'skipped', detail: 'aborted', errorCode: 'ABORTED' };
				}
				await handler.run({
					quest: current,
					taskType: task,
					api: this.api,
					signal,
					log: this.log,
					clock: this.clock,
					setQuest: (next) => {
						current = next;
					},
				});
			}
			this.log.success(`Quest "${current.name}" completed`);
			return { ...base, outcome: 'completed', detail: 'task finished' };
		} catch (error) {
			const message = Async.errorMessage(error);
			if (signal.aborted || message.toLowerCase().includes('abort')) {
				return { ...base, outcome: 'skipped', detail: 'aborted', errorCode: 'ABORTED' };
			}
			this.log.error(`Quest "${current.name}" failed`, error);
			return this.failed(current, primary, message);
		}
	}
}

