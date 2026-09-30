import { Async } from '../shared/async';

export async function runWatchLoop(options: {
	pollMs: number;
	signal: AbortSignal;
	runOnce: () => Promise<number>;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<number> {
	const sleep = options.sleep ?? Async.sleep;
	let result = 0;
	do {
		if (options.signal.aborted) break;
		result = await options.runOnce();
		if (options.signal.aborted || options.pollMs <= 0) break;
		try { await sleep(options.pollMs, options.signal); } catch { break; }
	} while (!options.signal.aborted);
	return result;
}
