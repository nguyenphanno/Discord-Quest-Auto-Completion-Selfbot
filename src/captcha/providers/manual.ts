/**
 * @file Manual (interactive) captcha provider.
 *
 * Restores the escape hatch the original project left commented out: instead of
 * failing when Discord raises a challenge, the run pauses and asks for the
 * token. Useful when no solver is configured, when every solver is rejected, or
 * for debugging the claim flow. Disabled automatically when stdin is not a TTY,
 * so it can never hang a CI run.
 */

import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { CaptchaChallenge, CaptchaProvider, CaptchaSolution } from './provider';
import { CaptchaProviderError } from './provider';
import { Async } from '../../shared/async';

export class ManualCaptchaProvider implements CaptchaProvider {
	readonly id = 'manual';
	readonly label = 'Manual prompt';
	readonly requiresCredentials = false;

	constructor(private readonly timeoutMs = 180_000) {}

	/** Whether an interactive prompt can be shown at all. */
	static get available(): boolean {
		return Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
	}

	/** Asks a single question on stdin and always releases the interface. */
	private async ask(question: string): Promise<string> {
		const rl = readline.createInterface({ input: stdin, output: stdout });
		try {
			return await rl.question(question);
		} finally {
			rl.close();
		}
	}

	async solveHcaptcha(challenge: CaptchaChallenge): Promise<CaptchaSolution> {
		if (!ManualCaptchaProvider.available) {
			throw new CaptchaProviderError(
				'Manual captcha input needs an interactive terminal',
				this.id,
				'NOT_INTERACTIVE',
			);
		}

		const sitekey = `${challenge.sitekey.slice(0, 12)}...`;
		stdout.write(
			`\n  Open ${challenge.url} and solve the hCaptcha (site key ${sitekey}).\n` +
				`  You have ${Math.round(this.timeoutMs / 1000)}s to paste the token.\n`,
		);

		let answer: string;
		try {
			answer = await Async.withTimeout(
				this.ask('  token > '),
				this.timeoutMs,
				'manual captcha input',
			);
		} catch (error) {
			throw new CaptchaProviderError(
				`Manual captcha input failed: ${error instanceof Error ? error.message : String(error)}`,
				this.id,
				'INPUT_FAILED',
			);
		}

		const token = answer.trim();
		if (!token) {
			throw new CaptchaProviderError(
				'No captcha token was entered',
				this.id,
				'EMPTY_TOKEN',
			);
		}
		return { token, provider: this.id };
	}

	describe(): string {
		return 'Manual prompt - pauses the run and asks for the token on stdin';
	}
}
