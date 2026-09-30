/**
 * @file Terminal theme - 24-bit truecolor palette, ANSI escape helpers and
 * glyph tables used by every piece of console output.
 *
 * Every visual primitive lives here so that no other module has to deal with
 * raw escape sequences. Colour is disabled automatically for non-interactive
 * streams (unless `FORCE_COLOR` is set) and the box-drawing glyphs fall back to
 * pure ASCII when `LOG_ASCII=true`, which keeps output readable on legacy
 * Windows consoles and in log collectors that strip Unicode.
 */

export type Rgb = readonly [number, number, number];

/**
 * Neutral-first palette. The UI body text is intentionally grey so that the
 * few accents (status badges, quest names, rewards) carry the reader's focus.
 */
export const Palette = {
	// Neutral ramp - body copy, chrome and borders.
	gray950: [10, 11, 14],
	gray900: [20, 22, 27],
	gray800: [31, 34, 42],
	gray700: [46, 51, 62],
	gray600: [68, 74, 88],
	gray500: [99, 106, 122],
	gray400: [136, 145, 163],
	gray300: [175, 183, 199],
	gray200: [210, 216, 228],
	gray100: [238, 241, 246],
	white: [255, 255, 255],

	// Accents - reserved for state and identity, never for decoration.
	blurple: [88, 101, 242],
	blurpleSoft: [124, 138, 248],
	violet: [154, 120, 255],
	fuchsia: [235, 69, 158],
	pink: [246, 138, 193],
	red: [237, 66, 69],
	redSoft: [242, 120, 121],
	orange: [240, 150, 70],
	amber: [250, 190, 88],
	yellow: [254, 231, 92],
	lime: [150, 220, 130],
	green: [67, 204, 128],
	teal: [56, 205, 180],
	cyan: [70, 200, 240],
	blue: [86, 156, 250],
} as const;

export type ColorName = keyof typeof Palette;

export interface GlyphSet {
	/** Vertical border. */
	vertical: string;
	/** Horizontal border. */
	horizontal: string;
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	teeLeft: string;
	teeRight: string;
	teeTop: string;
	teeBottom: string;
	cross: string;
	bullet: string;
	arrow: string;
	check: string;
	ballot: string;
	dot: string;
	spinner: readonly string[];
	barFull: string;
	barEmpty: string;
}

const UNICODE_GLYPHS: GlyphSet = {
	vertical: '\u2502',
	horizontal: '\u2500',
	topLeft: '\u250c',
	topRight: '\u2510',
	bottomLeft: '\u2514',
	bottomRight: '\u2518',
	teeLeft: '\u251c',
	teeRight: '\u2524',
	teeTop: '\u252c',
	teeBottom: '\u2534',
	cross: '\u253c',
	bullet: '\u2022',
	arrow: '\u2192',
	check: '\u2713',
	ballot: '\u2717',
	dot: '\u00b7',
	spinner: [
		'\u280b',
		'\u2819',
		'\u2839',
		'\u2838',
		'\u283c',
		'\u2834',
		'\u2826',
		'\u2827',
		'\u2807',
		'\u280f',
	],
	barFull: '\u2588',
	barEmpty: '\u2591',
};

const ASCII_GLYPHS: GlyphSet = {
	vertical: '|',
	horizontal: '-',
	topLeft: '+',
	topRight: '+',
	bottomLeft: '+',
	bottomRight: '+',
	teeLeft: '+',
	teeRight: '+',
	teeTop: '+',
	teeBottom: '+',
	cross: '+',
	bullet: '*',
	arrow: '->',
	check: '+',
	ballot: 'x',
	dot: '.',
	spinner: ['|', '/', '-', '\\'],
	barFull: '#',
	barEmpty: '.',
};

export interface ThemeOptions {
	/** Use pure ASCII glyphs instead of Unicode box drawing. */
	ascii?: boolean;
	/** Force colour output on/off regardless of TTY detection. */
	color?: boolean;
}

const CSI = '\u001b[';
const OSC = '\u001b]';
const BEL = '\u0007';

export class Theme extends null {
	/** Whether ANSI 24-bit colour sequences are emitted. */
	static colorEnabled: boolean = Theme.detectColorSupport();

	/** Whether box-drawing characters are replaced with ASCII equivalents. */
	static asciiMode: boolean = false;

	static get glyph(): GlyphSet {
		return Theme.asciiMode ? ASCII_GLYPHS : UNICODE_GLYPHS;
	}

	/** Applies process-wide rendering preferences. */
	static configure(options: ThemeOptions = {}): void {
		if (typeof options.ascii === 'boolean') {
			Theme.asciiMode = options.ascii;
		}
		if (typeof options.color === 'boolean') {
			Theme.colorEnabled = options.color;
		}
	}

