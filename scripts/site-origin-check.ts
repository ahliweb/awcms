#!/usr/bin/env bun
/**
 * site-origin:check — no file may build an outward-facing absolute URL by
 * interpolating a request origin or by hardcoding a scheme next to a host.
 *
 * WHY A GATE AND NOT A CODE REVIEW
 *
 * The scheme this app believes it is served over is decided by the Node
 * listener, and the listener speaks plain HTTP because Traefik terminates TLS.
 * So `url.origin` is `http://…` on an `https://…` site, and every absolute URL
 * built from it left the origin wrong. That reached production and stayed there:
 * feeds, sitemaps, JSON-LD `@id`, and share links all carried `http://`, while
 * the ONE place a human is likely to look — the canonical `<link href>` — read
 * correctly, because Cloudflare's Automatic HTTPS Rewrites patches `href`/`src`
 * attributes in flight. The defect was self-concealing at exactly the spot
 * you'd check it.
 *
 * Two shapes cause it, and both are mechanically recognisable:
 *
 *   1. `${url.origin}` — the request's own origin, interpolated into output.
 *   2. `` `https://${host}` `` — a hardcoded scheme beside a resolved host. Right
 *      in this deployment, wrong in the offline-LAN profile, and wrong the day
 *      the deployment changes.
 *
 * Both now go through `src/lib/http/site-origin.ts`, which is the only file
 * allowed to name a scheme.
 *
 * WHAT THIS DELIBERATELY DOES NOT FLAG
 *
 * `new URL(x).origin` used to COMPARE (open-redirect guards, the VAPID `aud`,
 * allow-list checks) is not a producer — it never reaches output. Flagging it
 * would train readers to add ignore comments, and a gate people route around is
 * worse than no gate. So the rules match interpolation into a string, not the
 * `.origin` property itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The one module allowed to decide a scheme. */
const RESOLVER = "src/lib/http/site-origin.ts";

/** Roots that can emit an outward-facing URL. */
const SCANNED_ROOTS = ["src"];

const SCANNED_EXTENSIONS = new Set([".ts", ".astro"]);

export type OriginViolation = {
  file: string;
  line: number;
  rule: "request-origin" | "hardcoded-scheme";
  text: string;
};

/** `${url.origin}` / `${Astro.url.origin}` / `${ctx.url.origin}` in a template. */
const REQUEST_ORIGIN = /\$\{[^}]*\burl\.origin\b[^}]*\}/;

/**
 * A hardcoded scheme whose host is ENTIRELY interpolated.
 *
 * The lookahead is the whole point. `` `https://${accountId}.r2.cloudflarestorage.com` ``
 * is a third-party provider endpoint: the interpolation is a subdomain label
 * inside a fixed vendor domain, `https` is correct there forever, and rewriting
 * it would be wrong. `` `https://${primaryHost}/sitemap.xml` `` is THIS site,
 * where the scheme is a deployment property and the literal is the defect.
 *
 * The difference is what follows the closing brace: a literal domain (`.r2…`)
 * means a vendor host; `/`, a backtick, or another interpolation means the
 * interpolated value WAS the host.
 *
 * The scheme is NOT anchored to a leading backtick: the real defect included
 * `` `Sitemap: https://${input.primaryHost}/sitemap.xml` ``, where the template
 * opens with a literal prefix. `${` already guarantees a template context, so
 * the backtick added nothing but a blind spot.
 */
const HARDCODED_SCHEME = /https?:\/\/\$\{[^}]*\}(?=[/`$])/;

/** Recursively list scannable files under `dir`, repo-relative. */
function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    const stat = statSync(path.join(ROOT, rel));
    if (stat.isDirectory()) {
      listFiles(rel, out);
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry))) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Pure scan of one file's lines. Exported so the tests can feed it the exact
 * shapes that shipped, rather than asserting the gate against the tree it was
 * written to make green.
 */
export function scanSource(file: string, source: string): OriginViolation[] {
  if (file === RESOLVER) return [];

  const violations: OriginViolation[] = [];
  const lines = source.split("\n");

  for (const [index, raw] of lines.entries()) {
    // Comments explain the rule constantly — in this very repo the fix is
    // documented by quoting the broken form. Scanning them would make the gate
    // fire on its own explanation.
    const line = raw.replace(/^\s*(?:\/\/|\*|\/\*).*$/, "");
    if (line.trim().length === 0) continue;

    if (REQUEST_ORIGIN.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "request-origin",
        text: raw.trim()
      });
    }

    if (HARDCODED_SCHEME.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "hardcoded-scheme",
        text: raw.trim()
      });
    }
  }

  return violations;
}

const ADVICE: Record<OriginViolation["rule"], string> = {
  "request-origin":
    "interpolates the REQUEST origin, whose scheme is the listener's (plain HTTP behind TLS termination). Use `resolveRequestOrigin(url, request)` from `src/lib/http/site-origin.ts`.",
  "hardcoded-scheme":
    "hardcodes a scheme beside an interpolated host. Use `resolveHostOrigin(host)` or take a `SiteScheme` parameter — `src/lib/http/site-origin.ts` is the only place a scheme is decided."
};

if (import.meta.main) {
  const violations = SCANNED_ROOTS.flatMap((root) =>
    listFiles(root).flatMap((file) =>
      scanSource(file, readFileSync(path.join(ROOT, file), "utf8"))
    )
  );

  if (violations.length > 0) {
    console.error(
      `site-origin:check FAILED — ${violations.length} absolute-URL producer(s) outside ${RESOLVER}:`
    );
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line}  [${v.rule}]`);
      console.error(`      ${v.text}`);
      console.error(`      ${ADVICE[v.rule]}`);
    }
    process.exit(1);
  }

  console.log(
    `site-origin:check OK — every absolute-URL producer goes through ${RESOLVER}.`
  );
}
