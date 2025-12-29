import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Load env file based on `mode` in the current directory
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [react()],

		// Development server configuration
		server: {
			host: '::',
			port: 3000,
			cors: true,
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
					"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com", // Required for React dev + Turnstile
					"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://rsms.me",
					"font-src 'self' https://fonts.gstatic.com https://rsms.me",
					"img-src 'self' data: blob: https://*.supabase.co",
					"connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
					"frame-src https://challenges.cloudflare.com",
					"frame-ancestors 'self'",
				].join('; '),
			},
		},

		// Preview server (production build preview)
		preview: {
			host: '::',
			port: 3000,
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
			sourcemap: mode === 'development',
			// Optimize chunk size
			rollupOptions: {
				output: {
					manualChunks: {
						'vendor-react': ['react', 'react-dom', 'react-router-dom'],
						'vendor-ui': [
							'@radix-ui/react-alert-dialog',
							'@radix-ui/react-avatar',
							'@radix-ui/react-checkbox',
							'@radix-ui/react-dialog',
							'@radix-ui/react-dropdown-menu',
							'@radix-ui/react-label',
							'@radix-ui/react-progress',
							'@radix-ui/react-scroll-area',
							'@radix-ui/react-select',
							'@radix-ui/react-separator',
							'@radix-ui/react-slider',
							'@radix-ui/react-slot',
							'@radix-ui/react-switch',
							'@radix-ui/react-tabs',
							'@radix-ui/react-toast',
							'@radix-ui/react-tooltip',
							'lucide-react',
							'framer-motion',
							'class-variance-authority',
							'clsx',
							'tailwind-merge',
						],
						'vendor-editor': [
							'@tiptap/extension-image',
							'@tiptap/extension-link',
							'@tiptap/extension-placeholder',
							'@tiptap/extension-underline',
							'@tiptap/react',
							'@tiptap/starter-kit',
							'@measured/puck',
						],
						'vendor-charts': ['recharts'],
						'vendor-maps': ['leaflet', 'react-leaflet'],
						'vendor-utils': ['date-fns', 'i18next', 'react-i18next'],
						'vendor-supabase': ['@supabase/supabase-js'],
					},
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
		},

		// Define global constants
		define: {
			__APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
		},
	};
});
