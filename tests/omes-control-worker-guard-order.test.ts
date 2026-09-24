/**
 * Enforces the ordering claim `worker-envelope-guard.ts`'s own module doc
 * makes: each of the three worker routes that share `verifyWorkerEnvelope`
 * (`/worker/poll`, `/worker/result`, `/worker/heartbeat`) calls it BEFORE
 * any other `application/worker-*` function that touches
 * `awcms_omes_jobs`/`awcms_omes_worker_results`/`awcms_omes_servers` —
 * `leaseNextQueuedJob`, `promoteNextApprovedOperation`, `ingestWorkerResult`,
 * `ingestWorkerHeartbeat`.
 *
 * The HIGH finding on ahliweb/awcms#823 (the uncaught `assertUuid` throw)
 * is exactly what this guards against in spirit: a route that reaches
 * side-effecting work before the identity chokepoint has run. Source-order
 * scanning cannot catch every way that could regress (a `Promise.all` that
 * races the guard against a mutation, for instance), but it catches the
 * straightforward, likeliest regression — a future edit that calls one of
 * the mutating functions above `verifyWorkerEnvelope` in the same file — and
 * makes `worker-envelope-guard.ts`'s "enforced by ... this test" claim
 * actually true rather than aspirational.
 *
 * Pure source-text scanning, matching this repo's own established idiom for
 * this class of gate (`scripts/tenant-route-factory-check.ts`'s own header:
 * "Regex over comment-stripped lines rather than an AST... auditable in
 * review, no new dependency"). No database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROUTES_DIR = path.join(
  import.meta.dir,
  "..",
  "src",
  "pages",
  "api",
  "v1",
  "omes",
  "worker"
);

/** The mutating `application/worker-*` calls that must never precede the guard. */
const MUTATING_CALLS = [
  "leaseNextQueuedJob(",
  "promoteNextApprovedOperation(",
  "ingestWorkerResult(",
  "ingestWorkerHeartbeat("
];

const ROUTES_SHARING_THE_GUARD = ["poll.ts", "result.ts", "heartbeat.ts"];

describe("worker route guard ordering (ahliweb/omes#199, ahliweb/awcms#823 HIGH follow-up)", () => {
  for (const file of ROUTES_SHARING_THE_GUARD) {
    test(`${file} calls verifyWorkerEnvelope before any mutating worker-* call`, () => {
      const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");

      const guardIndex = source.indexOf("verifyWorkerEnvelope(");

      // Non-vacuous: the guard call must actually be present in the file
      // this test is asserting about, or the ordering assertion below
      // would pass on a file that dropped the guard entirely.
      expect(guardIndex).toBeGreaterThan(-1);

      for (const mutatingCall of MUTATING_CALLS) {
        const callIndex = source.indexOf(mutatingCall);

        if (callIndex === -1) continue; // this route doesn't use that function

        expect(
          callIndex,
          `${file}: ${mutatingCall.slice(0, -1)} appears before verifyWorkerEnvelope(`
        ).toBeGreaterThan(guardIndex);
      }
    });
  }

  test("at least one route actually exercises each mutating call (the assertion above is not vacuous)", () => {
    const sources = ROUTES_SHARING_THE_GUARD.map((file) =>
      readFileSync(path.join(ROUTES_DIR, file), "utf8")
    ).join("\n");

    for (const mutatingCall of MUTATING_CALLS) {
      expect(sources).toContain(mutatingCall);
    }
  });
});
