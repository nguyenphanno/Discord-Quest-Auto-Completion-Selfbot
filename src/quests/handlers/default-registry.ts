import { achievementInActivityHandler } from './achievement-in-activity';
import { playActivityHandler } from './play-activity';
import { playOnPlatformHandler } from './play-on-platform';
import { TaskHandlerRegistry } from './registry';
import { streamUnsupportedHandler, unsupportedTaskHandler } from './unsupported';
import { watchVideoHandler } from './watch-video';

export function defaultRegistry(): TaskHandlerRegistry {
	return new TaskHandlerRegistry([
		watchVideoHandler,
		playOnPlatformHandler,
		playActivityHandler,
		achievementInActivityHandler,
		streamUnsupportedHandler,
		unsupportedTaskHandler,
	]);
}
