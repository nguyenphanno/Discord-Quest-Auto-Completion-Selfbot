/**
 * @file Reusable console building blocks: bordered panels, key/value lists,
 * aligned tables and progress bars. Cells are plain strings so callers can
 * colour individual values with `Theme` before handing them over.
 */

import { ColorName, Theme } from './theme';
import { Time } from '../shared/time';

export interface TableColumn {
	title: string;
	align?: 'left' | 'right' | 'center';
}

export interface PanelOptions {
	/** Panel title rendered into the top border. */
	title?: string;
	/** Accent colour of the borders. Defaults to `gray700`. */
	color?: ColorName;
	/** Optional bullet drawn in front of every body line. */
	bullet?: string;
	/** Hard cap for the panel width. */
	width?: number;
}

export interface KeyValueOptions {
	/** Minimum label column width. */
	labelWidth?: number;
	/** Optional bullet drawn in front of each row. */
	bullet?: string;
}

export interface TableOptions {
	/** Indent applied to the whole table. Defaults to 2 spaces. */
	indent?: number;
	/** Accent colour of the borders. Defaults to `gray700`. */
	color?: ColorName;
	/** Colour used for header cells. Defaults to `gray200`. */
	headerColor?: ColorName;
	/** Colour used for body cells. Defaults to `gray300`. */
	cellColor?: ColorName;
}

export interface ProgressBarOptions {
	/** Character width of the bar itself. Defaults to 24. */
	width?: number;
	/** Whether to append the numeric percentage. Defaults to true. */
	showPercent?: boolean;
	/** Colour of the filled portion. Defaults to `cyan`. */
	color?: ColorName;
	/** Optional trailing label, already colourised by the caller. */
	suffix?: string;
}

export class Blocks extends null {
	/** Inner width (excluding the two border columns) of a panel. */
	private static innerWidth(lines: readonly string[], options: PanelOptions): number {
		const bulletPadding = options.bullet ? 2 : 0;
		const content = lines.reduce(
			(max, line) => Math.max(max, Theme.width(line) + bulletPadding),
			0,
		);
		const titleLength = options.title ? Theme.width(options.title) + 2 : 0;
		const desired = Math.max(content, titleLength, 20) + 2;
		const available = Math.max(12, (options.width ?? Theme.terminalWidth(120)) - 4);
		return Math.min(desired, available);
	}

	/**
	 * Draws a bordered panel. Long lines are truncated so the border never
	 * breaks, which keeps pasted log excerpts readable.
	 */
	static panel(lines: readonly string[], options: PanelOptions = {}): string {
		const glyph = Theme.glyph;
		const border = (text: string): string => Theme.fg(options.color ?? 'gray700', text);
		const inner = Blocks.innerWidth(lines, options);
		const label = options.title ? ` ${options.title} ` : '';
		const labelWidth = Theme.width(label);
		const fill = Math.max(0, inner - labelWidth - (label ? 1 : 0));
		const top =
			glyph.topLeft +
			border(glyph.horizontal) +
			Theme.bold(Theme.fg('gray200', label)) +
			border(Theme.repeat(glyph.horizontal, fill)) +
			glyph.topRight;
		const bottom =
			glyph.bottomLeft + Theme.repeat(glyph.horizontal, inner) + glyph.bottomRight;
		const side = border(glyph.vertical);

		const body = lines.map((line) => {
			const bulletPadding = options.bullet ? 2 : 0;
			const prefix = options.bullet ? Theme.fg('gray600', `${options.bullet} `) : '';
			const content = prefix + Theme.truncate(line, inner - 2 - bulletPadding);
			return `${side} ${Theme.padEnd(content, inner - 2)} ${side}`;
		});

		return [border(top), ...body, border(bottom)].join('\n');
	}

	/** Aligned `label -> value` rows with a dim bullet gutter. */
	static keyValues(
		rows: ReadonlyArray<readonly [string, string]>,
		options: KeyValueOptions = {},
	): string {
		const bullet = options.bullet ?? Theme.glyph.dot;
		const labelWidth = rows.reduce(
			(max, [label]) => Math.max(max, Theme.width(label), options.labelWidth ?? 0),
			0,
		);
		const gutter = Theme.fg('gray700', `${bullet} `);
		return rows
			.map(([label, value]) => {
				const padded = Theme.padEnd(Theme.fg('gray400', label), labelWidth);
				return `  ${gutter}${padded}  ${Theme.fg('gray200', value)}`;
			})
			.join('\n');
	}

