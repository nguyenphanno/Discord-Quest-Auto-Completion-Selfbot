/**
 * @file CLI entry point.
 *
 * Parses the subcommand, loads the configuration and hands the run to
 * `QuestBotApplication`. Exit codes: `0` success, `1` run failure, `2` usage.
 */

import { QuestBotApplication, printCannotStart } from './app/application';
import { parseArgv, usage } from './app/cli';
import { ExitCode } from './app/lifecycle';
import { loadConfig } from './config/load';
import { Async } from './shared/async';
import type { QuestBotConfig } from './config/schema';

const HELP_FLAGS = new Set(['help', '--help', '-h']);

/**
 * Reads the environment into a config object.
 *
 * `loadConfig` is expected to tolerate anything, but a defensive boundary here
 * guarantees the operator never gets a raw stack where the CANNOT START panel
 * belongs - that panel is the documented UX for a bad configuration.
 */
function readConfig(): QuestBotConfig | null {
	try {
		return loadConfig();
	} catch (error) {
		printCannotStart([`Configuration could not be read: ${Async.errorMessage(error)}`]);
		return null;
	}
}

async function main(): Promise<void> {
	const { command, help } = parseArgv(process.argv);
	if (help || command === 'help') {
		process.stdout.write(`${usage}\n`);
		process.exitCode = HELP_FLAGS.has(process.argv[2] ?? '') ? ExitCode.Success : ExitCode.Usage;
		return;
	}

	const config = readConfig();
	if (!config) {
		process.exitCode = ExitCode.Failure;
		return;
	}
	// `dry-run` never mutates the loaded config object; it is copied.
	const application = new QuestBotApplication(
		command === 'dry-run' ? { ...config, dryRun: true } : config,
	);
	process.exitCode = await application.run(command);
}

void main();

