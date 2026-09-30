/**
 * @file Quest fixtures shared by the unit and e2e suites.
 *
 * Builds the smallest payload that still satisfies `QuestConfig` so a test only
 * has to describe the fields it cares about. Everything here is offline data;
 * no token, no network.
 */

import { Quest } from '../../src/quests/model/quest';
import { QuestTaskConfigType } from '../../src/quests/model/types';
import type {
	Quest as QuestShape,
	QuestTask,
	QuestUserStatus,
} from '../../src/quests/model/types';

/** Expiry far enough away that a fixture never looks expired. */
export const FAR_FUTURE = '2099-01-01T00:00:00.000Z';
/** Expiry in the past, for the "skipped: expired" paths. */
export const LONG_PAST = '2020-06-01T00:00:00.000Z';
/** Stable enrollment timestamp used by the fake clock. */
export const ENROLLED_AT = '2026-01-01T00:00:00.000Z';

export interface QuestFixtureOptions {
	id: string;
	/** Task targets keyed by task type; omit for an unsupported quest. */
	tasks?: Partial<Record<QuestTaskConfigType, number>>;
	/** `and` requires every advertised task. */
	joinOperator?: 'and' | 'or';
	userStatus?: QuestUserStatus | null;
	expiresAt?: string;
	rewardName?: string;
	platforms?: number[];
	applicationName?: string;
}

export function userStatus(overrides: Partial<QuestUserStatus> = {}): QuestUserStatus {
	return {
		user_id: '1',
		enrolled_at: ENROLLED_AT,
		completed_at: null,
		claimed_at: null,
		progress: {},
		...overrides,
	};
}

/** Progress record for a single task, as Discord reports it. */
export function taskProgress(
	eventName: string,
	value: number,
	completedAt: string | null = null,
) {
	return {
		[eventName]: {
			event_name: eventName,
			value,
			updated_at: ENROLLED_AT,
			completed_at: completedAt,
		},
	};
}

export function questPayload(options: QuestFixtureOptions): QuestShape {
	const tasks: Partial<Record<QuestTaskConfigType, QuestTask>> = {};
	for (const [type, target] of Object.entries(options.tasks ?? {})) {
		tasks[type as QuestTaskConfigType] = {
			event_name: type,
			target: target ?? 0,
			type: type as QuestTaskConfigType,
		};
	}
	const applicationName = options.applicationName ?? 'Test App';
	const rewardName = options.rewardName ?? 'Test Reward';
	return {
		id: options.id,
		config: {
			id: options.id,
			config_version: 1,
			starts_at: '2020-01-01T00:00:00.000Z',
			expires_at: options.expiresAt ?? FAR_FUTURE,
			features: 0,
			application: { id: '900000000000000001', name: applicationName },
			assets: {
				hero: '',
				hero_video: null,
				quest_bar_hero: '',
				quest_bar_hero_video: null,
				game_tile: '',
				logotype: '',
			},
			colors: { primary: '#000000', secondary: '#ffffff' },
			messages: {
				quest_name: options.id,
				game_title: applicationName,
				game_publisher: '',
			},
			task_config_v2: { tasks, join_operator: options.joinOperator },
			rewards_config: {
				assignment_method: 0,
				rewards: [
					{
						type: 4,
						sku_id: '123456789012345678',
						messages: { name: rewardName, name_with_article: rewardName },
					},
				],
				rewards_expire_at: null,
				platforms: options.platforms ?? [0],
			},
		},
		user_status: options.userStatus ?? null,
		preview: false,
	};
}

export function quest(options: QuestFixtureOptions): Quest {
	return Quest.create(questPayload(options));
}
