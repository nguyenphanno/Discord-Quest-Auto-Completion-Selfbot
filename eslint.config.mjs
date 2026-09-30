import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		// Generated artefacts and local state are not source.
		ignores: ['node_modules/', 'coverage/', 'reports/', '.cache/', 'dist/'],
	},
	...tseslint.configs.recommended,
	{
		// The flat config itself is plain ESM JavaScript, so the TypeScript
		// specific rules do not apply to it.
		files: ['**/*.js', '**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
		rules: { '@typescript-eslint/no-require-imports': 'off' },
	},
);

