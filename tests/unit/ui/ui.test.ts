import { afterEach, describe, expect, it } from 'vitest';

import { Logger, LogLevel, logLevelName, parseLogLevel } from '../../../src/ui/logger';
import { Palette, Theme } from '../../../src/ui/theme';
import { Blocks, ProgressBar } from '../../../src/ui/progress';

/** Captures everything the logger writes to stdout while `body` runs. */
function captureStdout(body: () => void): string {
	const written: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string) => {
		written.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		body();
	} finally {
		process.stdout.write = original;
	}
	return written.join('');
}

describe('parseLogLevel', () => {
	it('falls back for an empty value', () => {
		expect(parseLogLevel(undefined)).toBe(LogLevel.Info);
		expect(parseLogLevel('', LogLevel.Warn)).toBe(LogLevel.Warn);
	});

	it('parses every documented level case-insensitively', () => {
		expect(parseLogLevel('trace')).toBe(LogLevel.Trace);
		expect(parseLogLevel('DEBUG')).toBe(LogLevel.Debug);
		expect(parseLogLevel(' success ')).toBe(LogLevel.Success);
		expect(parseLogLevel('silent')).toBe(LogLevel.Silent);
	});

	it('falls back for an unknown level', () => {
		expect(parseLogLevel('loud', LogLevel.Warn)).toBe(LogLevel.Warn);
	});

	it('labels every level', () => {
		expect(logLevelName(LogLevel.Error)).toBe('ERROR');
		expect(logLevelName(999 as LogLevel)).toBe('INFO');
	});
});

describe('Logger', () => {
	afterEach(() => {
		Logger.configure({ level: LogLevel.Silent, json: false, timestamps: false });
		Logger.resetStats();
	});

	it('drops every record below the configured level', () => {
		Logger.configure({ level: LogLevel.Warn, json: false, timestamps: false });
		const output = captureStdout(() => {
			const log = new Logger('unit');
			log.info('hidden');
			log.warn('shown');
		});
		expect(output).toContain('shown');
		expect(output).not.toContain('hidden');
	});

	it('emits newline-delimited JSON when asked', () => {
		Logger.configure({ level: LogLevel.Info, json: true, timestamps: false });
		const output = captureStdout(() => new Logger('unit').info('structured'));
		const record = JSON.parse(output.trim()) as { message: string; scope: string };
		expect(record.message).toBe('structured');
		expect(record.scope).toBe('unit');
	});

	it('prints raw text and blank lines untouched', () => {
		const written: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		try {
			const log = new Logger('unit');
			log.raw('plain');
			log.blank();
		} finally {
			process.stdout.write = original;
		}
		expect(written).toEqual(['plain\n', '\n']);
	});

	it('counts warnings and errors for the summary', () => {
		Logger.configure({ level: LogLevel.Trace, json: false, timestamps: false });
		captureStdout(() => {
			const log = new Logger('unit');
			log.warn('one');
			log.warn('two');
			log.error('bad');
		});
		const snapshot = Logger.stats();
		expect(snapshot.warnings).toBe(2);
		expect(snapshot.errors).toBe(1);
	});

	it('resets the counters', () => {
		Logger.configure({ level: LogLevel.Trace, json: false, timestamps: false });
		captureStdout(() => new Logger('unit').warn('one'));
		Logger.resetStats();
		expect(Logger.stats().warnings).toBe(0);
	});

	it('derives a nested scope', () => {
		expect(new Logger('quest').child('video').scopeName).toBe('quest:video');
	});
});

