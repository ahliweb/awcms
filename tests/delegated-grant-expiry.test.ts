/**
 * An expired delegated grant confers nothing — ADR-0090, finding A1 of the
 * 17 August 2026 audit round.
 *
 * `sql/117` gave every grant an `expires_at` and a 31-day CHECK, ADR-0090 wrote
 * that revocation **and expiry** deactivate the membership, and
 * `expireDelegatedAccessGrants` was written to do it. Nothing ever called it,
 * and both request-time resolvers filtered on `revoked_at IS NULL` alone — so a
 * partner engagement scoped "until 30 September" kept conferring its role until
 * somebody revoked it by hand. The date was decoration.
 *
 * The repair is deliberately NOT "schedule the sweep". A sweep leaves a window
 * between the second on the row and the second the timer next fires, and that
 * window is exactly when the access should already have stopped. So expiry is a
 * DECISION-TIME gate, the shape `isBusinessScopeAssignmentCurrentlyActive` and
 * `isSoDConflictExceptionCurrentlyValid` already use twice over in this module,
 * and the sweep — when it lands — is bookkeeping on top of a gate that has
 * already refused.
 *
 * These tests hold three properties, and the third is the one a behavioural
 * test cannot see:
 *
 * - **deny-only.** An ordinary member's decision is untouched, whatever the
 *   dates say.
 * - **fail-closed.** No live grant row reads as "not in force".
 * - **the comparison happens in the DATABASE, against the clock that wrote the
 *   column.** A resolver that pulled `expires_at` out and compared it to a
 *   JavaScript `Date` would pass every behavioural test and make the gate
 *   depend on two clocks agreeing.
 *
 * Pure — no database, no network. The SQL assertions read the statements as
 * source, which is the only way to pin "the predicate is INSIDE the statement".
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { isDelegatedGrantNotInForce } from "../src/modules/identity-access/domain/delegated-access";

const GUARD = "src/modules/identity-access/application/access-guard.ts";
const AUTH_CONTEXT = "src/modules/identity-access/application/auth-context.ts";
const GRANT_STORE =
  "src/modules/identity-access/application/delegated-access-store.ts";
const POLICY_WRITER =
  "src/modules/identity-access/application/access-policy-writer.ts";

describe("the decision rule is deny-only and fail-closed", () => {
  test("an ordinary member is never refused, whatever `grantLive` says", () => {
    for (const grantLive of [true, false]) {
      expect(
        isDelegatedGrantNotInForce({ principalKind: "user", grantLive })
      ).toBe(false);
      // `undefined` reads as "user" — the field is optional on TenantContext.
      expect(isDelegatedGrantNotInForce({ grantLive })).toBe(false);
    }
  });

  test("a delegated actor is refused exactly when the grant is not live", () => {
    expect(
      isDelegatedGrantNotInForce({
        principalKind: "delegated",
        grantLive: true
      })
    ).toBe(false);
    expect(
      isDelegatedGrantNotInForce({
        principalKind: "delegated",
        grantLive: false
      })
    ).toBe(true);
  });
});

describe("the resolver asks the database, not the process clock", () => {
  test("the predicate is `expires_at > now()`, inside the statement", async () => {
    const source = stripComments(await readFile(AUTH_CONTEXT, "utf8"));

    const statement = source.slice(
      source.indexOf("export async function resolveDelegatedGrantState"),
      source.indexOf("`) as { status: string | null; grant_live: boolean }[]")
    );

    expect(statement.length).toBeGreaterThan(200);
    expect(statement).toContain("g.expires_at > now()");
    // The whole point of `now()`: it is the transaction-start instant, from the
    // same clock that wrote `expires_at`. A `${now}` parameter here would carry
    // this process's clock into a comparison the database is answering.
    expect(statement).not.toMatch(/expires_at\s*>\s*\$\{/);
  });

  test("both facts come off one row, so the refusal can be named correctly", async () => {
    const source = stripComments(await readFile(AUTH_CONTEXT, "utf8"));

    const statement = source.slice(
      source.indexOf("export async function resolveDelegatedGrantState"),
      source.indexOf("`) as { status: string | null; grant_live: boolean }[]")
    );

    expect(statement).toContain("awcms_partner_registry_status(");
    expect(statement).toContain("grant_live");
    expect(
      (statement.match(/FROM awcms_delegated_access_grants/g) ?? []).length
    ).toBe(1);
  });

  test("no live row means BOTH fields refuse", async () => {
    const source = stripComments(await readFile(AUTH_CONTEXT, "utf8"));

    // `row?.grant_live === true` rather than `!== false`: a missing row, a NULL
    // and an undefined column all have to land on "not in force", and only an
    // explicit positive test does that for all three.
    expect(source).toContain("grantLive: row?.grant_live === true");
  });

  test("the attribution resolver is deliberately NOT filtered on expiry", async () => {
    const source = stripComments(await readFile(AUTH_CONTEXT, "utf8"));

    const attribution = source.slice(
      source.indexOf("async function resolveDelegatedGrantId"),
      source.indexOf("export type DelegatedGrantState")
    );

    expect(attribution.length).toBeGreaterThan(200);
    expect(attribution).not.toContain("expires_at");
    // Because that id is what makes the refusal legible: a decision log that
    // cannot name the engagement is where an investigation stops.
    expect(attribution).toContain(
      "SELECT id FROM awcms_delegated_access_grants"
    );
  });
});

describe("the chokepoint refuses before anything can widen the decision", () => {
  test("the expiry gate runs BEFORE any permission is fetched", async () => {
    const source = stripComments(await readFile(GUARD, "utf8"));

    const gate = source.indexOf("isDelegatedGrantNotInForce(");
    const grants = source.indexOf("fetchGrantedPermissionKeys(");

    expect(gate).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(grants);
  });

  test("it runs BEFORE the partner-suspension gate, so the reason is the true one", async () => {
    const source = stripComments(await readFile(GUARD, "utf8"));

    const expiry = source.indexOf("isDelegatedGrantNotInForce(");
    const suspended = source.indexOf("isDelegatedPartnerRefused(");

    expect(expiry).toBeGreaterThan(-1);
    expect(suspended).toBeGreaterThan(-1);
    // An expired grant also reads as "no live row" to the partner resolver, so
    // whichever branch runs first names the refusal. Recording an expiry as
    // `partner_suspended` would send a customer to ask a vendor about a
    // suspension that never happened.
    expect(expiry).toBeLessThan(suspended);
  });

  test("it refuses with its own code, and writes its own decision log", async () => {
    const source = await readFile(GUARD, "utf8");

    expect(source).toContain('"DELEGATED_GRANT_EXPIRED"');
    expect(source).toContain('matchedPolicy: "delegated_grant_expired"');

    const stripped = stripComments(source);
    const gate = stripped.indexOf("isDelegatedGrantNotInForce(");
    const log = stripped.indexOf("recordDecisionLog(", gate);
    const refusal = stripped.indexOf("DELEGATED_GRANT_EXPIRED", gate);

    expect(log).toBeGreaterThan(gate);
    expect(log).toBeLessThan(refusal);
  });
});

describe("redemption dates the role it grants", () => {
  test("the redemption passes the grant's own expiry as the role's end date", async () => {
    const source = stripComments(await readFile(GRANT_STORE, "utf8"));

    const redeem = source.slice(
      source.indexOf("export async function redeemDelegatedAccess"),
      source.indexOf("UPDATE awcms_delegated_access_grants")
    );

    expect(redeem.length).toBeGreaterThan(200);
    expect(redeem).toContain("roleEffectiveTo: new Date(grant.expires_at)");
    // Paired, never alone: `sql/102` compares the two columns, and the default
    // for `effective_from` is `now()` — the transaction clock, not this one.
    expect(redeem).toContain("roleEffectiveFrom: now");
    // And the pair is only safe because the function already refused a grant
    // whose date has passed, against that same `now`.
    expect(redeem).toContain('return { ok: false, code: "GRANT_EXPIRED" };');
  });

  test("the policy writer writes both columns, and defaults only the start", async () => {
    const source = stripComments(await readFile(POLICY_WRITER, "utf8"));

    const insert = source.slice(
      source.indexOf("INSERT INTO awcms_access_policies"),
      source.indexOf("RETURNING id")
    );

    expect(insert).toContain("effective_from, effective_to");
    expect(insert).toContain("COALESCE(");
    expect(insert).toContain("::timestamptz, now())");
  });

  test("every other grant stays open-ended", async () => {
    const source = stripComments(await readFile(POLICY_WRITER, "utf8"));

    // Optional, not required: an invitation grants a membership, not an
    // episode, and a required end date would make every caller invent one.
    expect(source).toContain("effectiveFrom?: Date;");
    expect(source).toContain("effectiveTo?: Date;");
    expect(source).toContain("${input.effectiveTo ?? null}::timestamptz");
  });
});
