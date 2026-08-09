/**
 * Issue #464 — the production entrypoint applies the security headers to
 * responses `src/middleware.ts` never sees.
 *
 * The defect was not that `buildSecurityHeaders` was wrong; it was and is
 * correct, and `tests/security-headers-csp.test.ts` has always passed. The
 * defect was that a whole class of response never reached the code that calls
 * it — `@astrojs/node` answers anything present in `dist/client/` from its own
 * static handler and only falls through to the app (and therefore to
 * middleware) when no file matches.
 *
 * That shape is why the interesting test here is not "does the builder return
 * four headers". It is the MERGE: this wrapper installs headers with
 * `setHeader` and then hands the response to a handler that will call
 * `writeHead(status, headersObject)`. If Node treated that object as a
 * replacement rather than a merge, the wrapper would set headers that are
 * silently dropped a millisecond later — passing every unit test and shipping
 * the original bug. So the merge is asserted against a REAL `node:http`
 * server, both directions:
 *
 *   - a name the handler does not set survives to the client (the fix works);
 *   - a name the handler DOES set keeps the handler's value (the wrapper is a
 *     floor, not an override — a rendered response must still carry exactly
 *     what middleware computed).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  applySecurityHeaders,
  createRequestListener
} from "../src/lib/server/standalone-entry";

const read = (file: string) => readFileSync(file, "utf8");

/** The four `security:readiness` treats as required, plus the two COOP/CORP add. */
const EXPECTED_HEADERS = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy"
];

async function fetchThrough(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<Response> {
  const server = http.createServer(createRequestListener(handler));

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address() as AddressInfo;

    return await fetch(`http://127.0.0.1:${port}/anything.css`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("standalone entry — security headers on static responses", () => {
  test("a response whose handler never touches these headers still carries them", async () => {
    const response = await fetchThrough((_req, res) => {
      // Exactly what `send` does for a static file: its own headers, via
      // writeHead, with no idea this wrapper exists.
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      res.end("body{}");
    });

    for (const header of EXPECTED_HEADERS) {
      expect(response.headers.get(header)).not.toBeNull();
    }

    // The handler's own headers are untouched — this must not become a
    // wrapper that "helpfully" rewrites content type or caching.
    expect(response.headers.get("content-type")).toBe(
      "text/css; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  test("a header the handler sets itself WINS — the wrapper is a floor, not an override", async () => {
    // A rendered response arrives here already carrying middleware's values.
    // If the wrapper won instead, every future middleware-level decision (a
    // per-route CSP relaxation, say) would be silently discarded.
    const response = await fetchThrough((_req, res) => {
      res.writeHead(200, { "X-Frame-Options": "SAMEORIGIN" });
      res.end("ok");
    });

    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("HSTS follows APP_ENV, exactly as it does in middleware", () => {
    const collected = new Map<string, string>();
    const res = { setHeader: (n: string, v: string) => collected.set(n, v) };

    applySecurityHeaders(res, { APP_ENV: "production" } as NodeJS.ProcessEnv);
    expect(collected.has("Strict-Transport-Security")).toBe(true);

    collected.clear();
    applySecurityHeaders(res, { APP_ENV: "development" } as NodeJS.ProcessEnv);
    expect(collected.has("Strict-Transport-Security")).toBe(false);
  });
});

describe("standalone entry — the deployment path actually uses it", () => {
  /**
   * Without these, the wrapper can be perfect and still never run: the whole
   * defect was one line naming the wrong entrypoint. Each assertion also names
   * the raw adapter entry as forbidden, because reverting to it is the exact
   * regression and it looks harmless in a diff.
   */
  test("package.json `start` runs the wrapper, not the adapter entry", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.start).toBe("bun ./dist/standalone-entry.mjs");
    expect(pkg.scripts.build).toContain("build:server-entry");
    expect(pkg.scripts["build:server-entry"]).toContain(
      "src/lib/server/standalone-entry.ts"
    );
  });

  test("the production image starts the wrapper", () => {
    const dockerfile = read("Dockerfile.production");

    expect(dockerfile).toContain('CMD ["bun", "./dist/standalone-entry.mjs"]');
    expect(dockerfile).not.toContain("dist/server/entry.mjs");
  });

  test("the wrapper disables the adapter's autostart before importing it", () => {
    // If this assignment moves below the import — or disappears — the adapter
    // binds the port itself with the unwrapped handler and every static file
    // loses its headers again, with the server still answering normally.
    //
    // Matched as the ASSIGNMENT STATEMENT, not the bare name: the module header
    // explains `ASTRO_NODE_AUTOSTART` in prose several lines above the code, so
    // an `indexOf("ASTRO_NODE_AUTOSTART")` would find the comment and keep
    // passing after the statement itself was deleted.
    const source = read("src/lib/server/standalone-entry.ts");
    const assignment = source.indexOf(
      'process.env.ASTRO_NODE_AUTOSTART = "disabled";'
    );
    const dynamicImport = source.indexOf("await import(ASTRO_ENTRY_SPECIFIER)");

    expect(assignment).toBeGreaterThan(-1);
    expect(dynamicImport).toBeGreaterThan(assignment);
  });
});
