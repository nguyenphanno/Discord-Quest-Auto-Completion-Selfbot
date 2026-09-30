import { describe, expect, it } from 'vitest';

import { parseArgv, usage } from '../../../src/app/cli';

describe('parseArgv', () => {
	it('defaults to start', () => {
		expect(parseArgv(['node', 'main.ts'])).toEqual({ command: 'start', help: false });
	});

	it.each(['start', 'list', 'redeem', 'dry-run', 'status', 'watch'])(
		'accepts %s',
		(command) => {
			expect(parseArgv(['node', 'main.ts', command])).toEqual({ command, help: false });
		},
	);

	it('turns start --watch into watch', () => {
		expect(parseArgv(['node', 'main.ts', 'start', '--watch'])).toEqual({
			command: 'watch',
			help: false,
		});
	});

	it('turns a bare --watch into watch', () => {
		expect(parseArgv(['node', 'main.ts', '--watch'])).toEqual({ command: 'watch', help: false });
	});

	it('ignores --watch for an explicit non-start command', () => {
		expect(parseArgv(['node', 'main.ts', 'list', '--watch'])).toEqual({
			command: 'list',
			help: false,
		});
	});

	it.each(['help', '--help', '-h'])('treats %s as help', (flag) => {
		expect(parseArgv(['node', 'main.ts', flag])).toEqual({ command: 'help', help: true });
	});

	it('falls back to help for an unknown command', () => {
		expect(parseArgv(['node', 'main.ts', 'nope'])).toEqual({ command: 'help', help: true });
	});

	it('documents every command in the usage text', () => {
		for (const command of ['start', 'list', 'redeem', 'dry-run', 'status', 'watch', 'help']) {
			expect(usage).toContain(command);
		}
	});
});
