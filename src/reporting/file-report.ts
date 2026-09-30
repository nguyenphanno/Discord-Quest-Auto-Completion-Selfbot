import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QuestRunResult } from '../quests/model/types';

export async function writeRunReport(
	directory: string,
	report: { startedAt: string; finishedAt: string; results: QuestRunResult[] },
): Promise<string> {
	await mkdir(directory, { recursive: true });
	const stamp = report.finishedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
	const path = join(directory, `run-${stamp}.json`);
	await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	return path;
}
