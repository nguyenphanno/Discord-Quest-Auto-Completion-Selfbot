/**
 * @file Vitest global setup.
 *
 * The console UI is silenced so test output stays readable; assertions never
 * depend on rendered output.
 */

import { Logger, LogLevel } from '../src/ui/logger';
import { Theme } from '../src/ui/theme';

Logger.configure({ level: LogLevel.Silent, json: false, timestamps: false });
Theme.configure({ color: false, ascii: true });
