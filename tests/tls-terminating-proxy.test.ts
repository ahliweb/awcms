/**
 * The smoke test that speaks HTTPS — PROJECT_STATE §4 recommendation 8.
 *
 * ## Why this file exists
 *
 * Two production defects shipped in one week, and neither could be seen from
 * this repo:
 *
 *   - **v9.1.1** — every native `<form method="post">` answered
 *     `403 Cross-site POST form submissions are forbidden`. Astro's
 *     `checkOrigin` compares the browser's `Origin` header against
 *     `url.origin`, and behind TLS termination those are `https://host` and
 *     `http://host`. They can never match.
 *   - **v9.1.2 / #573** — feeds emitted `<link>http://…</link>` on an
 *     `https://` site, from the same root cause reaching output instead of a
 *     comparison.
 *
 * Both need a TLS-terminating proxy to appear. Dev, `bun run build`, the unit
 * suite and the Playwright smoke test all speak plain HTTP to the app, where
 * the two origins DO match — so 47 gates and 4,600 tests were green while the
 * site was broken. The round that found them wrote the fix down as
 * "one scenario behind a TLS-terminating reverse proxy would find both in
 * seconds". This is that scenario.
 *
 * ## What it actually stands up
 *
 * A real two-hop topology, not a simulation of one:
 *
 *     fetch("https://localhost:P")  ──TLS──▶  proxy  ──plain HTTP──▶  origin
 *                                             (terminates,            (Node
 *                                              adds X-Forwarded-*)     adapter's
 *                                                                      position)
 *
 * The origin server sees exactly what the app sees in production: a plain
 * `http://` request URL, an `Origin` header naming `https://`, and
 * `X-Forwarded-Proto: https`. That asymmetry IS the bug, and it cannot be
 * reproduced by constructing a `Request` by hand — which is precisely why
 * `tests/site-origin.test.ts` (unit) passed throughout the outage.
 *
 * ## Deliberately not the whole application
 *
 * Booting `dist/` would need a database, a tenant and a session, which is what
 * makes an end-to-end HTTPS test the sort of thing a repo keeps not writing.
 * The origin server mounts the two DECISIONS instead — `resolveRequestOrigin`
 * for absolute URLs, and Astro's documented `checkOrigin` rule for form POSTs —
 * so the test exercises the real resolver over a real socket. If either
 * decision regresses, this fails; if the app stops routing through the
 * resolver, `site-origin:check` fails. Neither gate covers the other.
 *
 * ## The certificate is generated, never committed
 *
 * A private key in the repository would be a GitGuardian finding on every
 * commit that touched it, and rightly so. `openssl` mints a throwaway
 * self-signed pair into a temp directory per run. Where `openssl` is absent the
 * suite SKIPS rather than silently passing — a skipped test that says so is
 * honest; a test that quietly asserts nothing is the failure this whole file is
 * about.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRequestOrigin } from "../src/lib/http/site-origin";

/** Content types Astro's `checkOrigin` treats as form-like. */
const FORM_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain"
];

/**
 * Astro's rule, reimplemented against a CHOSEN origin.
 *
 * `astro/dist/core/app/origin-check.js` compares against `url.origin` and
 * nothing else. Passing the origin in is what lets one test assert both halves:
 * the naive comparison (the shipped defect) and the corrected one (the fix).
 */
function checkOrigin(request: Request, origin: string): boolean {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();

  if (!FORM_CONTENT_TYPES.includes(contentType)) return true;

  return request.headers.get("origin") === origin;
}

interface CertificatePair {
  readonly cert: string;
  readonly key: string;
}

/**
 * `null` when `openssl` is unavailable, so the suite can skip rather than lie.
 *
 * The `try` is load-bearing and was added after watching it matter:
 * `Bun.spawnSync` THROWS `Executable not found in $PATH` rather than returning
 * `{ success: false }`, so the obvious `if (!result.success)` guard never runs —
 * `beforeAll` dies and the file reports a bare `(unnamed)` failure naming
 * nothing. Catching turns that into the intended, explained skip.
 */
function mintCertificate(directory: string): CertificatePair | null {
  const certPath = join(directory, "cert.pem");
  const keyPath = join(directory, "key.pem");

  let result: { success: boolean };

  try {
    result = Bun.spawnSync([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1"
    ]);
  } catch {
    return null;
  }

  if (!result.success) return null;

  return {
    cert: readFileSync(certPath, "utf8"),
    key: readFileSync(keyPath, "utf8")
  };
}

/**
 * The environment the ORIGIN resolves against, swapped per scenario.
 *
 * Mutable module state rather than `process.env`: the resolver takes `env` as a
 * parameter precisely so a test need not mutate a global that other suites in
 * the same process share.
 */
let originEnv: NodeJS.ProcessEnv = {};

