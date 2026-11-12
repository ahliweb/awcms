/**
 * CDN purge client (Cloudflare purge-by-tag) — Issue #1282, revisit of C14.
 *
 * ## The purge unit: tags, not URLs
 *
 * The queue already holds surrogate keys (`t:<tenant>:m:<module>`), not URLs: the
 * app cannot enumerate the URLs behind a module for a tenant. The CDN accepts
 * the same vocabulary as a `Cache-Tag` response header (see
 * `response-headers.ts`) and purges by tag, so one queue row maps to one tag and
 * the CDN copy dies together with the Varnish copy. Purge by tag is available on
 * every Cloudflare plan; the limits that shape this client are the documented
 * ones: at most 100 tags per request, and an account-wide token bucket
 * (Free 5 requests/minute, Pro 5/s, Business 10/s, Enterprise 50/s). So tags
 * are deduplicated and sent 100 per request, which turns a burst of thousands of
 * rows into tens of requests.
 *
 * ## Failure taxonomy (what the worker does with each)
 *
 * - `rate_limited` (HTTP 429): back-pressure. The worker stops calling the CDN
 *   for the rest of the run and RELEASES the rows (attempt not counted), because
 *   the limit is account-wide and retrying immediately only deepens it.
 * - `auth` (HTTP 401/403): configuration. Same release, plus a loud non-zero
 *   exit; fixing the token loses nothing.
 * - `rejected` (other 4xx): the request itself is wrong; retrying cannot help, so
 *   the rows dead-letter (`failed`) with the reason.
 * - `transient` (5xx, network, timeout, 2xx without `success: true`): retried
 *   inline with exponential backoff, then the run stops calling the CDN
 *   (`unavailable`) and the row is left to the queue's own attempt budget and
 *   dead-letter on later runs.
 *
 * Nothing here ever drops a row: every outcome ends in done, pending or failed.
 * Response bodies and the token are never copied into the returned detail.
 */
import type { CdnPurgeConfig } from "./cdn-purge-config";

/** The documented maximum number of tags per purge request. */
export const CDN_MAX_TAGS_PER_REQUEST = 100;

/** Inline attempts for a transient failure, and the first backoff step. */
export const CDN_INLINE_ATTEMPTS = 3;
export const CDN_BACKOFF_BASE_MS = 250;

const CDN_TIMEOUT_MS = 10_000;

/** Same charset as the surrogate keys; a tag outside it is never sent. */
const SAFE_TAG = /^[A-Za-z0-9:._-]{1,512}$/;

export type CdnPurgeOutcome =
  | { ok: true }
  | { ok: false; kind: "rate_limited"; retryAfterSeconds: number | null }
  | { ok: false; kind: "auth"; detail: string }
  | { ok: false; kind: "rejected"; detail: string }
  | { ok: false; kind: "transient"; detail: string };

export type CdnFetchLike = (
  input: string,
  init: RequestInit & { signal: AbortSignal }
) => Promise<Response>;

export type CdnClientOptions = {
  config: CdnPurgeConfig;
  fetchImpl?: CdnFetchLike;
  /** Injectable so tests do not wait out real backoff. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;

  const seconds = Number.parseInt(value.trim(), 10);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Split into request-sized groups of the documented maximum. */
export function chunkCdnTags(
  tags: readonly string[],
  size: number = CDN_MAX_TAGS_PER_REQUEST
): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < tags.length; index += size) {
    chunks.push(tags.slice(index, index + size));
  }

  return chunks;
}

