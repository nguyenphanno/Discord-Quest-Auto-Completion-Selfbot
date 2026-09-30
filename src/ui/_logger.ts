/**
 * @file Structured console logger with aligned, colourised columns.
 *
 * Layout (colour disabled for clarity):
 *
 *   12:34:56.789 | INFO    | quest      | Spoofing video for Opera GX
 *
 * Every record carries a timestamp, a fixed-width level badge and a colour
 * coded scope, which keeps long runs of quest output scannable. Setting
 * `LOG_JSON=true` switches to newline-delimited JSON for log collectors.
 */

import { Banner } from './_banner';
import { Blocks, KeyValueOptions, PanelOptions, ProgressBar } from './_progress';
import { ColorName, Theme } from './_theme';
import { Time } from '../utils/_time';

export enum LogLevel {
	Trace = 10,
	Debug = 20,
	Info = 30,
	Success = 40,
	Warn = 50,
	Error = 60,
	Fatal = 70,
	Silent = 100,
}

export interface LoggerOptions {
	/** Minimum level that gets printed. Defaults to `Info`. */
	level?: LogLevel;
	/** Emit newline-delimited JSON instead of decorated text. */
	json?: boolean;
	/** Prefix each record with a timestamp. Defaults to true. */
	timestamps?: boolean;
}

export interface LoggerSnapshot {
	warnings: number;
	errors: number;
	records: number;
	elapsedMs: number;
	startedAt: number;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
	[LogLevel.Trace]: 'TRACE',
	[LogLevel.Debug]: 'DEBUG',
	[LogLevel.Info]: 'INFO',
	[LogLevel.Success]: 'SUCCESS',
	[LogLevel.Warn]: 'WARN',
	[LogLevel.Error]: 'ERROR',
	[LogLevel.Fatal]: 'FATAL',
	[LogLevel.Silent]: 'SILENT',
};

const LEVEL_COLORS: Record<LogLevel, ColorName> = {
	[LogLevel.Trace]: 'gray500',
	[LogLevel.Debug]: 'gray400',
	[LogLevel.Info]: 'cyan',
	[LogLevel.Success]: 'green',
	[LogLevel.Warn]: 'amber',
	[LogLevel.Error]: 'red',
	[LogLevel.Fatal]: 'red',
	[LogLevel.Silent]: 'gray500',
};

/** Stable scope -> colour mapping; unknown scopes hash into the accent ramp. */
const SCOPE_COLORS: Record<string, ColorName> = {
	app: 'gray300',
	system: 'gray300',
	config: 'gray300',
	client: 'blurpleSoft',
	gateway: 'violet',
	http: 'cyan',
	network: 'cyan',
	quest: 'blue',
	enroll: 'teal',
	reward: 'green',
	video: 'fuchsia',
	activity: 'orange',
	captcha: 'amber',
	webhook: 'pink',
	build: 'gray400',
	auth: 'yellow',
};

const FALLBACK_SCOPE_COLORS: ColorName[] = [
	'blue',
	'teal',
	'cyan',
	'violet',
	'fuchsia',
	'orange',
	'green',
	'amber',
];

export const BADGE_WIDTH = 7;
export const SCOPE_WIDTH = 10;
export const TIME_WIDTH = 12;

/** Parses `LOG_LEVEL` values such as `debug`, `WARN` or `silent`. */
export function parseLogLevel(value: string | undefined, fallback = LogLevel.Info): LogLevel {
	if (!value) {
		return fallback;
	}
	const normalised = value.trim().toLowerCase();
	for (const key of Object.keys(LEVEL_LABELS)) {
		const level = Number(key) as LogLevel;
		if (LEVEL_LABELS[level].toLowerCase() === normalised) {
			return level;
		}
	}
	return fallback;
}

export function logLevelName(level: LogLevel): string {
	return LEVEL_LABELS[level] ?? 'INFO';
}

export class Logger {
	static options: Required<LoggerOptions> = {
		level: LogLevel.Info,
		json: false,
		timestamps: true,
	};

	private static counters: LoggerSnapshot = {
		warnings: 0,
		errors: 0,
		records: 0,
		elapsedMs: 0,
		startedAt: Date.now(),
	};

	/** Root logger for modules that do not need a dedicated scope. */
	static readonly root: Logger = new Logger('app');

	static configure(options: LoggerOptions = {}): void {
		Logger.options = { ...Logger.options, ...options };
	}

