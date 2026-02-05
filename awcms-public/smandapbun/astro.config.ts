import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import icon from 'astro-icon';

const renderMode = process.env.PUBLIC_PORTAL_RENDER_MODE || 'server';
const isStaticOutput = renderMode === 'static';
const adapter = isStaticOutput
  ? undefined
  : cloudflare({
    imageService: 'compile',
    sessionKVBindingName: 'SESSION',
  });

export default defineConfig({
  site: 'https://sman2pangkalanbun.sch.id',
  output: isStaticOutput ? 'static' : 'server',
  adapter,
  integrations: [
    react(),
    sitemap(),
    icon({
      include: {
        tabler: ['*'],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: process.argv.includes('build') ? {
        'react-dom/server': 'react-dom/server.edge',
      } : undefined,
    },
  },
  i18n: {
    defaultLocale: 'id',
    locales: ['id', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
