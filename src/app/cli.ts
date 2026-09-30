/**
 * @file CLI argument parsing.
 *
 * Deliberately dependency free: the command surface is small enough that a
 * plain argv scan is clearer (and testable) than a CLI framework.
 */

export type CliCommand = 'start' | 'list' | 'redeem' | 'dry-run' | 'status' | 'watch' | 'help';

const COMMANDS: readonly CliCommand[] = [
	'start',
	'list',
	'redeem',
	'dry-run',
	'status',
	'watch',
];

const HELP_FLAGS = new Set(['help', '--help', '-h']);

/** Parses `process.argv` into a command plus an explicit-help flag. */
export function parseArgv(argv: readonly string[]): { command: CliCommand; help: boolean } {
	const args = argv.slice(2);
	// Help wins over everything: `start --help` still prints the usage text.
	if (args.some((item) => HELP_FLAGS.has(item))) {
		return { command: 'help', help: true };
	}
	const argument = args.find((item) => !item.startsWith('-'));
	// `--watch` turns the default `start` run into the polling loop.
	if (args.includes('--watch') && (!argument || argument === 'start')) {
		return { command: 'watch', help: false };
	}
	if (!argument) {
		return { command: 'start', help: false };
	}
	if (HELP_FLAGS.has(argument)) {
		return { command: 'help', help: true };
	}
	if (COMMANDS.includes(argument as CliCommand)) {
		return { command: argument as CliCommand, help: false };
	}
	// Unknown commands print the usage text and exit with code 2.
	return { command: 'help', help: true };
}

export const usage = `Usage: quest-runner <command> [--watch]

Commands:
  start       Run actionable quests (default)
  list        Display the quest board without writing progress
  redeem      Claim completed quest rewards only
  dry-run     Print the work that start would perform
  status      Display local cache statistics
  watch       Repeat start every WATCH_POLL_MS (also: start --watch)
  help        Show this message`;

