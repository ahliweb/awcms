/**
 * The `test` a READ-wave spec must import — it fails the test if the spec
 * mutates anything through the app.
 *
 * ## Why a fixture rather than a promise
 *
 * `e2e-waves.ts` classifies each spec, and `tests/e2e-wave-classification.test.ts`
 * makes the classification impossible to skip. Neither can tell whether the
 * classification is TRUE. A spec sitting in the read wave that grows a click on
 * a submit button is still labelled "read", and the label is what the ordering
 * trusts — so the label would be quietly wrong and the symptom would surface in
 * a different file, which is exactly the class of bug this whole change exists
 * to end.
 *
 * So membership is checked by observation. Every non-GET request the browser
 * context makes to `/api/` is recorded, and the test fails if any survived the
 * allow-list. The spec that broke the rule is the spec that turns red.
 *
 * ## What is allowed, and why each one is
 *
 * `POST /api/v1/auth/login` and `/logout` mint and drop a SESSION. That is the
 * only write a read-wave spec legitimately makes: no other spec's expectation
 * reads it, and three specs here authenticate as somebody other than the shared
 * owner and therefore must drive the real form.
 *
 * Direct database seeding by a fixture is not visible here at all, and that is
 * intentional rather than an oversight — see the note on `READ_WAVE`. The rule
 * is about mutations made through the app, because those are the ones that
 * change what another spec's screen renders.
 */
import { test as base, expect } from "@playwright/test";

export { expect };
export type { Page, Locator, Response } from "@playwright/test";

/**
 * Session endpoints. Anchored, so a future `/api/v1/auth/login-as` — which
 * would be a very different thing — is not silently covered by a prefix match.
 */
const ALLOWED_MUTATIONS = [
  "/api/v1/auth/login",
  "/api/v1/auth/logout"
] as const;

function isAllowed(pathname: string): boolean {
  return ALLOWED_MUTATIONS.some((allowed) => pathname === allowed);
}

export const test = base.extend<{ noAppMutation: void }>({
  noAppMutation: [
    async ({ context }, use) => {
      const violations = new Set<string>();

      context.on("request", (request) => {
        const method = request.method();
        if (method === "GET" || method === "HEAD") return;

        // Only the API is inspected. Every admin write in this app goes through
        // `/api/v1/...` via the delegated form client, so that is where a
        // mutation actually appears; watching every origin would catch browser
        // chatter and report it as a test defect.
        const pathname = new URL(request.url()).pathname;
        if (!pathname.startsWith("/api/")) return;
        if (isAllowed(pathname)) return;

        violations.add(`${method} ${pathname}`);
      });

      await use();

      expect(
        [...violations].sort(),
        "This spec is classified in the READ wave (tests/e2e/support/e2e-waves.ts) " +
          "but it mutated tenant state through the app. Read-wave specs run " +
          "FIRST, against a pristine tenant, precisely so the sweeps can assert " +
          "what a screen owes an untouched tenant — a write here changes what " +
          "the OTHER read specs see, and the failure lands in their file rather " +
          "than in this one. Either drop the mutation, or move this spec to " +
          "WRITE_WAVE and stop importing `test` from `./support/e2e-read-wave`."
      ).toEqual([]);
    },
    { auto: true }
  ]
});
