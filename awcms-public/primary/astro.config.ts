import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "astro/config";

import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import partytown from "@astrojs/partytown";
import icon from "astro-icon";
import compress from "astro-compress";
import type { AstroIntegration, AstroUserConfig } from "astro";
import cloudflare from "@astrojs/cloudflare";

import astrowind from "./vendor/integration";

import {
  readingTimeRemarkPlugin,
  responsiveTablesRehypePlugin,
  lazyImagesRehypePlugin,
} from "./src/utils/frontmatter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hasExternalScripts = false;
const whenExternalScripts = (
  items: (() => AstroIntegration) | (() => AstroIntegration)[] = [],
) =>
  hasExternalScripts
    ? Array.isArray(items)
      ? items.map((item) => item())
      : [items()]
    : [];

import react from "@astrojs/react";

function optimizeWorkerdDeps() {
  return {
    name: "awcms-workerd-deps",
    configEnvironment(environment: string) {
      if (environment === "client") {
        return;
      }

      return {
        optimizeDeps: {
          include: [
            "astro-icon",
            "astro-embed",
            "@astro-community/astro-embed-bluesky",
            "@iconify/utils",
            "@iconify/utils > debug",
            "@atproto/api",
            "@atproto/common-web",
            "@atproto/lexicon",
            "@atproto/xrpc",
            "@atproto/syntax",
            "debug",
          ],
        },
      };
    },
  };
}

export default defineConfig({
  output: "static",
  adapter: cloudflare({ imageService: "compile" }),

  // KNOWN DEV-ONLY QUIRK: In Astro dev mode you may see:
  //   [WARN] [router] A getStaticPaths() route pattern was matched, but no
  //   matching static path was found for requested path `/en/`.
  // Root cause: the `[...blog]` catch-all matches `/en/` (trailing slash) before
  // `en/index.astro` can handle it, because Astro's dev router has no redirect-aware
  // trailing-slash guard. The `@astrojs/cloudflare` adapter sets `build.redirects: false`,
  // so the `redirects` config option cannot suppress this in dev mode.
  // In production (Cloudflare Pages static build), the correct page is served and
  // no warning exists. This is non-blocking and safe to ignore during local development.
  // Upstream reference: https://github.com/withastro/astro/issues/12036

  integrations: [
    react(),
    sitemap(),
    mdx(),
    icon({
      include: {
        tabler: ["*"],
        "flat-color-icons": [
          "template",
          "gallery",
          "approval",
          "document",
          "advertising",
          "currency-exchange",
          "voice-presentation",
          "business-contact",
          "database",
        ],
      },
    }),

    ...whenExternalScripts(() =>
      partytown({
        config: { forward: ["dataLayer.push"] },
      }),
    ),

    compress({
      CSS: true,
      HTML: {
        "html-minifier-terser": {
          removeAttributeQuotes: false,
        },
      },
      Image: false,
      JavaScript: true,
      SVG: false,
      Logger: 1,
    }),

    astrowind({
      config: "./src/config.yaml",
    }),
  ],

  image: {
    domains: ["cdn.pixabay.com"],
  },

  markdown: {
    remarkPlugins: [readingTimeRemarkPlugin],
    rehypePlugins: [responsiveTablesRehypePlugin, lazyImagesRehypePlugin],
  },

  vite: {
    plugins: [tailwindcss(), optimizeWorkerdDeps()] as NonNullable<
      AstroUserConfig["vite"]
    >["plugins"],
    resolve: {
      alias: {
        "~": path.resolve(__dirname, "./src"),
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
});