/** One purge-by-tag request (with inline retry for transient failures). */
export async function sendCdnTagPurge(
  tags: readonly string[],
  options: CdnClientOptions
): Promise<CdnPurgeOutcome> {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as CdnFetchLike);
  const sleep = options.sleep ?? defaultSleep;

  if (!config.apiBase || !config.zoneId || !config.apiToken) {
    return {
      ok: false,
      kind: "auth",
      detail: "CDN purge credentials are not configured."
    };
  }

  if (
    tags.length === 0 ||
    tags.length > CDN_MAX_TAGS_PER_REQUEST ||
    !tags.every((tag) => SAFE_TAG.test(tag))
  ) {
    return {
      ok: false,
      kind: "rejected",
      detail: "Refusing to send an empty, oversized or unsafe tag list."
    };
  }

  const url = `${config.apiBase}/zones/${config.zoneId}/purge_cache`;
  const body = JSON.stringify({ tags });
  let last: CdnPurgeOutcome = {
    ok: false,
    kind: "transient",
    detail: "CDN purge was not attempted."
  };

  for (let attempt = 0; attempt < CDN_INLINE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(CDN_BACKOFF_BASE_MS * 4 ** (attempt - 1));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CDN_TIMEOUT_MS);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json"
        },
        body,
        redirect: "error",
        signal: controller.signal
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          success?: unknown;
        } | null;

        if (payload?.success === true) {
          return { ok: true };
        }

        last = {
          ok: false,
          kind: "transient",
          detail: "CDN answered without success=true."
        };
        continue;
      }

      if (response.status === 429) {
        return {
          ok: false,
          kind: "rate_limited",
          retryAfterSeconds: parseRetryAfter(
            response.headers.get("retry-after")
          )
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          kind: "auth",
          detail: `CDN refused the credential with status ${response.status}.`
        };
      }

      if (response.status >= 400 && response.status < 500) {
        return {
          ok: false,
          kind: "rejected",
          detail: `CDN rejected the purge with status ${response.status}.`
        };
      }

      last = {
        ok: false,
        kind: "transient",
        detail: `CDN answered with status ${response.status}.`
      };
    } catch (error) {
      last = {
        ok: false,
        kind: "transient",
        detail:
          error instanceof Error && error.name === "AbortError"
            ? `CDN purge timed out after ${CDN_TIMEOUT_MS}ms.`
            : "CDN purge request failed before a response was received."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return last;
}

export type CdnRow = { id: string; surrogate_key: string };

export type CdnRowDecisions = {
  /** Purged at the CDN. */
  done: string[];
  /** Transient failure: back to `pending` and counted against attempts. */
  retry: { id: string; detail: string }[];
  /** Cannot succeed: dead-letter. */
  deadLetter: { id: string; detail: string }[];
  /** Not attempted or back-pressured: back to `pending`, attempt not counted. */
  release: { id: string; detail: string }[];
  /** Set when the run must stop calling the CDN. */
  halt: "rate_limited" | "auth" | "unavailable" | null;
};

/**
 * Purge the CDN for a set of rows: dedupe tags, send 100 per request, and turn
 * each outcome into a per-row decision. Pure of any database access so the whole
 * taxonomy is testable against a fake CDN.
 */
export async function purgeCdnForRows(
  rows: readonly CdnRow[],
  options: CdnClientOptions
): Promise<CdnRowDecisions> {
  const decisions: CdnRowDecisions = {
    done: [],
    retry: [],
    deadLetter: [],
    release: [],
    halt: null
  };
  const rowsByTag = new Map<string, string[]>();

  for (const row of rows) {
    const ids = rowsByTag.get(row.surrogate_key) ?? [];

    ids.push(row.id);
    rowsByTag.set(row.surrogate_key, ids);
  }

  for (const chunk of chunkCdnTags([...rowsByTag.keys()])) {
    const ids = chunk.flatMap((tag) => rowsByTag.get(tag) ?? []);

    if (decisions.halt !== null) {
      for (const id of ids) {
        decisions.release.push({
          id,
          detail: `CDN purge paused (${decisions.halt}); will retry.`
        });
      }
      continue;
    }

    const outcome = await sendCdnTagPurge(chunk, options);

    if (outcome.ok) {
      decisions.done.push(...ids);
    } else if (outcome.kind === "rate_limited") {
      decisions.halt = "rate_limited";
      const wait =
        outcome.retryAfterSeconds === null
          ? ""
          : ` (retry after ${outcome.retryAfterSeconds}s)`;

      for (const id of ids) {
        decisions.release.push({
          id,
          detail: `CDN purge rate limited${wait}; will retry.`
        });
      }
    } else if (outcome.kind === "auth") {
      decisions.halt = "auth";

      for (const id of ids) {
        decisions.release.push({ id, detail: outcome.detail });
      }
    } else if (outcome.kind === "rejected") {
      for (const id of ids) {
        decisions.deadLetter.push({ id, detail: outcome.detail });
      }
    } else {
      // The CDN is failing: stop for this run (the remaining chunks are
      // released, not attempted) so the queue is not drained into the
      // dead-letter inside one run by an outage that is not the rows' fault.
      decisions.halt = "unavailable";

      for (const id of ids) {
        decisions.retry.push({ id, detail: outcome.detail });
      }
    }
  }

  return decisions;
}
