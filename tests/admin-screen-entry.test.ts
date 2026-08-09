/**
 * `selectEntryOutcome` — the any-of entry rule behind `loadAdminScreen`
 * (issue #450, Gelombang 1).
 *
 * Eight admin consoles show panels that are independently readable and have
 * always refused the PAGE only when every panel is refused. Routing them
 * through the chokepoint therefore needs an any-of entry; forcing a single one
 * would deny an operator who legitimately holds one panel's read and not
 * another's — a narrowing of access dressed up as a refactor.
 *
 * The rule is tested here rather than through `loadAdminScreen` because the
 * interesting part is not "does it call the chokepoint" (`access:chokepoint:check`
 * proves that mechanically, across both roots) but what it does with N answers.
 * That is where an off-by-one reads as an access grant.
 */
import { describe, expect, test } from "bun:test";

import { selectEntryOutcome } from "../src/lib/auth/admin-screen";
import type { AuthorizeResult } from "../src/modules/identity-access/application/access-guard";

function allow(tenantUserId = "tu-1"): AuthorizeResult {
  return {
    allowed: true,
    context: { tenantUserId },
    grantedPermissionKeys: new Set<string>()
  } as unknown as AuthorizeResult;
}

function deny(status: number): AuthorizeResult {
  return {
    allowed: false,
    denied: new Response(null, { status })
  } as unknown as AuthorizeResult;
}

describe("the empty list denies", () => {
  test("no entry request authorizes nothing, not everything", () => {
    // The mutation this exists for: writing the rule as "not every request was
    // denied" passes `[]` because `[].every(...)` is TRUE. A screen that lost
    // its entry request in an edit would then open to every authenticated user
    // of the tenant, with no gate red and no test failing.
    const outcome = selectEntryOutcome([]);

    expect(outcome.allowed).toBe(false);
    expect(outcome.allowed === false && outcome.status).toBe(403);
  });
});

describe("any-of", () => {
  test("one allow among denials admits the page", () => {
    const outcome = selectEntryOutcome([deny(403), allow(), deny(403)]);

    expect(outcome.allowed).toBe(true);
  });

  test("every request's answer is reported, in the declared order", () => {
    // The panels read their own answer from here. If this collapsed to the
    // page-level boolean, a viewer holding one panel would be shown all of
    // them — the exact over-disclosure R3 is about, reintroduced one layer up.
    const outcome = selectEntryOutcome([deny(403), allow(), deny(403)]);

    expect(outcome.allowed === true && outcome.entry).toEqual([
      false,
      true,
      false
    ]);
  });

  test("all denied refuses the page", () => {
    const outcome = selectEntryOutcome([deny(403), deny(403)]);

    expect(outcome.allowed).toBe(false);
  });

  test("the reported status is the FIRST request's, not the last", () => {
    // Screens list their primary read first, so the operator is told about the
    // refusal they are most likely asking about. Taking the last would make the
    // status depend on how many panels a screen happens to have.
    const outcome = selectEntryOutcome([deny(402), deny(403)]);

    expect(outcome.allowed === false && outcome.status).toBe(402);
  });
});

describe("the single-request form is the same rule", () => {
  test("one allow admits", () => {
    const outcome = selectEntryOutcome([allow()]);

    expect(outcome.allowed).toBe(true);
    expect(outcome.allowed === true && outcome.entry).toEqual([true]);
  });

  test("one denial refuses, carrying its own status", () => {
    const outcome = selectEntryOutcome([deny(429)]);

    expect(outcome.allowed).toBe(false);
    expect(outcome.allowed === false && outcome.status).toBe(429);
  });
});

describe("the authorized half handed to `load` is an ALLOWED one", () => {
  test("the first allow is chosen, never a denial", () => {
    // `load` reads `auth.context.tenantUserId`. Handing it a denied result
    // would be a type error today and a null dereference the moment the shapes
    // converge, so the choice is pinned rather than left to `find`'s ordering.
    const outcome = selectEntryOutcome([deny(403), allow("tu-second")]);

    expect(outcome.allowed === true && outcome.auth.allowed).toBe(true);
    expect(outcome.allowed === true && outcome.auth.context.tenantUserId).toBe(
      "tu-second"
    );
  });
});
