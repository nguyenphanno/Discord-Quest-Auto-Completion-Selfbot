/**
 * @file CLI entry point.
 *
 * Parses the subcommand, loads the configuration and hands the run to
 * `QuestBotApplication`. Exit codes: `0` success, `1` run failure, `2` usage.
 */

import { QuestBotApplication } from './app/application';
import { parseArgv, usage } from './app/cli';
import { ExitCode } from './app/lifecycle';
import { loadConfig } from './config/load';

const HELP_FLAGS = new Set(['help', '--help', '-h']);

async function main(): Promise<void> {
	const { command, help } = parseArgv(process.argv);
	if (help || command === 'help') {
		process.stdout.write(`${usage}\n`);
		process.exitCode = HELP_FLAGS.has(process.argv[2] ?? '') ? ExitCode.Success : ExitCode.Usage;
		return;
	}

	const config = loadConfig();
	// `dry-run` never mutates the loaded config object; it is copied.
	const application = new QuestBotApplication(
		command === 'dry-run' ? { ...config, dryRun: true } : config,
	);
	process.exitCode = await application.run(command);
}

void main();

