/**
 * blog-legacy-edge-verify.ts — `bun run blog:legacy:edge:verify`.
 *
 * The tool `blog:legacy:cutover:verify` says is not it. Issues #599 / #711,
 * ADR-0114 / ADR-0115.
 *
 * ## Why a second verifier rather than a flag on the first
 *
 * They answer different questions about different layers, and the first one's
 * whole contract is that it does NOT do this. Its docstring:
 *
 *   > This job makes ZERO HTTP requests. It asks the database "is there a rule,
 *   > and is there a row at the end of it" — which is not the question "does the
 *   > origin a reader hits emit a 301". … Verifying the edge means requesting the
 *   > legacy URLs over HTTP and reading the `Location` headers that come back.
 *   > That is a different tool, and this is not it.
 *
 * This is that tool. It reads the same corpus, reuses the same verdict
 * vocabulary, and reaches its answers by asking a server.
 *
 * ## What it would have caught
 *
 * ADR-0113 §Consequences claimed in two languages that `awcms-astro` "needs no
 * change for this… the redirect is resolved in this repo before its routes are
 * reached". Every one of the 67 rubrik entries committed AT THE TIME, replayed against
 * that repo's real built server, returned **404 with zero `Location` headers**
 * (the map holds 68 today; the 68th landed afterwards and has not been replayed) — and
 * no gate in this repo could see it, because the answer was a build
 * configuration in another repository. That replay is this script, and it is
 * the reason it exists rather than a nice-to-have: **the check is not only "is
 * this symbol called" but "is the caller even in the request path"**, and only a
 * request can answer the second.
 *
 * Under ADR-0114 the 301s are issued by the EDGE, so this is also the ONLY tool
 * in this repository that can say anything at all about them.
 *
 * ## The one-hop rule is checked where it is actually a property
 *
 * PRD §9.2 forbids a chain longer than one hop. That cannot be checked from a
 * rule table: an application only sees a request after TLS termination and after
 * whatever the edge already did to the scheme and the host, so `http://www.…`
 * → `https://www.…` → `https://apex/…` → the new path is three hops of which the
 * database knows about one. Counting the 3xx responses actually received counts
 * all of them.
 *
 * Start from the URL a crawler holds — `http://www.seputarborneo.com/news/…` —
 * not from the canonical one, or the run will pass while readers take three
 * hops.
 *
 * ## It writes nothing, anywhere
 *
 * No database connection is opened at all: this job's whole input is a file of
 * URLs and its whole output is a report. Safe to run against production, and
 * meant to be run after the edge is wired and again after any change to it.
 *
 * ## Requests, deliberately shaped
 *
 * `redirect: "manual"` — following automatically would collapse the chain this
 * job exists to measure into a single final status. `method: "HEAD"` is NOT
 * used: an edge that answers HEAD differently from GET is a real configuration,
 * and the crawler this stands in for sends GET. Bun also silently downgrades
 * non-standard methods (see `edge-cache/varnish-client.ts`), which is a good
 * reason to send only the method the reader sends.
 */
import { readFileSync } from "node:fs";

import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  CUTOVER_VERDICT_REASON,
  classifyCutoverOutcome,
  parseSitemapLocations,
  parseUrlListLocations,
  type CutoverVerdict,
  type SitemapParse
} from "../src/modules/seo-distribution/domain/cutover-verification";
import {
  hopRefusalFor,
  probeFactsFrom,
  resolveLocation,
  type HopRefusal,
  type ProbeChain,
  type ProbeResponse
} from "../src/modules/seo-distribution/domain/edge-redirect-probe";

/** Examples printed per failing verdict. The full set goes to `--json`. */
const EXAMPLES_PER_VERDICT = 5;

/**
 * How many redirects to follow before calling the chain exhausted.
 *
 * Four, not one. Stopping at one would make every over-long chain look
 * identical to a correct one plus a rounding error, and the report would say
 * `chain_too_long` without being able to show what the extra hops were — which
 * is the first thing an operator needs in order to fix the tier that added
 * them.
 */
const MAX_HOPS = 4;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;

function flag(name: string): string | null {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") || null : null;
}

function flags(name: string): string[] {
  return process.argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => arg.split("=").slice(1).join("="))
    .filter((value) => value.length > 0);
}

/**
 * Print the usage banner AND fail the run.
 *
 * `process.exitCode = 1` is the whole point of the function existing rather
 * than a bare `console.error`. Its sibling exited 0 on every usage error for
 * its whole life — no args, a missing flag, `--limit=abc` — so
 * `bun run … && deploy` deployed when a flag was mistyped, having verified
 * nothing, while its banner promised the opposite.
 */
