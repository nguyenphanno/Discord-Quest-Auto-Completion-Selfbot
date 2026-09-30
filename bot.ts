/**
 * @file Entry point.
 *
 * All behaviour lives in `src/_app.ts`; this file only resolves configuration
 * and maps the run result onto the process exit code.
 *
 * Runtime layout:
 *   src/_app.ts              run lifecycle (banner, preflight, summary)
 *   src/core/                configuration, protocol constants, patched client
 *   src/domain/              quest entity, quest manager, wire types
 *   src/services/            captcha, build info, activity bridge, webhook, cache
 *   src/providers/           captcha provider registry
 *   src/ui/                  theme, logger, banner, tables and progress bars
 *   src/utils/               async, http and time helpers
 */

import { QuestBotApplication } from './src/_app';
import { Config } from './src/core/_config';
import { Logger } from './src/ui/_logger';

const application = new QuestBotApplication(Config.load());

application
	.start()
	.then((exitCode) => {
		process.exitCode = exitCode;
	})
	.catch((error: unknown) => {
		Logger.root.fatal('Failure outside the quest run cycle', error);
		process.exitCode = 1;
	});
