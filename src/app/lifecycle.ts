/**
 * @file Process lifecycle: exit codes and signal driven shutdown.
 *
 * The application owns exactly one `AbortController`. SIGINT/SIGTERM abort it,
 * so in-flight workers stop at their next await, while the caller still runs its
 * `finally` block (cache flush + webhook queue drain). Keeping this here means
 * the CLI and the application never touch `process.on` directly.
 */

import { Logger } from '../ui/logger';

/** Process exit codes used by the CLI contract. */
export const ExitCode = {
	Success: 0,
	Failure: 1,
	Usage: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface LifecycleHooks {
	/** Runs after the abort signal fired; used to flush queues early. */
	onSignal?(signal: NodeJS.Signals): void | Promise<void>;
}

export class ProcessLifecycle {
	private readonly controller = new AbortController();
	private readonly log = new Logger('app');
	private installed = false;

	/** Signal handed to the quest engine. */
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	get aborted(): boolean {
		return this.controller.signal.aborted;
	}

	/** Registers SIGINT/SIGTERM handlers exactly once. */
	install(hooks: LifecycleHooks = {}): void {
		if (this.installed) {
			return;
		}
		this.installed = true;
		for (const name of ['SIGINT', 'SIGTERM'] as const) {
			process.once(name, () => {
				this.log.warn(`Received ${name}; aborting workers and flushing state`);
				this.controller.abort();
				void Promise.resolve(hooks.onSignal?.(name)).catch(() => undefined);
			});
		}
	}

	/** Aborts without a signal, e.g. when a run fails hard. */
	abort(): void {
		this.controller.abort();
	}
}