describe('Theme', () => {
	it('returns the text unchanged when colour is disabled', () => {
		expect(Theme.fg('red', 'text')).toBe('text');
		expect(Theme.bold('text')).toBe('text');
	});

	it('renders a link as text plus url without colour', () => {
		expect(Theme.link('Quest', 'https://discord.com/quests/1')).toBe(
			'Quest (https://discord.com/quests/1)',
		);
	});

	it('strips escape sequences before measuring', () => {
		expect(Theme.strip('\u001b[31mred\u001b[39m')).toBe('red');
		expect(Theme.width('\u001b[31mred\u001b[39m')).toBe(3);
	});

	it('pads to a visible width and centres text', () => {
		expect(Theme.padEnd('ab', 5)).toBe('ab   ');
		expect(Theme.padStart('ab', 5)).toBe('   ab');
		expect(Theme.padEnd('abcdef', 3)).toBe('abcdef');
		expect(Theme.center('ab', 6)).toBe('  ab');
	});

	it('truncates to the requested width', () => {
		expect(Theme.truncate('abcdef', 4)).toBe('abc\u2026');
		expect(Theme.truncate('abc', 10)).toBe('abc');
		expect(Theme.truncate('abcdef', 1)).toBe('a');
	});

	it('repeats and rules without colour', () => {
		expect(Theme.repeat('-', 3)).toBe('---');
		expect(Theme.repeat('-', 0)).toBe('');
		expect(Theme.rule(4)).toBe('----');
	});

	it('interpolates between two palette colours', () => {
		expect(Theme.mix('gray900', 'white', 0)).toEqual([...Palette.gray900]);
		expect(Theme.mix('gray900', 'white', 1)).toEqual([...Palette.white]);
		const mid = Theme.mix('gray900', 'white', 0.5);
		expect(mid[0]).toBeGreaterThan(Palette.gray900[0]);
		expect(mid[0]).toBeLessThan(Palette.white[0]);
	});

	it('clamps the interpolation ratio', () => {
		expect(Theme.mix('gray900', 'white', -5)).toEqual([...Palette.gray900]);
		expect(Theme.mix('gray900', 'white', 5)).toEqual([...Palette.white]);
	});

	it('leaves a gradient untouched without colour', () => {
		expect(Theme.gradient('abc', 'red', 'blue')).toBe('abc');
	});

	it('falls back to a sane terminal width', () => {
		expect(Theme.terminalWidth(80)).toBeGreaterThan(0);
	});
});

describe('Blocks and ProgressBar', () => {
	it('draws a panel whose borders line up', () => {
		const panel = Blocks.panel(['first line', 'a much longer body line'], { title: 'Status' });
		const lines = panel.split('\n');
		expect(lines[0]).toContain('Status');
		for (const line of lines) {
			expect(line.length).toBe(lines[0]?.length ?? -1);
		}
	});

	it('renders a progress bar with a clamped percentage', () => {
		expect(ProgressBar.render(0, 100)).toContain('  0%');
		expect(ProgressBar.render(50, 100)).toContain(' 50%');
		expect(ProgressBar.render(500, 100)).toContain('100%');
	});

	it('omits the percentage when asked', () => {
		expect(ProgressBar.render(50, 100, { showPercent: false })).not.toContain('%');
	});

	it('appends a timing suffix', () => {
		expect(ProgressBar.withTiming(30, 60)).toContain('30s of 1m 00s');
	});

	it('formats a step badge as index/total', () => {
		expect(Theme.strip(ProgressBar.step(3, 9)).trim()).toBe('3/9');
	});

	it('aligns key/value rows into a single label column', () => {
		const output = Blocks.keyValues([
			['Token', 'masked'],
			['Concurrency', '2'],
		]);
		const lines = output.split('\n');
		expect(lines).toHaveLength(2);
		const labelColumn = lines.map((line) => line.indexOf(':') === -1 ? line.search(/\S\S/) : 0);
		expect(labelColumn[0]).toBe(labelColumn[1]);
		expect(output).toContain('masked');
	});

	it('honours the minimum label width and bullet', () => {
		const output = Blocks.keyValues([['a', '1']], { labelWidth: 10, bullet: '-' });
		expect(output).toContain('- a');
	});

	it('renders a table with a header row and one line per row', () => {
		const table = Blocks.table(
			[{ title: 'Quest' }, { title: 'Progress', align: 'right' }],
			[
				['Watch a video', '10/20s'],
				['A much longer quest name', '600/600s'],
			],
		);
		const lines = table.split('\n');
		expect(lines).toHaveLength(6);
		expect(lines[1]).toContain('Quest');
		expect(lines[3]).toContain('Watch a video');
	});

	it('renders an empty table with only the frame and the header', () => {
		const table = Blocks.table([{ title: 'Quest' }], []);
		expect(table.split('\n')).toHaveLength(4);
		expect(table).toContain('Quest');
	});
});
