/**
 * @file CapSolver - `https://capsolver.com`.
 *
 * Same protocol once more. CapSolver returns a per-solution `userAgent` for
 * hCaptcha jobs, which the shared client forwards so the token can be replayed
 * with a matching fingerprint.
 */

import type { CaptchaProvider, CaptchaProviderOptions } from './_provider';
import { TaskBasedCaptchaProvider } from './_task-based';
import type { TaskBasedVendor } from './_task-based';

export const CAP_SOLVER_VENDOR: TaskBasedVendor = {
	id: 'capsolver',
	label: 'CapSolver',
	baseUrl: 'https://api.capsolver.com',
	note: 'returns the user agent that must accompany the token',
};

export function createCapSolverProvider(
	apiKey: string,
	options: CaptchaProviderOptions = {},
): CaptchaProvider {
	return new TaskBasedCaptchaProvider(CAP_SOLVER_VENDOR, apiKey, options);
}