	static get level(): LogLevel {
		return Logger.options.level;
	}

	/** Cumulative counters, used by the closing summary block. */
	static stats(): LoggerSnapshot {
		return { ...Logger.counters, elapsedMs: Date.now() - Logger.counters.startedAt };
	}

	static resetStats(): void {
		Logger.counters = {
			warnings: 0,
			errors: 0,
			records: 0,
			elapsedMs: 0,
			startedAt: Date.now(),
		};
	}

	/** Styles an inline value (quest name, id, path) inside a message. */
	static value(text: string): string {
		return Theme.fg('gray100', text);
	}

	/** Styles a quest or application name. */
	static strong(text: string): string {
		return Theme.bold(Theme.fg('gray100', text));
	}

	/** Inline badge such as ` PENDING ` or ` SKIPPED `. */
	static tag(text: string, color: ColorName = 'gray500'): string {
		return Theme.bg('gray800', Theme.fg(color, ` ${text.toUpperCase()} `));
	}

	/** Clickable link to the Discord quest page. */
	static questLink(questId: string, label = 'quest'): string {
		return Theme.link(label, `https://discord.com/quests/${questId}`);
	}

	/** Renders and prints the ASCII wordmark above everything else. */
	static printBanner(meta?: string): void {
		process.stdout.write(`${Banner.render(meta ? { meta } : {})}\n`);
	}

	constructor(private readonly scope: string = 'app') {}

	/** Derives a nested logger, e.g. `quest:video`. */
	child(scope: string): Logger {
		return new Logger(`${this.scope}:${scope}`);
	}

	get scopeName(): string {
		return this.scope;
	}

	private scopeColor(): ColorName {
		const root = this.scope.split(':')[0];
		const known = SCOPE_COLORS[root];
		if (known) {
			return known;
		}
		let hash = 0;
		for (let index = 0; index < root.length; index++) {
			hash = (hash * 31 + root.charCodeAt(index)) % 9973;
		}
		return FALLBACK_SCOPE_COLORS[hash % FALLBACK_SCOPE_COLORS.length];
	}

	private badge(level: LogLevel): string {
		const label = LEVEL_LABELS[level].padEnd(BADGE_WIDTH);
		const color = LEVEL_COLORS[level];
		if (level === LogLevel.Fatal) {
			return Theme.bg('red', Theme.bold(Theme.fg('gray950', label)));
		}
		if (level >= LogLevel.Warn) {
			return Theme.bold(Theme.fg(color, label));
		}
		return Theme.fg(color, label);
	}

	/** `12:34:56.789 <sep> LEVEL   <sep> scope      <sep> ` */
	private prefix(level: LogLevel): string {
		const separator = Theme.fg('gray700', `${Theme.glyph.vertical} `);
		const parts: string[] = [];
		if (Logger.options.timestamps) {
			parts.push(Theme.fg('gray600', Time.clock().padEnd(TIME_WIDTH)), separator);
		}
		parts.push(`${this.badge(level)} `, separator);
		parts.push(Theme.fg(this.scopeColor(), this.scope.padEnd(SCOPE_WIDTH)), separator);
		return parts.join('');
	}

	private shouldLog(level: LogLevel): boolean {
		return Logger.options.level !== LogLevel.Silent && level >= Logger.options.level;
	}

	private emit(text: string, stream: 'stdout' | 'stderr'): void {
		if (stream === 'stderr') {
			process.stderr.write(`${text}\n`);
			return;
		}
		process.stdout.write(`${text}\n`);
	}

	/** Serialises a record as compact JSON for log collectors. */
	private asJson(level: LogLevel, message: string, meta?: unknown): string {
		const plain = Theme.strip(message).trim();
		const record: Record<string, unknown> = {
			ts: Time.iso(),
			level: LEVEL_LABELS[level].toLowerCase(),
			scope: this.scope,
			message: plain,
		};
		if (meta !== undefined) {
			record.meta =
				meta instanceof Error
					? { name: meta.name, message: meta.message, stack: meta.stack }
					: meta;
		}
		try {
			return JSON.stringify(record);
		} catch {
			return JSON.stringify({
				ts: record.ts,
				level: record.level,
				scope: record.scope,
				message: plain,
				meta: String(meta),
			});
		}
	}

