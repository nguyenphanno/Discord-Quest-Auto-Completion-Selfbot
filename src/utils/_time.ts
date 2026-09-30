/**
 * @file Time formatting helpers shared by the logger, the progress UI and the
 * quest flow (waiting messages, expiry checks, relative timestamps).
 */

export interface RemainingTime {
	/** Whether the deadline already passed. */
	expired: boolean;
	/** Signed millisecond delta until the deadline. */
	ms: number;
	/** Human readable rendition, e.g. `15m 04s`. */
	human: string;
}

export class Time extends null {
	static readonly Millisecond = 1;
	static readonly Second = 1_000;
	static readonly Minute = 60_000;
	static readonly Hour = 3_600_000;
	static readonly Day = 86_400_000;

	/** `HH:MM:SS.mmm` in the host timezone - used as the log timestamp. */
	static clock(date: Date = new Date()): string {
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
		return `${hours}:${minutes}:${seconds}.${milliseconds}`;
	}

	/** `YYYY-MM-DD HH:MM:SS` - used in report headers. */
	static stamp(date: Date = new Date()): string {
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		return `${date.getFullYear()}-${month}-${day} ${Time.clock(date).slice(0, 8)}`;
	}

	static iso(date: Date = new Date()): string {
		return date.toISOString();
	}

	/** `1h 02m 03s`, `4m 05s` or `12s`. Always compact and zero-padded. */
	static duration(totalSeconds: number): string {
		const seconds = Math.max(0, Math.floor(totalSeconds));
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const rest = seconds % 60;
		if (hours > 0) {
			return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(rest).padStart(2, '0')}s`;
		}
		if (minutes > 0) {
			return `${minutes}m ${String(rest).padStart(2, '0')}s`;
		}
		return `${rest}s`;
	}

	/**
	 * Rounded-up minute wording used by the quest wait messages, e.g.
	 * `15 minute(s)` - kept identical to the wording Discord users expect.
	 */
	static humanize(totalSeconds: number): string {
		return `${Math.max(0, Math.ceil(totalSeconds / 60))} minute(s)`;
	}

	/** Parses any Discord timestamp representation into a `Date`. */
	static parse(value: string | number | Date | null | undefined): Date | null {
		if (value === null || value === undefined) {
			return null;
		}
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	/** Signed countdown rendering used for quest expiry and cooldowns. */
	static remaining(
		deadline: string | number | Date,
		from: Date = new Date(),
	): RemainingTime {
		const target = Time.parse(deadline);
		if (!target) {
			return { expired: false, ms: Number.POSITIVE_INFINITY, human: 'unknown' };
		}
		const ms = target.getTime() - from.getTime();
		return {
			expired: ms <= 0,
			ms,
			human: Time.duration(Math.abs(ms) / Time.Second),
		};
	}

	/** `in 3h 12m`, `2d 4h ago` or `just now`. */
	static relative(target: string | number | Date, from: Date = new Date()): string {
		const parsed = Time.parse(target);
		if (!parsed) {
			return 'unknown';
		}
		const delta = parsed.getTime() - from.getTime();
		if (Math.abs(delta) < Time.Second) {
			return 'just now';
		}
		const magnitude = Time.duration(Math.abs(delta) / Time.Second);
		return delta > 0 ? `in ${magnitude}` : `${magnitude} ago`;
	}

	/** Clamped percentage helper used by the progress bar. */
	static percent(done: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.min(100, Math.max(0, (done / total) * 100));
	}
}