	/**
	 * Resolves colour support following the `NO_COLOR` / `FORCE_COLOR` de-facto
	 * standards, then falls back to TTY detection.
	 */
	static detectColorSupport(env: NodeJS.ProcessEnv = process.env): boolean {
		if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
			return false;
		}
		const forced = env.FORCE_COLOR;
		if (forced !== undefined && forced !== '') {
			return forced !== '0' && forced.toLowerCase() !== 'false';
		}
		if (env.TERM === 'dumb') {
			return false;
		}
		if (env.GITHUB_ACTIONS === 'true') {
			return true;
		}
		if (process.stdout.isTTY === true) {
			return true;
		}
		if (process.stdout.isTTY === false) {
			return false;
		}
		return Boolean(env.CI);
	}

	static resolveColor(color: ColorName | Rgb): Rgb {
		return typeof color === 'string' ? Palette[color] : color;
	}

	/** Foreground colour. */
	static fg(color: ColorName | Rgb, text: string): string {
		if (!Theme.colorEnabled || text === '') {
			return text;
		}
		const [r, g, b] = Theme.resolveColor(color);
		return `${CSI}38;2;${r};${g};${b}m${text}${CSI}39m`;
	}

	/** Background colour. */
	static bg(color: ColorName | Rgb, text: string): string {
		if (!Theme.colorEnabled || text === '') {
			return text;
		}
		const [r, g, b] = Theme.resolveColor(color);
		return `${CSI}48;2;${r};${g};${b}m${text}${CSI}49m`;
	}

	static bold(text: string): string {
		return Theme.style(text, '1', '22');
	}

	static dim(text: string): string {
		return Theme.style(text, '2', '22');
	}

	static italic(text: string): string {
		return Theme.style(text, '3', '23');
	}

	static underline(text: string): string {
		return Theme.style(text, '4', '24');
	}

	static invert(text: string): string {
		return Theme.style(text, '7', '27');
	}

	private static style(text: string, on: string, off: string): string {
		if (!Theme.colorEnabled || text === '') {
			return text;
		}
		return `${CSI}${on}m${text}${CSI}${off}m`;
	}

	/** Renders a clickable OSC-8 hyperlink when the terminal supports it. */
	static link(text: string, url: string): string {
		if (!Theme.colorEnabled) {
			return `${text} (${url})`;
		}
		return `${OSC}8;;${url}${BEL}${Theme.underline(Theme.fg('cyan', text))}${OSC}8;;${BEL}`;
	}

	/** Removes ANSI (CSI + OSC) sequences so a string can be measured. */
	static strip(text: string): string {
		return text
			.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
			.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
	}

	/** Printable width of a string, ignoring escape sequences. */
	static width(text: string): number {
		return Theme.strip(text).length;
	}

	/** Pads with `fill` until the *visible* width reaches `width`. */
	static padEnd(text: string, width: number, fill = ' '): string {
		const missing = width - Theme.width(text);
		return missing > 0 ? text + fill.repeat(missing) : text;
	}

	static padStart(text: string, width: number, fill = ' '): string {
		const missing = width - Theme.width(text);
		return missing > 0 ? fill.repeat(missing) + text : text;
	}

	/** Centres a string horizontally, ignoring escape sequences. */
	static center(text: string, width: number): string {
		const missing = width - Theme.width(text);
		if (missing <= 0) {
			return text;
		}
		return ' '.repeat(Math.floor(missing / 2)) + text;
	}

	/** Truncates plain (un-styled) text to `width` visible characters. */
	static truncate(text: string, width: number, suffix = '\u2026'): string {
		const plain = Theme.strip(text);
		if (plain.length <= width) {
			return text;
		}
		if (width <= suffix.length) {
			return plain.slice(0, Math.max(0, width));
		}
		return plain.slice(0, width - suffix.length) + suffix;
	}

	static repeat(char: string, count: number): string {
		return count > 0 ? char.repeat(count) : '';
	}

	/** A dim horizontal rule spanning `width` columns. */
	static rule(width: number = Theme.terminalWidth(), char?: string): string {
		return Theme.fg('gray700', Theme.repeat(char ?? Theme.glyph.horizontal, width));
	}

	/** Linear interpolation between two colours, `t` clamped to `[0, 1]`. */
	static mix(from: ColorName | Rgb, to: ColorName | Rgb, t: number): Rgb {
		const a = Theme.resolveColor(from);
		const b = Theme.resolveColor(to);
		const ratio = Math.min(1, Math.max(0, t));
		return [
			Math.round(a[0] + (b[0] - a[0]) * ratio),
			Math.round(a[1] + (b[1] - a[1]) * ratio),
			Math.round(a[2] + (b[2] - a[2]) * ratio),
		];
	}

	/**
	 * Paints each non-whitespace character with an interpolated colour.
	 * Whitespace is deliberately left untouched so copy/paste stays clean.
	 */
	static gradient(text: string, from: ColorName | Rgb, to: ColorName | Rgb): string {
		if (!Theme.colorEnabled) {
			return text;
		}
		const characters = Array.from(text);
		const span = Math.max(characters.length - 1, 1);
		return characters
			.map((character, index) => {
				if (character === ' ' || character === '\t') {
					return character;
				}
				return Theme.fg(Theme.mix(from, to, index / span), character);
			})
			.join('');
	}

	/** Best-effort terminal width with a sane fallback for piped output. */
	static terminalWidth(fallback = 80): number {
		const columns = process.stdout.columns;
		return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
			? columns
			: fallback;
	}
}