	/** Continuation lines for the optional meta payload (cause + stack). */
	private details(meta: unknown, indent: string): string[] {
		const lines: string[] = [];
		if (meta === undefined) {
			return lines;
		}
		if (meta instanceof Error) {
			lines.push(`${indent}${Theme.fg('redSoft', `\u21b3 ${meta.message}`)}`);
			if (Logger.options.level <= LogLevel.Debug && meta.stack) {
				lines.push(
					...meta.stack
						.split('\n')
						.slice(1, 6)
						.map((line) => `${indent}  ${Theme.fg('gray600', line.trim())}`),
				);
			}
			return lines;
		}
		if (typeof meta === 'object' && meta !== null) {
			try {
				lines.push(
					...JSON.stringify(meta, null, 2)
						.split('\n')
						.map((line) => `${indent}${Theme.fg('gray500', line)}`),
				);
			} catch {
				lines.push(`${indent}${Theme.fg('gray500', String(meta))}`);
			}
			return lines;
		}
		lines.push(`${indent}${Theme.fg('gray500', String(meta))}`);
		return lines;
	}

	/** Core write path shared by every level helper. */
	log(level: LogLevel, message: string, meta?: unknown): void {
		if (!this.shouldLog(level)) {
			return;
		}
		Logger.counters.records++;
		if (level === LogLevel.Warn) {
			Logger.counters.warnings++;
		}
		if (level >= LogLevel.Error) {
			Logger.counters.errors++;
		}

		const stream: 'stdout' | 'stderr' = level >= LogLevel.Error ? 'stderr' : 'stdout';
		if (Logger.options.json) {
			this.emit(this.asJson(level, message, meta), stream);
			return;
		}

		const prefix = this.prefix(level);
		const colour: ColorName =
			level >= LogLevel.Error
				? 'redSoft'
				: level >= LogLevel.Warn
					? 'amber'
					: level === LogLevel.Success
						? 'gray100'
						: 'gray200';
		const [first = '', ...rest] = message.split('\n');
		const indent = ' '.repeat(Theme.width(prefix));
		const output = [
			`${prefix}${Theme.fg(colour, first)}`,
			...rest.map((line) => `${indent}${Theme.fg(colour, line)}`),
			...this.details(meta, indent),
		];
		this.emit(output.join('\n'), stream);
	}

	trace(message: string, meta?: unknown): void {
		this.log(LogLevel.Trace, message, meta);
	}

	debug(message: string, meta?: unknown): void {
		this.log(LogLevel.Debug, message, meta);
	}

	info(message: string, meta?: unknown): void {
		this.log(LogLevel.Info, message, meta);
	}

	success(message: string, meta?: unknown): void {
		this.log(LogLevel.Success, message, meta);
	}

	warn(message: string, meta?: unknown): void {
		this.log(LogLevel.Warn, message, meta);
	}

	error(message: string, meta?: unknown): void {
		this.log(LogLevel.Error, message, meta);
	}

	fatal(message: string, meta?: unknown): void {
		this.log(LogLevel.Fatal, message, meta);
	}

	/** Prints a raw, already formatted string without a prefix. */
	raw(text: string): void {
		process.stdout.write(`${text}\n`);
	}

	blank(): void {
		process.stdout.write('\n');
	}

	/** `-- Section ----------------------------` heading. */
	divider(label?: string): void {
		const width = Math.max(24, Math.min(Theme.terminalWidth(120), 78));
		const glyph = Theme.glyph;
		if (!label) {
			this.raw(Theme.rule(width));
			return;
		}
		const head = Theme.repeat(glyph.horizontal, 2);
		const text = ` ${Theme.fg('gray300', label)} `;
		const remaining = Math.max(0, width - head.length - Theme.width(text));
		this.raw(
			Theme.fg('gray700', head) +
				text +
				Theme.fg('gray700', Theme.repeat(glyph.horizontal, remaining)),
		);
	}

	/** Bordered block, used for preflight info and failure reports. */
	panel(title: string, lines: readonly string[], options: PanelOptions = {}): void {
		this.raw(Blocks.panel(lines, { title, ...options }));
	}

	/** Aligned `label value` list. */
	keyValues(rows: ReadonlyArray<readonly [string, string]>, options?: KeyValueOptions): void {
		this.raw(Blocks.keyValues(rows, options));
	}

	/** ` 3/9  message` progress step. */
	step(index: number, total: number, message: string, meta?: unknown): void {
		this.info(`${ProgressBar.step(index, total)} ${message}`, meta);
	}
}



