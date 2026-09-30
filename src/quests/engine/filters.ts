/**
 * @file Pure quest filtering and board statistics.
 *
 * These functions operate on plain arrays without mutating inputs, making them
 * safe for unit testing and reuse by the engine and the CLI.
 */

/** Minimal read-only quest surface used by filter and board helpers. */
export interface QuestView {
	id: string;
	isCompleted(): boolean;
	isExpired(reference?: Date): boolean;
	hasClaimedRewards(): boolean;
}

/**
 * Applies include/exclude id lists to a quest array.
 *
 * - An empty `include` is treated as "all quests are included".
 * - Exclude wins when an id appears in both lists.
 * - The input array is never mutated; a new array is returned.
 */
export function applyQuestFilters<T extends QuestView>(
	quests: readonly T[],
	include: readonly string[],
	exclude: readonly string[],
): T[] {
	const included = include.length === 0 ? null : new Set(include);
	const excluded = new Set(exclude);
	return quests.filter((quest) => {
		if (excluded.has(quest.id)) {
			return false;
		}
		return included === null || included.has(quest.id);
	});
}

/** Snapshot of the quest board used by the summary block. */
export interface BoardStats {
	total: number;
	completed: number;
	claimable: number;
	expired: number;
	pending: number;
}

/**
 * Computes board-level statistics from a quest array.
 *
 * - `pending` = not completed and not expired.
 * - `claimable` = completed and not yet claimed.
 */
export function boardStats(quests: readonly QuestView[], now: Date = new Date()): BoardStats {
	let completed = 0;
	let claimable = 0;
	let expired = 0;
	let pending = 0;

	for (const quest of quests) {
		const isCompleted = quest.isCompleted();
		const isExpired = quest.isExpired(now);
		if (isCompleted) {
			completed++;
			if (!quest.hasClaimedRewards()) {
				claimable++;
			}
		}
		if (isExpired) {
			expired++;
		}
		if (!isCompleted && !isExpired) {
			pending++;
		}
	}

	return { total: quests.length, completed, claimable, expired, pending };
}
