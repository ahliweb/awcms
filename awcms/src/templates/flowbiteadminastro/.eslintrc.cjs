module.exports = {
	root: true,
	env: {
		browser: true,
		es2022: true,
		node: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
	ignorePatterns: ['dist/', 'node_modules/'],
	overrides: [
		{
			files: ['*.astro'],
			parser: 'astro-eslint-parser',
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
				parser: '@typescript-eslint/parser',
				extraFileExtensions: ['.astro'],
			},
			extends: ['plugin:astro/recommended'],
		},
	],
};
