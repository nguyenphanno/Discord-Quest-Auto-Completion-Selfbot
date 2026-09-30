/**
 * @file CapMonster Cloud - `https://capmonster.cloud`.
 *
 * Speaks the same protocol as Anti-Captcha. CapMonster's own models are usually
 * the fastest hCaptcha solvers, which matters because Discord's challenge token
 * has a short lifetime.
 */

import type { CaptchaProvider, CaptchaProviderOptions } from './_provider';
import { TaskBasedCaptchaProvider } from './_task-based';
import type { TaskBasedVendor } from './_task-based';

export const CAP_MONSTER_VENDOR: TaskBasedVendor = {
	id: 'capmonster',
	label: 'CapMonster Cloud',
	baseUrl: 'https://api.capmonster.cloud',
	note: 'fast in-house models, good latency for short-lived tokens',
};

export function createCapMonsterProvider(
	apiKey: string,
	options: CaptchaProviderOptions = {},
): CaptchaProvider {
	return new TaskBasedCaptchaProvider(CAP_MONSTER_VENDOR, apiKey, options);
}
