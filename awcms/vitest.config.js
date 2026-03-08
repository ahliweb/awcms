import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/setupTests.js'],
        exclude: [...configDefaults.exclude, 'e2e/**'],
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
