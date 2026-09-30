import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			// Frozen protocol replicas and the constants module are data, not logic.
			exclude: ['src/discord/fingerprints.ts', 'src/discord/constants.ts'],
			thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
		},
	},
});

