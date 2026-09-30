import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class EnrollCooldownStore {
	constructor(private readonly path: string) {}
	lastEnrollAt(accountId: string): Date | null {
		try { const data = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>; const value = data[accountId]; const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; } catch { return null; }
	}
	recordEnroll(accountId: string, at: Date): void {
		let entries: Record<string, string> = {}; try { entries = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>; } catch { /* start empty */ }
		entries[accountId] = at.toISOString(); mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
	}
	isBlocked(accountId: string, now: Date, windowMs: number): boolean { const last = this.lastEnrollAt(accountId); return Boolean(last && now.getTime() - last.getTime() < windowMs); }
}
