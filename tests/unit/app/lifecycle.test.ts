import { describe, expect, it } from 'vitest';

import { ExitCode, ProcessLifecycle } from '../../../src/app/lifecycle';
import { Banner } from '../../../src/ui/banner';

describe('ExitCode', () => {
	it('keeps the documented CLI contract', () => {
		expect(ExitCode.Success).toBe(0);
		expect(ExitCode.Failure).toBe(1);
		expect(ExitCode.Usage).toBe(2);
	});
});

describe('ProcessLifecycle', () => {
	it('starts with a live signal', () => {
		const lifecycle = new ProcessLifecycle();
		expect(lifecycle.aborted).toBe(false);
		expect(lifecycle.signal.aborted).toBe(false);
	});

	it('aborts the shared signal on demand', () => {
		const lifecycle = new ProcessLifecycle();
		lifecycle.abort();
		expect(lifecycle.aborted).toBe(true);
		expect(lifecycle.signal.aborted).toBe(true);
	});

	it('installs signal handlers exactly once', () => {
		const lifecycle = new ProcessLifecycle();
		const listeners: Array<() => void> = [];
		const original = process.listeners('SIGINT');
		process.on('SIGINT', () => listeners.push(() => undefined));
		try {
			lifecycle.install();
			lifecycle.install();
		} finally {
			for (const listener of process.listeners('SIGINT')) {
				if (!original.includes(listener as () => void)) {
					process.off('SIGINT', listener as () => void);
				}
			}
		}
		expect(lifecycle.aborted).toBe(false);
	});
});

describe('Banner', () => {
	it('exposes the wordmark rows and their width', () => {
		expect(Banner.wordmark.length).toBeGreaterThan(3);
		expect(Banner.artWidth).toBeGreaterThan(40);
	});

	it('renders the wordmark with a subtitle and a rule', () => {
		const output = Banner.render({ width: 120, subtitle: 'Discord Quest Runner', meta: 'v2.0.0' });
		expect(output).toContain('Discord Quest Runner');
		expect(output).toContain('v2.0.0');
		expect(output.split('\n').length).toBeGreaterThan(Banner.wordmark.length);
	});

	it('falls back to a compact header on a narrow terminal', () => {
		const output = Banner.render({ width: 30, subtitle: 'Quest Runner' });
		expect(output).toContain('Quest Runner');
		expect(output.split('\n').length).toBeLessThan(Banner.wordmark.length + 6);
	});

	it('omits the optional blank lines', () => {
		const output = Banner.render({ width: 120, leadingBlank: false, trailingBlank: false });
		expect(output.startsWith('\n')).toBe(false);
	});

	it('accepts custom artwork', () => {
		const output = Banner.render({ art: ['  CUSTOM  '], width: 40, subtitle: 'x' });
		expect(output).toContain('CUSTOM');
	});
});
