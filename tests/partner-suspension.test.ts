/**
 * A suspended partner stops reaching in — ADR-0093, Issue #543.
 *
 * `sql/116` pinned `awcms_partners.status` to `'active'` with a CHECK and wrote
 * its own condition into the file header: the widening lands in the SAME PR as
 * its reader, or not at all. Shipping a partner that CAN be suspended before
 * anything READS suspension is a control that reads as enforced and is not —
 * the shape `sql/106` used for `scope_type`.
 *
 * These tests hold the three readers to that, and they check the two things a
 * decision rule can get wrong in the direction that matters:
 *
 * - **deny-only.** An ordinary member's decision must be untouched, whatever
 *   the registry says.
 * - **fail-closed.** A delegated actor whose partner has no registry row is
 *   treated as suspended, and an in-statement predicate is what makes the two
 *   write paths refuse — never a TypeScript check that precedes the INSERT.
 *
 * Pure — no database, no network. The SQL assertions read the statements as
 * source, which is the only way to pin "the predicate is INSIDE the statement"
 * at all: a behavioural test is satisfied by both the correct arrangement and
 * the TOCTOU one.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import {
  isDelegatedPartnerRefused,
  isPartnerStatus,
  PARTNER_STATUSES
} from "../src/modules/identity-access/domain/partner-suspension";

const MIGRATION = "sql/124_awcms_partner_suspension.sql";
const GUARD = "src/modules/identity-access/application/access-guard.ts";
const AUTH_CONTEXT = "src/modules/identity-access/application/auth-context.ts";
const GRANT_STORE =
  "src/modules/identity-access/application/delegated-access-store.ts";
const ENGAGEMENT_STORE =
  "src/modules/identity-access/application/partner-engagement-store.ts";
const REGISTRY_STORE =
  "src/modules/identity-access/application/partner-registry-store.ts";

describe("the decision rule is deny-only", () => {
  test("an ordinary member is untouched, whatever the registry says", () => {
    for (const status of ["active", "suspended", null] as const) {
      expect(
        isDelegatedPartnerRefused({
          principalKind: "user",
          partnerRegistryStatus: status
        })
      ).toBe(false);

      // `undefined` reads as "user" — the same default `TenantContext`
      // documents, and ~30 call sites rely on it.
      expect(isDelegatedPartnerRefused({ partnerRegistryStatus: status })).toBe(
        false
      );
    }
  });

  test("a delegated actor is refused when the partner is not active", () => {
    expect(
      isDelegatedPartnerRefused({
        principalKind: "delegated",
        partnerRegistryStatus: "suspended"
      })
    ).toBe(true);
  });

  test("and allowed when it is", () => {
    expect(
      isDelegatedPartnerRefused({
        principalKind: "delegated",
        partnerRegistryStatus: "active"
      })
    ).toBe(false);
  });

  test("no registry row REFUSES — unreachable today, which is why it is free", () => {
    // `sql/120`'s foreign key requires a registered partner for as long as any
    // grant exists, so there is no working case for fail-closed to break — and
    // the alternative is a gate a deleted row switches off.
    expect(
      isDelegatedPartnerRefused({
        principalKind: "delegated",
        partnerRegistryStatus: null
      })
    ).toBe(true);
  });
});

describe("the status list matches the CHECK constraint", () => {
  test("exactly two values, and the migration allows exactly those", async () => {
    const migration = await readFile(MIGRATION, "utf8");

    expect([...PARTNER_STATUSES]).toEqual(["active", "suspended"]);
    expect(migration).toContain("CHECK (status IN ('active', 'suspended'))");
    // The old single-value CHECK is dropped, not left alongside — two
    // constraints where one was widened is a widening that did not happen.
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS awcms_partners_status_active_only_check"
    );
  });

  test("`isPartnerStatus` accepts those two and nothing else", () => {
    for (const value of PARTNER_STATUSES) {
      expect(isPartnerStatus(value)).toBe(true);
    }
    for (const value of ["", "ACTIVE", "deleted", "pending"]) {
      expect(isPartnerStatus(value)).toBe(false);
    }
  });
});

describe("the chokepoint reads it, which is what the widening was waiting for", () => {
  test("the gate runs BEFORE any permission is fetched", async () => {
    const source = stripComments(await readFile(GUARD, "utf8"));

    const gate = source.indexOf("isDelegatedPartnerRefused(");
    const grants = source.indexOf("fetchGrantedPermissionKeys(");

    expect(gate).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(-1);
    // Structural, like the tenant-suspension and delegated-write gates above
    // it: no grant row may influence a refusal that is about the partner.
    expect(gate).toBeLessThan(grants);
  });

  test("it refuses with its own code, not a generic denial", async () => {
    const source = await readFile(GUARD, "utf8");

    expect(source).toContain('"PARTNER_SUSPENDED"');
    expect(source).toContain('matchedPolicy: "partner_suspended"');
  });

  test("the read goes through the SECURITY DEFINER function, because RLS forbids the table", async () => {
    const context = stripComments(await readFile(AUTH_CONTEXT, "utf8"));

    // `awcms_partners` is platform-owned and FORCE-RLS; the chokepoint runs in
    // the CUSTOMER's transaction. A plain SELECT here would return zero rows
    // forever — the cross-tenant-read trap that ate two waves.
    expect(context).toContain("awcms_partner_registry_status(");
    expect(context).not.toContain("FROM awcms_partners");
  });
});

describe("both write paths refuse INSIDE the statement, never before it", () => {
  test("the grant INSERT carries the predicate", async () => {
    const source = stripComments(await readFile(GRANT_STORE, "utf8"));

    const insert = source.slice(
      source.indexOf("INSERT INTO awcms_delegated_access_grants"),
      source.indexOf("RETURNING id")
    );

    expect(insert.length).toBeGreaterThan(100);
    expect(insert).toContain("awcms_partner_registry_status(");
    expect(insert).toContain("= 'active'");
  });

  test("the engagement INSERT carries it too, and became an INSERT … SELECT to hold it", async () => {
    const source = stripComments(await readFile(ENGAGEMENT_STORE, "utf8"));

    const insert = source.slice(
      source.indexOf("INSERT INTO awcms_partner_managed_tenants"),
      source.indexOf("RETURNING id, partner_tenant_id, engaged_at")
    );

    expect(insert.length).toBeGreaterThan(100);
    // A `VALUES` clause cannot carry a predicate, so the shape had to change.
    // That is the point: a `SELECT 1 FROM awcms_partners` before the INSERT
    // would be a TOCTOU the platform can win by suspending in between.
    expect(insert).toContain("SELECT");
    expect(insert).toContain("awcms_partner_registry_status(");
    expect(insert).not.toContain("VALUES");
  });

  test("neither store checks the status in TypeScript first", async () => {
    for (const path of [GRANT_STORE, ENGAGEMENT_STORE]) {
      const source = stripComments(await readFile(path, "utf8"));

      // A JS-side comparison against a status read earlier is exactly the race
      // the in-statement predicate exists to remove.
      expect(source).not.toMatch(/status\s*===\s*["']active["']/);
    }
  });
});

describe("what suspension deliberately does NOT do", () => {
  test("the writer touches one column and no grant row", async () => {
    const source = stripComments(await readFile(REGISTRY_STORE, "utf8"));

    const writer = source.slice(
      source.indexOf("export async function setPartnerStatus")
    );

    expect(writer.length).toBeGreaterThan(200);
    expect(writer).toContain("UPDATE awcms_partners");
    // `sql/120` made a grant outlive its engagement on purpose: "who could see
    // our data, and until when" has to stay answerable AFTER the vendor is
    // dismissed. A suspension that deleted grants would destroy the record
    // exactly when it is most wanted.
    expect(writer).not.toContain("awcms_delegated_access_grants");
    expect(writer).not.toContain("awcms_partner_managed_tenants");
    expect(writer).not.toContain("DELETE");
  });

  test("the transition is guarded by the status it read, so two operators make one audit row", async () => {
    const source = stripComments(await readFile(REGISTRY_STORE, "utf8"));

    expect(source).toContain("AND status = ${current.status}");
  });
});

describe("the migration seeds both permissions as PLATFORM", () => {
  test("disable and restore, and neither is tenant-scoped", async () => {
    const migration = await readFile(MIGRATION, "utf8");

    expect(migration).toContain("'partner_registry', 'disable'");
    expect(migration).toContain("'partner_registry', 'restore'");
    // A tenant-scoped one would be handed out by `createTenantWithOwner` and
    // the backfill job, both of which filter `WHERE scope = 'tenant'` — every
    // customer would be able to suspend every partner.
    expect(migration).not.toContain("'tenant'");
  });

  test("the grant runs off `awcms_setup_state`, never `awcms_tenants`", async () => {
    const migration = await readFile(MIGRATION, "utf8");

    // The shape that reads tidier — a grant walking `awcms_tenants` — is the
    // original defect ADR-0053 closed.
    expect(migration).toContain("FROM awcms_setup_state s");
    expect(migration).not.toMatch(/FROM awcms_tenants\b/);
  });
});
