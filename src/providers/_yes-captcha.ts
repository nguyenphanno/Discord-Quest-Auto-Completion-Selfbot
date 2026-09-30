/**
 * @file YesCaptcha - `https://yescaptcha.com`.
 *
 * Cheap and widely used, but Discord's hCaptcha integration answers `10008`
 * (invalid site key / verification failed) for a large share of requests, so
 * treat this provider as best-effort.
 */

import type { CaptchaProvider, CaptchaProviderOptions } from './_provider';
import { TaskBasedCaptchaProvider } from './_task-based';
import type { TaskBasedVendor } from './_task-based';

export const YES_CAPTCHA_VENDOR: TaskBasedVendor = {
	id: 'yescaptcha',
	label: 'YesCaptcha',
	baseUrl: 'https://api.yescaptcha.com',
	note: 'inexpensive hCaptcha solving, but Discord often answers error 10008',
};

export function createYesCaptchaProvider(
	apiKey: string,
	options: CaptchaProviderOptions = {},
): CaptchaProvider {
	return new TaskBasedCaptchaProvider(YES_CAPTCHA_VENDOR, apiKey, options);
}
