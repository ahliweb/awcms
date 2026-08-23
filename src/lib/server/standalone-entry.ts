/**
 * The production server entrypoint (Issue #464) — a thin wrapper around the
 * handler `@astrojs/node` already builds, NOT a re-implementation of it.
 *
 * ## The defect this exists to close
 *
 * `@astrojs/node` (`mode: "standalone"`) composes its request handler like
 * this — `node_modules/@astrojs/node/dist/standalone.js`:
 *
 * ```js
 * staticHandler(req, res, () => appHandler(req, res));
 * ```
 *
 * The static handler runs FIRST, and `appHandler` — the only thing that runs
 * `src/middleware.ts` — is merely its fallback for a path with no file behind
 * it. Every file that really exists under `dist/client/` therefore answered
 * with NO security headers at all: no `X-Content-Type-Options`, no
 * `X-Frame-Options`, no `Referrer-Policy`, no `Permissions-Policy`, no
 * COOP/CORP, no `X-Correlation-ID`, and never through the edge-cache
 * annotator. That is `public/js/news-share.js`, `public/css/public-content.css`,
 * and the whole of `_astro/**`.
 *
 * Two comments in this repo asserted the opposite and were relied upon as
 * invariants — `astro.config.mjs` ("dipasang `src/middleware.ts` ke SETIAP
 * response") and `src/middleware.ts` ("Routing ALL responses ... guarantees no
 * response ever reaches Varnish unlabelled"). Both were true of rendered
 * responses and false of static files. Both now say what they actually cover.
 *
 * The consequences on today's file set are modest — two own-origin assets plus
 * hashed bundles, all served with a correct MIME type by `send`. What made it
 * worth closing rather than documenting is that the invariant is load-bearing:
 * it is the stated reason there is no second header layer anywhere. Drop one
 * `.html` file into `public/` and it is served as a document with no CSP and no
 * `X-Frame-Options`; a service worker (Issue #466) lands on the same path.
 *
 * ## Why a wrapper and not our own static server
 *
 * `createStandaloneHandler` is what `entry.mjs` EXPORTS as `handler`, and it
 * carries a lot of correctness we would otherwise have to re-earn: `send`'s
 * conditional GET, range requests, 304s, `trailingSlash` redirects, dotfile
 * denial with a `.well-known` exception, and the `assetsDir` immutable
 * `Cache-Control`. Re-implementing that to add four headers would trade a
 * header bug for a much worse class of bug. So this file:
 *
 *   1. sets `ASTRO_NODE_AUTOSTART=disabled` BEFORE importing the built entry
 *      (hence the dynamic `import()` — a static one is hoisted above the
 *      assignment and the adapter would bind its own port first);
 *   2. installs the security headers on the response with `setHeader` BEFORE
 *      delegating, so they are already in place whichever branch answers;
 *   3. hands the request to the adapter's own handler, unchanged.
 *
 * Step 2 is a FLOOR, not an override. Node merges `writeHead(status, headers)`
 * over anything `setHeader` put there, with the `writeHead` object winning on
 * a name collision — so a rendered response still carries exactly the values
 * `src/middleware.ts` computed, and only responses that would have carried
 * nothing gain anything. `buildSecurityHeaders` stays the single owner of the
 * policy (the reason `astro.config.mjs` refuses Astro's own `security.csp`);
 * this file adds no header of its own invention.
 *
 * The specifier is built as a variable rather than a literal so the bundler
 * leaves it as a runtime import: `dist/standalone-entry.mjs` + `./server/entry.mjs`
 * resolves to `dist/server/entry.mjs`, which only exists after `astro build`.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

import { log } from "../logging/logger";
import { buildSecurityHeaders } from "../security/security-headers";
import { isTurnstileRequired } from "../security/turnstile";
import { isVideoEmbedEnabled } from "../security/video-embed";

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = "localhost";

/** Resolved at runtime, never bundled — see the module header. */
const ASTRO_ENTRY_SPECIFIER = "./server/entry.mjs";

type AstroNodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

type AstroNodeEntry = {
  handler: AstroNodeHandler;
  options?: { port?: number; host?: string | boolean };
};

/**
 * Mirrors `standalone.js`'s own `hostOptions` — `host: true` means "every
 * interface", `false` means loopback only. Kept identical so switching to this
 * entrypoint cannot quietly change which interfaces the server binds.
 */
function resolveHost(configured: string | boolean | undefined): string {
  if (typeof configured === "boolean") {
    return configured ? "0.0.0.0" : DEFAULT_HOST;
  }

  return configured ?? DEFAULT_HOST;
}

/**
 * The same call `src/middleware.ts` makes, deliberately per-request rather
 * than hoisted: two identical call sites that read the same env at the same
 * moment cannot drift, and both inputs are plain env reads.
 */
export function applySecurityHeaders(
  /** Structural, not `ServerResponse`: only the side effect is used, and a test double should not have to fake 60-odd unrelated members to stand in here. */
  res: { setHeader(name: string, value: string): unknown },
  env: NodeJS.ProcessEnv = process.env
): void {
  for (const [name, value] of buildSecurityHeaders({
    isProduction: env.APP_ENV === "production",
    turnstileEnabled: isTurnstileRequired(env),
    // ADR-0110 — see `src/middleware.ts`: the same switch, read from the SAME
    // `env` the rest of this function uses, because these two call sites must
    // produce the same policy or a static asset and a page would disagree
    // about what the site permits.
    videoEmbedEnabled: isVideoEmbedEnabled(env)
  })) {
    res.setHeader(name, value);
  }
}

export function createRequestListener(handler: AstroNodeHandler) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    applySecurityHeaders(res);
    handler(req, res);
  };
}

async function main(): Promise<void> {
  // Must precede the import below: the adapter's built entry calls
  // `startServer()` at module scope unless this is set, which would bind the
  // port with the un-wrapped handler and make this file a no-op.
  process.env.ASTRO_NODE_AUTOSTART = "disabled";

  const entry = (await import(ASTRO_ENTRY_SPECIFIER)) as AstroNodeEntry;
  const port = process.env.PORT
    ? Number(process.env.PORT)
    : (entry.options?.port ?? DEFAULT_PORT);
  const host = process.env.HOST ?? resolveHost(entry.options?.host);
  const listener = createRequestListener(entry.handler);

  // TLS termination in-process, same two env vars `standalone.js` honours —
  // dropping it here would silently break any deployment that uses them.
  const server =
    process.env.SERVER_CERT_PATH && process.env.SERVER_KEY_PATH
      ? https.createServer(
          {
            cert: fs.readFileSync(process.env.SERVER_CERT_PATH),
            key: fs.readFileSync(process.env.SERVER_KEY_PATH)
          },
          listener
        )
      : http.createServer(listener);

  server.listen(port, host, () => {
    log("info", "server.listening", { host, port });
  });
}

/**
 * Guarded so the module can be IMPORTED (by `tests/standalone-entry.test.ts`)
 * without binding a port or reaching for a build output that may not exist.
 * `import.meta.main` is true for the module Bun was pointed at, which after
 * `bun run build:server-entry` is the bundled `dist/standalone-entry.mjs` —
 * the bundler preserves it, and `tests/standalone-entry.test.ts` asserts the
 * built artifact still starts.
 */
if (import.meta.main) {
  await main();
}