describe("behind a TLS-terminating proxy", () => {
  let origin: ReturnType<typeof Bun.serve> | null = null;
  let proxy: ReturnType<typeof Bun.serve> | null = null;
  let directory: string | null = null;
  let base = "";
  let available = false;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "awcms-tls-"));
    const pair = mintCertificate(directory);

    if (!pair) return;

    // The application's position: plain HTTP, no idea TLS exists.
    origin = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/origin") {
          return new Response(resolveRequestOrigin(url, request, originEnv));
        }

        if (url.pathname === "/form-naive") {
          // What Astro actually does today: compare against `url.origin`.
          return new Response(null, {
            status: checkOrigin(request, url.origin) ? 200 : 403
          });
        }

        if (url.pathname === "/form-resolved") {
          // What it would do with the site origin corrected.
          return new Response(null, {
            status: checkOrigin(
              request,
              resolveRequestOrigin(url, request, originEnv)
            )
              ? 200
              : 403
          });
        }

        return new Response(null, { status: 404 });
      }
    });

    const upstream = `http://127.0.0.1:${origin.port}`;

    // Traefik's position: terminate TLS, forward plain, declare what it did.
    proxy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert: pair.cert, key: pair.key },
      async fetch(request) {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);

        headers.set("x-forwarded-proto", "https");
        headers.set("x-forwarded-host", url.host);

        return await fetch(`${upstream}${url.pathname}${url.search}`, {
          method: request.method,
          headers,
          body: request.method === "GET" ? undefined : await request.text(),
          redirect: "manual"
        });
      }
    });

    base = `https://localhost:${proxy.port}`;
    available = true;
  });

  afterAll(() => {
    proxy?.stop(true);
    origin?.stop(true);
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Self-signed, so certificate verification is off for these calls ONLY.
   *
   * `tls` is typed by `bun-types`, so no `@ts-expect-error` here — one was
   * written on the assumption the DOM types would object, and `tsc` correctly
   * rejected the suppression as unused. A suppression that is not needed is
   * worse than none: it teaches the next reader that this line is unsound.
   */
  const call = async (
    path: string,
    init: RequestInit = {}
  ): Promise<Response> =>
    await fetch(`${base}${path}`, {
      ...init,
      tls: { rejectUnauthorized: false }
    });

  test("the topology is real: the origin sees http while the client used https", async () => {
    if (!available) return;

    // This is the assertion that makes the rest meaningful. If the origin
    // received `https`, there would be no TLS termination to test and every
    // scenario below would pass for the wrong reason.
    originEnv = {};

    const response = await call("/origin");
    const resolved = await response.text();

    expect(resolved.startsWith("http://")).toBe(true);
    expect(resolved.startsWith("https://")).toBe(false);
  });

  test("APP_URL corrects the scheme — the branch production actually uses", async () => {
    if (!available) return;

    // Production sets `APP_URL=https://…` and does NOT set `PUBLIC_TRUST_PROXY`,
    // so this is the branch that fixed the live feed. A fix that only worked
    // with proxy trust enabled would have shipped and changed nothing.
    originEnv = { APP_URL: "https://awcms.example" };

    expect(await (await call("/origin")).text()).toStartWith("https://");
  });

  test("a trusted proxy's X-Forwarded-Proto corrects the scheme", async () => {
    if (!available) return;

    originEnv = { PUBLIC_TRUST_PROXY: "true" };

    expect(await (await call("/origin")).text()).toStartWith("https://");
  });

  test("an UNTRUSTED X-Forwarded-Proto is ignored — the header is attacker-settable", async () => {
    if (!available) return;

    // The proxy sets the header on every request. Without the trust flag and
    // without `APP_URL`, it must be disregarded, or any client could dictate
    // the origin of the links this site emits.
    originEnv = {};

    expect(await (await call("/origin")).text()).toStartWith("http://");
  });

  test("the host is the visitor's, not APP_URL's — multi-host deployments depend on it", async () => {
    if (!available) return;

    originEnv = { APP_URL: "https://canonical.example" };

    const resolved = await (await call("/origin")).text();

    expect(resolved).toContain(`localhost:${proxy!.port}`);
    expect(resolved).not.toContain("canonical.example");
  });

  test("REPRODUCES v9.1.1: a genuine form POST is refused against url.origin", async () => {
    if (!available) return;

    originEnv = { APP_URL: "https://awcms.example" };

    // Exactly what a browser sends for `<form method="post">` on this page.
    const response = await call("/form-naive", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: base
      },
      body: "locale=id"
    });

    // 403 here is the DEFECT, asserted so the scenario is known to reproduce
    // it. A test that only checked the fixed path would pass just as happily
    // against a topology where nothing was ever wrong.
    expect(response.status).toBe(403);
  });

  test("and the resolved site origin accepts that same POST", async () => {
    if (!available) return;

    originEnv = { APP_URL: "https://awcms.example" };

    const response = await call("/form-resolved", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: base
      },
      body: "locale=id"
    });

    expect(response.status).toBe(200);
  });

  test("a JSON POST is exempt either way — which is why the shipped fix works", async () => {
    if (!available) return;

    originEnv = {};

    // `checkOrigin` skips non-form content types, because a cross-site
    // `application/json` POST is already stopped by CORS preflight. Re-sending
    // the form as JSON is what unblocked the language switcher, and this is the
    // property that makes it sound rather than a lucky workaround.
    const response = await call("/form-naive", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example"
      },
      body: JSON.stringify({ locale: "id" })
    });

    expect(response.status).toBe(200);
  });

  test("CI cannot silently skip these scenarios", () => {
    // Without this, a runner with no `openssl` reports eight passing tests that
    // asserted nothing — "green while every answer is wrong" in its purest
    // form, and on the ONE suite written because green meant nothing.
    //
    // The bar differs by where it runs, deliberately. A contributor without
    // `openssl` gets a warning and a working checkout; CI gets a failure,
    // because a smoke test that stops smoking in CI is indistinguishable from
    // one that passes.
    if (!available && process.env["CI"]) {
      throw new Error(
        "openssl is unavailable, so every HTTPS scenario in this file was skipped. CI must not report that as a pass."
      );
    }

    if (!available) {
      process.stderr.write(
        "tls-terminating-proxy: openssl unavailable — HTTPS scenarios SKIPPED locally.\n"
      );
    }

    expect(available || !process.env["CI"]).toBe(true);
  });
});