	/** Compact bordered table with per-column alignment and truncation. */
	static table(
		columns: readonly TableColumn[],
		rows: ReadonlyArray<ReadonlyArray<string>>,
		options: TableOptions = {},
	): string {
		const glyph = Theme.glyph;
		const border = (text: string): string => Theme.fg(options.color ?? 'gray700', text);
		const indent = ' '.repeat(options.indent ?? 2);
		const widths = columns.map((column, columnIndex) =>
			rows.reduce(
				(max, row) => Math.max(max, Theme.width(row[columnIndex] ?? '')),
				Theme.width(column.title),
			),
		);

		const renderRow = (cells: readonly string[], colour: ColorName | null): string => {
			const content = cells
				.map((cell, columnIndex) => {
					const width = widths[columnIndex] ?? 0;
					const align = columns[columnIndex]?.align ?? 'left';
					const plain = Theme.truncate(cell, width);
					let padded: string;
					if (align === 'right') {
						padded = Theme.padStart(plain, width);
					} else if (align === 'center') {
						padded = Theme.padEnd(Theme.center(plain, width), width);
					} else {
						padded = Theme.padEnd(plain, width);
					}
					return ` ${colour ? Theme.fg(colour, padded) : padded} `;
				})
				.join(border(glyph.vertical));
			return `${indent}${border(glyph.vertical)}${content}${border(glyph.vertical)}`;
		};

		const divider = (left: string, middle: string, right: string): string =>
			indent +
			border(
				left +
					widths
						.map((width) => Theme.repeat(glyph.horizontal, width + 2))
						.join(middle) +
					right,
			);

		return [
			divider(glyph.topLeft, glyph.teeTop, glyph.topRight),
			renderRow(
				columns.map((column) => column.title),
				options.headerColor ?? 'gray200',
			),
			divider(glyph.teeLeft, glyph.cross, glyph.teeRight),
			...rows.map((row) => renderRow(row, options.cellColor ?? 'gray300')),
			divider(glyph.bottomLeft, glyph.teeBottom, glyph.bottomRight),
		].join('\n');
	}
}

export class ProgressBar extends null {
	/** `████████░░░░░░░░  33%` - a fixed-width bar that never shifts layout. */
	static render(done: number, total: number, options: ProgressBarOptions = {}): string {
		const width = Math.max(4, options.width ?? 24);
		const percent = Time.percent(done, total);
		const filled = Math.round((percent / 100) * width);
		const glyph = Theme.glyph;
		const bar =
			Theme.fg(options.color ?? 'cyan', Theme.repeat(glyph.barFull, filled)) +
			Theme.fg('gray700', Theme.repeat(glyph.barEmpty, width - filled));
		const parts = [bar];
		if (options.showPercent !== false) {
			parts.push(Theme.fg('gray300', `${String(Math.round(percent)).padStart(3)}%`));
		}
		if (options.suffix) {
			parts.push(options.suffix);
		}
		return parts.join('  ');
	}

	/** `████░░  33%  12m 30s of 45m 00s` */
	static withTiming(
		doneSeconds: number,
		totalSeconds: number,
		options: ProgressBarOptions = {},
	): string {
		const suffix =
			options.suffix ??
			Theme.fg(
				'gray500',
				`${Time.duration(doneSeconds)} of ${Time.duration(totalSeconds)}`,
			);
		return ProgressBar.render(doneSeconds, totalSeconds, { ...options, suffix });
	}

	/** ` 3/9 ` badge printed in front of quest headers. */
	static step(index: number, total: number): string {
		const digits = String(total).length;
		const value = `${String(index).padStart(digits, ' ')}/${String(total).padEnd(digits, ' ')}`;
		return Theme.bg('gray800', Theme.fg('gray200', ` ${value} `));
	}
}
