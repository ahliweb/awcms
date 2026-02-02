import { defineConfig } from 'astro/config';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://sman2pangkalanbun.sch.id',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    sessionKVBindingName: 'SESSION',
  }),
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
  },
  i18n: {
    defaultLocale: 'id',
    locales: ['id', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