function usage(message: string): void {
  console.error(
    `blog:legacy:edge:verify — ${message}\n\n` +
      "  --urls=<path>        a plain list of legacy URLs, one per line. Blank lines and\n" +
      "                       whole-line `#` comments are skipped. Repeatable.\n" +
      "  --sitemap=<path>     a sitemap XML instead. Repeatable; combines with --urls.\n" +
      "                       A sitemap INDEX is refused — pass its children.\n" +
      "  --origin=<url>       resolve a relative corpus entry against this origin. Required\n" +
      "                       only when the corpus holds paths rather than absolute URLs.\n" +
      "  --limit=<n>          stop after n URLs — for a sample, not for a cutover decision\n" +
      "  --concurrency=<n>    parallel requests (default 4)\n" +
      "  --timeout=<ms>       per-request timeout (default 10000)\n" +
      "  --allow-private      follow hops to loopback/private/link-local addresses. OFF by\n" +
      "                       default: `Location` is written by whatever answered the previous\n" +
      "                       request, so a taken-over legacy origin can point this at anything\n" +
      "                       the machine running it can reach. Pass it to verify a LOCAL build.\n" +
      "  --json=<path>        write the full per-URL report here\n\n" +
      "At least one --urls or --sitemap is required.\n" +
      "Makes real HTTP requests. Writes nothing. Exits non-zero when any URL would\n" +
      "lose its ranking. Start from the URL a CRAWLER holds (http://www....), not the\n" +
      "canonical one, or the run passes while readers take three hops.\n"
  );
  process.exitCode = 1;
}

/**
 * Walk one redirect chain, returning every response in order.
 *
 * A URL that repeats is a LOOP and stops the walk immediately: following it to
 * the hop budget would report `chain_too_long`, which sends an operator looking
 * for a chain to shorten instead of a cycle to break.
 */
export async function walkRedirectChain(
  start: string,
  options: {
    maxHops: number;
    timeoutMs: number;
    /**
     * Loopback/private/link-local hops are refused unless this is set.
     *
     * Opt-in rather than opt-out because `Location` is written by whatever
     * answered the previous request: an operator pointing this at a live
     * archive gets the guard without having to know it exists, and the one
     * legitimate local use — verifying a build on 127.0.0.1, which is how
     * ADR-0113's claim was falsified — asks for it explicitly.
     */
    allowPrivateAddresses?: boolean;
    fetchImpl?: typeof fetch;
  }
): Promise<ProbeChain> {
  const doFetch = options.fetchImpl ?? fetch;
  const allowPrivateAddresses = options.allowPrivateAddresses ?? false;
  const responses: ProbeResponse[] = [];
  const seen = new Set<string>();
  let unsafeHop: { url: string; refusal: HopRefusal } | null = null;

  let current = start;

  for (let hop = 0; hop <= options.maxHops; hop += 1) {
    // BEFORE the request, and on the FIRST hop too — the corpus is a file, and
    // a file can carry a `file://` line as easily as a hostile `Location` can.
    // `probeUrlFor` already screens the corpus, but a guard that only runs on
    // hops two and later is one refactor away from not running at all.
    const refusal = hopRefusalFor(current, { allowPrivateAddresses });
    if (refusal !== null) {
      unsafeHop = { url: current, refusal };
      return { responses, exhausted: false, looped: false, unsafeHop };
    }

    if (seen.has(current)) {
      return { responses, exhausted: false, looped: true, unsafeHop };
    }
    seen.add(current);

    let status: number | null = null;
    let location: string | null = null;

    try {
      const response = await doFetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          // Named honestly. A verifier that disguises itself as a browser gets
          // a different answer from an edge with bot rules, and then reports
          // that answer as what a crawler sees.
          "user-agent": "awcms-legacy-edge-verify/1 (+blog:legacy:edge:verify)"
        }
      });

      status = response.status;
      location = response.headers.get("location");
      // The body is never read: this job only ever looks at the status line and
      // one header, and pulling 25,029 article bodies over the wire to discard
      // them would make a verification run a load test.
      await response.body?.cancel();
    } catch {
      // A network failure is a real answer — `status: null` classifies as
      // unverifiable, never as a missing page. `safeErrorDetail` is deliberately
      // not used to build a message here: the URL is what an operator needs, and
      // a DNS error string per row over a whole archive is noise.
      responses.push({ url: current, status: null, location: null });
      return { responses, exhausted: false, looped: false, unsafeHop };
    }

    responses.push({ url: current, status, location });

    if (status < 300 || status >= 400 || location === null) {
      // Narrowed with an early return rather than a `redirecting` boolean:
      // TypeScript's control flow cannot carry a `!== null` through a named
      // condition, and the alternative is a non-null assertion on the one value
      // whose absence ends the chain.
      return { responses, exhausted: false, looped: false, unsafeHop };
    }

    const next = resolveLocation(current, location);
    if (next === null) {
      // A `Location` that is not a resolvable URL ends the chain unseen rather
      // than being guessed at.
      return { responses, exhausted: false, looped: false, unsafeHop };
    }

    current = next;
  }

  return { responses, exhausted: true, looped: false, unsafeHop };
}

