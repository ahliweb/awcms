/**
 * `selectAnyAllowed` — the any-of rule behind `defineTenantRoute`'s array
 * form of `authorize` (ADR-0121, Issue #794 / PR #797).
 *
 * The dedicated unit test its sibling `selectEntryOutcome`
 * (`tests/admin-screen-entry.test.ts`) already has: the interesting part is
 * not "does it call the chokepoint" (the caller already did, once per
 * candidate, before handing this function the results) but what it does with
 * N answers — that is where an off-by-one reads as an access grant, and it is
 * exactly the property PR #797's live authorization-bypass bug was about.
 *
 * DB-free and fast: every `AuthorizeResult` here is fabricated, never
 * produced by a real `authorizeInTransaction` call.
 */
import { describe, expect, test } from "bun:test";

import { selectAnyAllowed } from "../src/modules/_shared/tenant-route";
import type { AuthorizeResult } from "../src/modules/identity-access/application/access-guard";

function allow(tenantUserId = "tu-1"): AuthorizeResult {
  return {
    allowed: true,
    context: { tenantUserId },
    grantedPermissionKeys: new Set<string>()
  } as unknown as AuthorizeResult;
}

function deny(status: number, code = "ACCESS_DENIED"): AuthorizeResult {
  return {
    allowed: false,
    denied: new Response(JSON.stringify({ error: { code } }), { status })
  } as unknown as AuthorizeResult;
}

describe("the empty list denies", () => {
  test("no candidate authorizes nothing, not everything", () => {
    // The mutation this exists for: writing the rule as "not every candidate
    // was denied" passes `[]` because `[].every(...)` is TRUE. A route whose
    // `authorize` array lost its entries in an edit would then open to every
    // authenticated user of the tenant, with no gate red and no test failing
    // — the exact shape PR #797's bug took, one level up.
    const outcome = selectAnyAllowed([]);

    expect(outcome.allowed).toBe(false);
  });

  test("the empty-array denial is a real 403 Response, not a placeholder", () => {
    const outcome = selectAnyAllowed([]);

    expect(outcome.allowed === false && outcome.denied.status).toBe(403);
  });
});

describe("any-of", () => {
  test("allow on the FIRST candidate", () => {
    const outcome = selectAnyAllowed([allow(), deny(403)]);

    expect(outcome.allowed).toBe(true);
  });

  test("allow on the SECOND candidate — a denial first does not end the search", () => {
    // This is the property that separates any-of from a route that only ever
    // checks its primary permission: a caller holding `media.adjudicate_rights`
    // but not `media.update` must still be admitted when `update` is listed
    // first and denies.
    const outcome = selectAnyAllowed([deny(403), allow()]);

    expect(outcome.allowed).toBe(true);
  });

  test("all candidates denied refuses the route", () => {
    const outcome = selectAnyAllowed([deny(403), deny(403)]);

    expect(outcome.allowed).toBe(false);
  });

  test("the denial reported is the FIRST candidate's, not the last", () => {
    // Routes list their primary permission first, so the response describes
    // the refusal a caller is most likely asking about, and it does not shift
    // with which permission a given caller happens to be missing.
    const first = deny(402, "MEDIA_UPDATE_DENIED");
    const second = deny(403, "MEDIA_ADJUDICATE_RIGHTS_DENIED");
    if (first.allowed || second.allowed) throw new Error("unreachable");

    const outcome = selectAnyAllowed([first, second]);

    // Identity, not just a matching status: proves the FIRST candidate's own
    // `Response` object is what a caller receives, not a freshly-built one
    // that merely copies its status.
    expect(outcome.allowed === false && outcome.denied).toBe(first.denied);
    expect(outcome.allowed === false && outcome.denied.status).toBe(402);
  });
});

describe("the single-request form is the same rule", () => {
  test("one allow admits", () => {
    const outcome = selectAnyAllowed([allow()]);

    expect(outcome.allowed).toBe(true);
  });

  test("one denial refuses", () => {
    const outcome = selectAnyAllowed([deny(429)]);

    expect(outcome.allowed === false && outcome.denied.status).toBe(429);
  });
});

describe("the allowed result handed back is an ALLOWED one", () => {
  test("the first allow found is chosen, never a denial", () => {
    // The route's handler reads `auth.context.tenantUserId` off this value.
    // Handing it a denied result would be a type error today and a null
    // dereference the moment the shapes converge, so the choice is pinned
    // rather than left to `find`'s ordering.
    const outcome = selectAnyAllowed([deny(403), allow("tu-second")]);

    expect(outcome.allowed === true && outcome.context.tenantUserId).toBe(
      "tu-second"
    );
  });
});
