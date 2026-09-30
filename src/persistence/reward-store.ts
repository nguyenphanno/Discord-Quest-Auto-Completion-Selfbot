import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RewardCode { questId: string; code: string; skuId: string; savedAt: string; }

/** Small local append-only store. Codes are never printed by the application. */
export class RewardStore {
	constructor(private readonly path: string) {}

	record(questId: string, code: string, skuId: string): void {
		const existing = this.all().filter((entry) => entry.questId !== questId || entry.code !== code);
		existing.push({ questId, code, skuId, savedAt: new Date().toISOString() });
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
	}

	all(): RewardCode[] {
		try { const value: unknown = JSON.parse(readFileSync(this.path, 'utf8')); return Array.isArray(value) ? value.filter((item): item is RewardCode => Boolean(item && typeof item === 'object' && typeof (item as RewardCode).code === 'string')) : []; } catch { return []; }
	}
}
