/**
 * @file ASCII wordmark + startup header rendered in the middle of the
 * terminal, plus a compact fallback for narrow windows.
 *
 * The wordmark is stored as trimmed rows. Row 0 originally lost its four
 * leading spaces when the artwork was embedded, so it is normalised here to
 * keep the `d`/`i` glyph tops aligned with the rows underneath.
 */

import { Theme } from './_theme';

export interface BannerOptions {
	/** Artwork rows, defaults to the built-in wordmark. */
	art?: readonly string[];
	/** Subtitle under the wordmark (product name). */
	subtitle?: string;
	/** Metadata line under the subtitle (version / runtime). */
	meta?: string;
	/** Target width, defaults to the detected terminal width. */
	width?: number;
	/** Colour ramp start, defaults to Discord blurple. */
	gradientFrom?: Parameters<typeof Theme.mix>[0];
	/** Colour ramp end. */
	gradientTo?: Parameters<typeof Theme.mix>[0];
	/** Adds a blank line above the wordmark. */
	leadingBlank?: boolean;
	/** Adds a blank line below the rule. */
	trailingBlank?: boolean;
}

const WORDMARK: readonly string[] = [
	'     _ _                       _                             _                 _  __ _           _',
	'  __| (_)___  ___ ___  _ __ __| |       __ _ _   _  ___  ___| |_      ___  ___| |/ _| |__   ___ | |_',
	" / _` | / __|/ __/ _ \\| '__/ _` |_____ / _` | | | |/ _ \\/ __| __|____/ __|/ _ \\ | |_| '_ \\ / _ \\| __|",
	"| (_| | \\__ \\ (_| (_) | | | (_| |_____| (_| | |_| |  __/\\__ \\ ||_____\\__ \\  __/ |  _| |_) | (_) | |_",
	' \\__,_|_|___/\\___\\___/|_|  \\__,_|      \\__, |\\__,_|\\___||___/\\__|    |___/\\___|_|_| |_.__/ \\___/ \\__|',
	'                                          |_|',
];

/** Visible width shared by every artwork row. */
function measure(rows: readonly string[]): number {
	return rows.reduce((max, row) => Math.max(max, Theme.width(row)), 0);
}

export class Banner extends null {
	/** Raw wordmark rows, exposed so other modules can re-use the artwork. */
	static readonly wordmark: readonly string[] = WORDMARK;

	/** Greatest visible width of the built-in wordmark. */
	static get artWidth(): number {
		return measure(WORDMARK);
	}

	/**
	 * Paints pre-padded rows with a diagonal colour ramp so the top-left is
	 * blurple and the bottom-right drifts towards pink.
	 */
	private static paint(rows: readonly string[], artWidth: number): string[] {
		const height = Math.max(rows.length - 1, 1);
		const span = Math.max(artWidth - 1, 1);
		return rows.map((row, rowIndex) =>
			Array.from(row)
				.map((character, columnIndex) => {
					if (character === ' ') {
						return character;
					}
					const t = (rowIndex / height) * 0.45 + (columnIndex / span) * 0.55;
					return Theme.fg(Theme.mix('blurple', 'fuchsia', t), character);
				})
				.join(''),
		);
	}

	/** Single-line fallback used when the terminal is too narrow. */
	private static compact(options: BannerOptions, width: number): string[] {
		const title = options.subtitle ?? 'Discord Quest Auto-Completion Selfbot';
		const inner = Math.max(20, Math.min(width - 4, title.length + 4));
		const glyph = Theme.glyph;
		const line = (left: string, right: string, fill: string): string =>
			Theme.fg('gray700', left + Theme.repeat(fill, inner) + right);
		return [
			line(glyph.topLeft, glyph.topRight, glyph.horizontal),
			Theme.fg('gray700', glyph.vertical) +
				Theme.padEnd(Theme.bold(Theme.fg('blurpleSoft', `  ${title}`)), inner) +
				Theme.fg('gray700', glyph.vertical),
			line(glyph.bottomLeft, glyph.bottomRight, glyph.horizontal),
		];
	}

	/**
	 * Renders the full startup header: centred wordmark, subtitle, metadata
	 * line and a dim rule aligned with the artwork.
	 */
	static render(options: BannerOptions = {}): string {
		// Non-interactive streams report no width; 120 keeps the full wordmark
		// visible in CI logs while real terminals still adapt when narrow.
		const width = options.width ?? Theme.terminalWidth(120);
		const artwork = options.art ?? WORDMARK;
		const artWidth = measure(artwork);
		const lines: string[] = [];

		if (options.leadingBlank !== false) {
			lines.push('');
		}

		// Rows must share one width, otherwise independent centring would smear
		// the glyphs horizontally.
		const padded = artwork.map((row) => Theme.padEnd(row, artWidth));
		const body =
			width < artWidth + 2
				? Banner.compact(options, width)
				: Banner.paint(padded, artWidth);
		body.forEach((line) => lines.push(Theme.center(line, width)));

		const subtitle = options.subtitle ?? 'Discord Quest Auto-Completion Selfbot';
		lines.push('');
		lines.push(Theme.center(Theme.fg('gray200', subtitle), width));

		if (options.meta) {
			lines.push(Theme.center(Theme.fg('gray500', options.meta), width));
		}

		lines.push('');
		const contentWidth = measure(body);
		const ruleWidth = Math.max(24, Math.min(width - 2, contentWidth));
		lines.push(Theme.center(Theme.rule(ruleWidth), width));

		if (options.trailingBlank !== false) {
			lines.push('');
		}

		return lines.join('\n');
	}
}