/** The absolute URL to probe for one corpus entry, or `null` when it cannot be one. */
export function probeUrlFor(
  entry: string,
  origin: string | null
): string | null {
  try {
    const url = new URL(entry);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    if (!entry.startsWith("/") || origin === null) return null;
    try {
      return new URL(entry, origin).toString();
    } catch {
      return null;
    }
  }
}

type Row = {
  url: string;
  verdict: CutoverVerdict;
  reason: string;
  hops: number;
  finalUrl: string | null;
  finalStatus: number | null;
  /** Every hop, so `--json` can show the chain an operator has to shorten. */
  chain: { url: string; status: number | null; location: string | null }[];
  /**
   * The hop the probe refused, when it refused one.
   *
   * In the row rather than only in the summary because `unsafe_redirect` is
   * the one verdict whose fix is not "change a rule": an operator needs the
   * URL that was pointed at before they can judge what happened to the origin.
   */
  unsafeHop: { url: string; refusal: string } | null;
};

async function main(): Promise<void> {
  const urlListPaths = flags("urls");
  const sitemapPaths = flags("sitemap");
  const origin = flag("origin");
  const limitRaw = flag("limit");
  const concurrencyRaw = flag("concurrency");
  const timeoutRaw = flag("timeout");
  const jsonPath = flag("json");
  const allowPrivateAddresses = process.argv.includes("--allow-private");

  if (urlListPaths.length === 0 && sitemapPaths.length === 0) {
    return usage(
      "one of --urls=<path> or --sitemap=<path> is required (both are repeatable)"
    );
  }

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    return usage("--limit must be a positive integer");
  }

  const concurrency = concurrencyRaw
    ? Number.parseInt(concurrencyRaw, 10)
    : DEFAULT_CONCURRENCY;
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    return usage("--concurrency must be a positive integer");
  }

  const timeoutMs = timeoutRaw
    ? Number.parseInt(timeoutRaw, 10)
    : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return usage("--timeout must be a positive integer (milliseconds)");
  }

  // One loop over both corpus formats, exactly as the sibling job does, so no
  // refusal below is reachable from one flag and not the other.
  const sources: {
    file: string;
    parse: (text: string) => SitemapParse;
    emptyMessage: string;
  }[] = [
    ...urlListPaths.map((file) => ({
      file,
      parse: (text: string) => parseUrlListLocations(text),
      emptyMessage: "no URL lines — every line was blank or a `#` comment"
    })),
    ...sitemapPaths.map((file) => ({
      file,
      parse: (text: string) => parseSitemapLocations(text),
      emptyMessage: "no <loc> entries — is this a sitemap?"
    }))
  ];

  const entries: string[] = [];
  const unusable: string[] = [];

  for (const { file, parse, emptyMessage } of sources) {
    const parsed = parse(readFileSync(file, "utf8"));

    if (parsed.kind === "too_large") {
      console.error(
        `${file}: ${parsed.bytes} bytes exceeds the parse ceiling. Split it, or pass the index's children.`
      );
      process.exitCode = 1;
      return;
    }
    if (parsed.kind === "empty") {
      console.error(`${file}: ${emptyMessage}`);
      process.exitCode = 1;
      return;
    }
    if (parsed.kind === "sitemapindex") {
      console.error(
        `${file}: this is a sitemap INDEX. Its ${parsed.locations.length} <loc> entries are child sitemaps, not pages.\n` +
          "Download the children and pass each with its own --sitemap= flag."
      );
      process.exitCode = 1;
      return;
    }

    for (const location of parsed.locations) {
      const url = probeUrlFor(location, origin);
      if (url === null) unusable.push(location);
      else entries.push(url);
    }
  }

  if (unusable.length > 0 && entries.length === 0) {
    console.error(
      `Every corpus entry is a relative path and no --origin was given. Pass --origin=<url>.`
    );
    process.exitCode = 1;
    return;
  }

  const targets = limit === null ? entries : entries.slice(0, limit);

  console.log(
    `Probing ${targets.length} legacy URL(s) over HTTP` +
      (limit !== null && entries.length > targets.length
        ? ` (SAMPLE of ${entries.length} — not a cutover decision)`
        : "") +
      `, ${concurrency} at a time.\n`
  );

  // Indexed by corpus position rather than appended, so restoring order needs
  // no sort and no key at all. It used to `push` and then sort by a
  // `Map<url, index>` — which keys on the URL, so a corpus containing the same
  // URL twice held only the LAST index, both rows sorted into that slot, and
  // the first occurrence moved out of its position in the file. A duplicated
  // URL in a hand-assembled legacy corpus is ordinary, and the comment above
  // the sort stated the property it was losing: "a report whose rows shuffle
  // between runs cannot be diffed".
  const rows: (Row | undefined)[] = new Array(targets.length);
  let cursor = 0;

  // A fixed pool rather than `Promise.all` over the whole corpus: 25,029
  // simultaneous requests is an outage, not a verification.
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const url = targets[index];
      if (url === undefined) return;

      const chain = await walkRedirectChain(url, {
        maxHops: MAX_HOPS,
        timeoutMs,
        allowPrivateAddresses
      });
      const facts = probeFactsFrom(chain);
      const verdict = classifyCutoverOutcome(facts);
      const last = chain.responses[chain.responses.length - 1];

      rows[index] = {
        url,
        verdict,
        reason: CUTOVER_VERDICT_REASON[verdict],
        hops: facts.hops,
        finalUrl: last?.url ?? null,
        finalStatus: last?.status ?? null,
        chain: chain.responses,
        unsafeHop: chain.unsafeHop ?? null
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () =>
      worker()
    )
  );

  // Already in corpus order — see the declaration. `filter` narrows away the
  // holes a worker that never ran would leave; there are none once every worker
  // has returned, and asserting that here would be a runtime check of a loop
  // invariant rather than a report.
  const ordered = rows.filter((row): row is Row => row !== undefined);

  const byVerdict = new Map<CutoverVerdict, Row[]>();
  for (const row of ordered) {
    const list = byVerdict.get(row.verdict) ?? [];
    list.push(row);
    byVerdict.set(row.verdict, list);
  }

  const clean = byVerdict.get("ok")?.length ?? 0;
  console.log(`  ok                  ${clean}`);
  for (const [verdict, list] of [...byVerdict].sort()) {
    if (verdict === "ok") continue;
    console.log(`  ${verdict.padEnd(19)} ${list.length}`);
    console.log(`      ${CUTOVER_VERDICT_REASON[verdict]}`);
    for (const row of list.slice(0, EXAMPLES_PER_VERDICT)) {
      console.log(
        row.unsafeHop
          ? `      ${row.url} -> REFUSED ${row.unsafeHop.url} (${row.unsafeHop.refusal})`
          : `      ${row.url} -> ${row.finalUrl ?? "(no response)"} [${row.finalStatus ?? "network failure"}], ${row.hops} hop(s)`
      );
    }
    if (list.length > EXAMPLES_PER_VERDICT) {
      console.log(
        `      ... and ${list.length - EXAMPLES_PER_VERDICT} more (use --json for all)`
      );
    }
  }

  if (unusable.length > 0) {
    console.log(
      `\n  ${unusable.length} corpus entry/entries were not usable URLs and were NOT probed:`
    );
    for (const entry of unusable.slice(0, EXAMPLES_PER_VERDICT)) {
      console.log(`      ${entry}`);
    }
  }

  if (jsonPath) {
    await Bun.write(jsonPath, `${JSON.stringify(ordered, null, 2)}\n`);
    console.log(`\nFull report written to ${jsonPath}`);
  }

  const failures = ordered.length - clean;
  if (failures > 0 || unusable.length > 0) {
    console.error(
      `\n${failures} URL(s) are not ready for cutover. Nothing was written; fix the edge and run again.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nAll ${ordered.length} legacy URL(s) resolve in ONE hop to a page an origin actually served.\n` +
      "That is a claim about what these URLs did just now, from here. It says nothing\n" +
      "about a rule this repo holds, and nothing about a URL that was not in the corpus."
  );
}

if (import.meta.main) {
  await main().catch((error) => {
    logScriptFailure("blog:legacy:edge:verify", error);
    process.exitCode = 1;
  });
}
