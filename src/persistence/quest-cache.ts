/**
 * @file Persistent run cache.
 *
 * Records what every run observed per quest so the next run can tell what is
 * new, what is already settled and what keeps failing. The cache is advisory
 * only: the Discord API stays authoritative, and a cache that cannot be read or
 * written degrades to a no-op instead of failing the run.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QuestOutcome, QuestRunResult } from '../quests/model/types';
import { Logger } from '../ui/logger';
import { Time } from '../shared/time';

export interface CachedQuestEntry {
	questId: string;
	questName: string;
	/** First run that observed the quest. */
	firstSeenAt: string;
	/** Last run that touched the quest. */
	lastSeenAt: string;
	/** How many runs have seen this quest. */
	runs: number;
	/** Outcome reported by the most recent run. */
	outcome: QuestOutcome;
	/** Set once the quest was observed as completed. */
	completedAt: string | null;
	/** Set once a reward claim succeeded. */
	claimedAt: string | null;
}

export interface QuestCacheFile {
	/** Format version, bumped when the shape changes. */
	version: number;
	/** When the file was last written. */
	updatedAt: string;
	/** Total runs recorded. */
	runs: number;
	entries: Record<string, CachedQuestEntry>;
}

const CACHE_VERSION = 1;
const CACHE_FILE = 'quests.json';

export class QuestCache {
	private readonly log = new Logger('cache');
	private file: QuestCacheFile = {
		version: CACHE_VERSION,
		updatedAt: Time.iso(),
		runs: 0,
		entries: {},
	};
	private loaded = false;
	/** Keeps the run counter at one increment per process, however often we save. */
	private runCounted = false;

	constructor(
		private readonly directory: string,
		private readonly enabled = true,
	) {}

	private get path(): string {
		return join(this.directory, CACHE_FILE);
	}

	/** Reads the cache; failures are logged and ignored. */
	async load(): Promise<void> {
		if (!this.enabled) {
			this.log.debug('Cache is disabled');
			return;
		}
		try {
			const raw = await readFile(this.path, 'utf8');
			const parsed = JSON.parse(raw) as QuestCacheFile;
			if (parsed?.version === CACHE_VERSION && parsed.entries) {
				this.file = parsed;
				this.loaded = true;
				this.log.debug(
					`Loaded ${Object.keys(this.file.entries).length} cached quest(s) from ${this.path}`,
				);
			} else {
				this.log.debug(`Ignoring cache with an unsupported version`);
			}
		} catch (error) {
			const code = (error as { code?: string } | null)?.code;
			if (code === 'ENOENT') {
				this.log.debug('No cache file yet; starting fresh');
			} else {
				this.log.warn(
					`Cache could not be read (${error instanceof Error ? error.message : String(error)}); continuing without it`,
				);
			}
		}
	}

	/** Writes the cache; failures are logged and ignored. */
	async save(): Promise<void> {
		if (!this.enabled) {
			return;
		}
		try {
			await mkdir(this.directory, { recursive: true });
			this.file.updatedAt = Time.iso();
			if (!this.runCounted) {
				this.file.runs++;
				this.runCounted = true;
			}
			await writeFile(this.path, `${JSON.stringify(this.file, null, 2)}\n`, 'utf8');
			this.log.debug(`Cache written to ${this.path}`);
		} catch (error) {
			this.log.warn(
				`Cache could not be written (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}

	/** Whether a quest was already completed and its reward claimed. */
	isSettled(questId: string): boolean {
		const entry = this.file.entries[questId];
		return Boolean(entry?.completedAt && entry?.claimedAt);
	}

	/** Whether the quest has never been seen by a previous run. */
	isNew(questId: string): boolean {
		return !this.file.entries[questId];
	}

	/** Records the outcome of a quest for this run. */
	recordResult(result: QuestRunResult): void {
		const now = Time.iso();
		const previous = this.file.entries[result.questId];
		const completed = result.outcome === 'completed' || result.outcome === 'already-complete';
		this.file.entries[result.questId] = {
			questId: result.questId,
			questName: result.questName,
			firstSeenAt: previous?.firstSeenAt ?? now,
			lastSeenAt: now,
			runs: (previous?.runs ?? 0) + 1,
			outcome: result.outcome,
			completedAt: previous?.completedAt ?? (completed ? now : null),
			claimedAt: previous?.claimedAt ?? null,
		};
	}

	/** Marks a reward as claimed so the next run can skip the quest. */
	markClaimed(questId: string, questName?: string): void {
		const now = Time.iso();
		const entry = this.file.entries[questId];
		if (entry) {
			entry.claimedAt = now;
			entry.lastSeenAt = now;
			return;
		}
		// Quests claimed by `REDEEM_REWARDS` were never part of this run's
		// results, so their first appearance in the cache is a claim.
		this.file.entries[questId] = {
			questId,
			questName: questName ?? questId,
			firstSeenAt: now,
			lastSeenAt: now,
			runs: 1,
			outcome: 'completed',
			completedAt: now,
			claimedAt: now,
		};
	}

	/** Aggregate counters for the preflight block. */
	stats(): {
		known: number;
		settled: number;
		completed: number;
		claimed: number;
		runs: number;
		updatedAt: string | null;
	} {
		const entries = Object.values(this.file.entries);
		return {
			known: entries.length,
			settled: entries.filter((entry) => entry.completedAt && entry.claimedAt).length,
			completed: entries.filter((entry) => entry.completedAt).length,
			claimed: entries.filter((entry) => entry.claimedAt).length,
			runs: this.file.runs,
			updatedAt: this.loaded ? this.file.updatedAt : null,
		};
	}

	/** Quests seen for the first time in the supplied results. */
	newQuests(results: readonly QuestRunResult[]): QuestRunResult[] {
		return results.filter((result) => this.isNew(result.questId));
	}
}
