/**
 * @file Enrollment budget helpers.
 *
 * Enrollment is the scarcest resource of the whole flow: Discord rate limits
 * `POST /quests/{id}/enroll` to roughly one call per account per 45 minutes.
 * These helpers keep the run from burning that budget on quests it cannot
 * finish, and from retrying an enrollment that was just rejected.
 */

import type { EnrollCooldownStore } from '../../persistence/enroll-cooldown';
import type { QuestCache } from '../../persistence/quest-cache';

/** Whether a settled quest may be skipped without touching the API. */
export function shouldSkipSettled(cache: QuestCache, questId: string, enabled: boolean): boolean {
	return enabled && cache.isSettled(questId);
}

/** Gate the engine consults before it enrolls a quest. */
export interface EnrollBudget {
	/** True when a new enrollment must not be attempted yet. */
	isBlocked(now: Date): boolean;
	/** Records a successful enrollment. */
	record(now: Date): void;
}

/**
 * Builds a budget backed by the on-disk cooldown store.
 *
 * @param windowMs `ENROLL_COOLDOWN_MS`; `0` disables the gate entirely.
 * @returns `null` when the gate is disabled, so the engine can skip the check.
 */
export function enrollBudgetFor(
	store: EnrollCooldownStore,
	accountId: string,
	windowMs: number,
): EnrollBudget | null {
	if (windowMs <= 0) {
		return null;
	}
	return {
		isBlocked: (now) => store.isBlocked(accountId, now, windowMs),
		record: (now) => store.recordEnroll(accountId, now),
	};
}

