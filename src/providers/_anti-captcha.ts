/**
 * @file Anti-Captcha - `https://anti-captcha.com`.
 *
 * The reference implementation that most newer vendors copied; its
 * `createTask` / `getTaskResult` protocol is the reason the shared client in
 * `_task-based.ts` exists.
 */

import type { CaptchaProvider, CaptchaProviderOptions } from './_provider';
import { TaskBasedCaptchaProvider } from './_task-based';
import type { TaskBasedVendor } from './_task-based';

export const ANTI_CAPTCHA_VENDOR: TaskBasedVendor = {
	id: 'anti-captcha',
	label: 'Anti-Captcha',
	baseUrl: 'https://api.anti-captcha.com',
	note: 'mature service, supports a very broad task catalogue',
};

export function createAntiCaptchaProvider(
	apiKey: string,
	options: CaptchaProviderOptions = {},
): CaptchaProvider {
	return new TaskBasedCaptchaProvider(ANTI_CAPTCHA_VENDOR, apiKey, options);
}
