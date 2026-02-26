import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const MANUAL_CHUNK_GROUPS = [
	{
		name: 'vendor-react',
		packages: ['react', 'react-dom', 'react-router-dom'],
	},
	{
		name: 'vendor-ui',
		packages: [
			'@radix-ui/',
			'@floating-ui/',
			'lucide-react',
			'framer-motion',
			'class-variance-authority',
			'clsx',
			'tailwind-merge',
		],
	},
	{
		name: 'vendor-editor',
		packages: ['@tiptap/', '@puckeditor/'],
	},
	{
		name: 'vendor-charts',
		packages: ['recharts'],
	},
	{
		name: 'vendor-maps',
		packages: ['leaflet', 'react-leaflet'],
	},
	{
		name: 'vendor-utils',
		packages: ['date-fns', 'i18next', 'react-i18next'],
	},
	{
		name: 'vendor-supabase',
		packages: ['@supabase/supabase-js'],
	},
];

const getNodeModulePackageName = (id) => {
	const normalizedId = id.replace(/\\/g, '/');
	const match = normalizedId.match(/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
	return match?.[1];
};

const isPackageRuleMatch = (packageName, rule) =>
	rule.endsWith('/') ? packageName.startsWith(rule) : packageName === rule;

const getManualChunkName = (id) => {
	if (!id.includes('node_modules')) {
		return undefined;
	}

	const packageName = getNodeModulePackageName(id);
	if (!packageName) {
		return undefined;
	}

	for (const chunkGroup of MANUAL_CHUNK_GROUPS) {
		if (chunkGroup.packages.some((rule) => isPackageRuleMatch(packageName, rule))) {
			return chunkGroup.name;
		}
	}

	return undefined;
};

export default defineConfig(({ mode }) => {
	// Load env file based on `mode` in the current directory
	const env = loadEnv(mode, process.cwd(), '');

	// Parse CORS allowed origins
	const corsAllowedOrigins = env.VITE_CORS_ALLOWED_ORIGINS
		? env.VITE_CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
		: true; // Default to true (allow all) if not set

	return {
		plugins: [react(), tailwindcss()],

		// Development server configuration
		server: {
			host: '::',
			port: 3000,
			cors: typeof corsAllowedOrigins === 'boolean' ? corsAllowedOrigins : { origin: corsAllowedOrigins },
			// Vite 7 Warmup: Pre-transform critical modules to kill startup waterfall
			warmup: {
				clientFiles: [
					'./src/main.jsx',
					'./src/components/layouts/*.jsx',
					'./src/contexts/*.jsx',
					'./src/components/ui/*.jsx'
				],
			},
			// Security headers (OWASP aligned)
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'X-Frame-Options': 'SAMEORIGIN',
				'X-XSS-Protection': '1; mode=block',
				'Referrer-Policy': 'strict-origin-when-cross-origin',
				'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
				// CSP: Allow Supabase and self
				'Content-Security-Policy': [
					"default-src 'self'",
					"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com", // Required for React dev + Turnstile
					"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://rsms.me",
					"font-src 'self' https://fonts.gstatic.com https://rsms.me",
					"img-src 'self' data: blob: https://*.supabase.co http://127.0.0.1:54321 http://localhost:54321",
					"connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://cloudflareinsights.com http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321",
					"frame-src https://challenges.cloudflare.com",
					"frame-ancestors 'self'",
				].join('; '),
			},
		},

		// Preview server (production build preview)
		preview: {
			host: '::',
			port: 3000,
			cors: typeof corsAllowedOrigins === 'boolean' ? corsAllowedOrigins : { origin: corsAllowedOrigins },
		},

		// Path resolution
		resolve: {
			extensions: ['.jsx', '.js', '.tsx', '.ts', '.json'],
			alias: {
				'@': path.resolve(__dirname, './src'),
				'@plugins': path.resolve(__dirname, './src/plugins'),
			},
		},

		// Build configuration
		build: {
			outDir: 'dist',
			target: 'baseline-widely-available', // Vite 7 default for modern browsers
			sourcemap: mode === 'development',
			// Optimize chunk size
			rollupOptions: {
				output: {
					manualChunks: (id) => getManualChunkName(id),
				},
			},
			// Increase chunk size warning limit for large apps
			chunkSizeWarningLimit: 1000,
		},

		// Optimize dependencies
		optimizeDeps: {
			include: [
				'react',
				'react-dom',
				'react-router-dom',
				'@supabase/supabase-js',
			],
			exclude: [],
		},

		// Define global constants
		define: {
			__APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
		},
	};
});
