/**
 * Real-PostgreSQL tests for the office directory (GHSA-r7cx-c4jh-cvvw, Issue
 * #149). These cannot be written against a fake `Bun.SQL`: the thing under
 * test in the advisory case is a FOREIGN KEY — a property of the database, not
 * of the application — and a stubbed driver would happily "prove" whatever the
 * stub was written to say. The duplicate-code case is likewise a real unique
 * index raising a real 23505.
 *
 * Requires a throwaway database with `sql/` applied (`bun run db:migrate`).
 * Gated on `DATABASE_URL`, the same convention as
 * `workflow-approval-concurrency.test.ts`. `ci.yml`'s `quality` job has no
 * database and skips cleanly; it actually executes in `ci.yml`'s
 * `integration-tests` job and `release.yml`'s `validate` job, each in a
 * dedicated `bun test <legacy files>` step run separately from the
 * harness-based `tests/integration/` suite (see `tests/integration/
 * harness.ts` — the two collide if run together in one `bun test` process).
 * A bespoke variable would mean it never runs in any pipeline.
 * `OFFICE_TEST_DATABASE_URL` overrides for a local scratch run.
 *
 * No `mock.module` anywhere here, deliberately: it mutates the live module
 * namespace in place and leaks into every test file that runs afterwards in
 * the same process.
 *
 * The suite only touches tenants it creates itself and deletes them again.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createOffice,
  DuplicateOfficeCodeError,
  listOffices,
  OFFICE_LIST_LIMIT,
  ParentOfficeNotFoundError
} from "../src/modules/tenant-admin/application/office-directory";
import { decodeKeysetCursor } from "../src/modules/_shared/keyset-pagination";

const DATABASE_URL =
  process.env.OFFICE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describeOrSkip("office directory (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 5 });
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      // Detach the hierarchy first: the parent FK is NO ACTION, so a parent
      // cannot be deleted while a child still points at it.
      await sql`UPDATE awcms_offices SET parent_office_id = NULL WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_offices WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  async function createTenant(label: string): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`office-${label}-${suffix}`}, ${`Office test ${label}`})
      RETURNING id
    `) as { id: string }[];
    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    return tenantId;
  }

  /** Mirrors `withTenant`: pins the tenant GUC, runs in one transaction. */
  async function inTenant<T>(
    tenantId: string,
    fn: (tx: Bun.SQL) => Promise<T>
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as Bun.SQL);
    }) as Promise<T>;
  }

  async function seedOffice(
    tenantId: string,
    officeCode: string,
    overrides: { deletedAt?: Date } = {}
  ): Promise<string> {
    const rows = (await sql`
      INSERT INTO awcms_offices (tenant_id, office_code, office_name, deleted_at)
      VALUES (${tenantId}, ${officeCode}, ${`Office ${officeCode}`}, ${overrides.deletedAt ?? null})
      RETURNING id
    `) as { id: string }[];
    return rows[0]!.id;
  }

  describe("cross-tenant parent (GHSA-r7cx-c4jh-cvvw)", () => {
    /**
     * The advisory itself, at the layer that cannot be bypassed. This asserts
     * on the DATABASE, not on `createOffice` — an application check is only
     * ever as good as the code path that runs it, and the whole point of the
     * composite FK is to hold when no application code is involved at all.
     *
     * On the pre-020 schema (`REFERENCES awcms_offices (id)`) this INSERT
     * SUCCEEDS and the test fails on the unfulfilled `rejects`. Note the GUC
     * is pinned to tenant A throughout: RLS — even FORCEd, per sql/017 — does
     * not stop it, because PostgreSQL runs referential integrity checks as the
     * table owner with RLS bypassed.
     */
    test("the FK itself rejects a parent belonging to another tenant", async () => {
      const tenantA = await createTenant("a");
      const tenantB = await createTenant("b");
      const foreignParentId = await seedOffice(tenantB, "B-HQ");

      await sql`SELECT set_config('app.current_tenant_id', ${tenantA}, false)`;

      // Explicit try/catch rather than `expect(...).rejects`: a Bun.SQL query
      // is a lazy thenable, and handing one straight to `.rejects` makes a
      // SUCCEEDING insert (i.e. exactly the vulnerable pre-020 case this test
      // exists to catch) hang until the test timeout instead of failing with a
      // readable message. Capturing the outcome ourselves keeps the failure on
      // unfixed schema legible.
      let outcome: string;

      try {
        await sql`
          INSERT INTO awcms_offices (tenant_id, office_code, office_name, parent_office_id)
          VALUES (${tenantA}, ${"A-BR"}, ${"A branch"}, ${foreignParentId})
        `;
        outcome = "ACCEPTED cross-tenant parent";
      } catch (error) {
        outcome =
          error instanceof Bun.SQL.PostgresError
            ? `rejected:${String(error.errno)}`
            : `other:${String(error)}`;
      }

      // 23503 = foreign_key_violation.
      expect(outcome).toBe("rejected:23503");
    });

    /** The application layer turns that same attempt into a clean 400-shaped error rather than an FK violation (500). */
    test("createOffice rejects a cross-tenant parent before writing anything", async () => {
      const tenantA = await createTenant("a");
      const tenantB = await createTenant("b");
      const foreignParentId = await seedOffice(tenantB, "B-HQ");

      await expect(
        inTenant(tenantA, (tx) =>
          createOffice(tx, tenantA, ACTOR, {
            officeCode: "A-BR",
            officeName: "A branch",
            officeType: "branch",
            parentOfficeId: foreignParentId
          })
        )
      ).rejects.toBeInstanceOf(ParentOfficeNotFoundError);

      // Nothing was written — the rejected attempt must not leave a partial
      // office behind, and must not leave tenant B's office reparented.
      const leftovers = (await sql`
        SELECT id FROM awcms_offices WHERE tenant_id = ${tenantA}
      `) as { id: string }[];
      expect(leftovers).toHaveLength(0);
    });

    /**
     * The existence oracle. Pre-fix, a real id from another tenant returned
     * 200 while a random uuid returned an FK violation — that difference is
     * what let an attacker enumerate office ids platform-wide. Both must now
     * fail the same way.
     */
    test("an unknown id and another tenant's id fail identically", async () => {
      const tenantA = await createTenant("a");
      const tenantB = await createTenant("b");
      const foreignParentId = await seedOffice(tenantB, "B-HQ");
      const unknownId = "99999999-9999-4999-8999-999999999999";

      const attempt = (parentOfficeId: string) =>
        inTenant(tenantA, (tx) =>
          createOffice(tx, tenantA, ACTOR, {
            officeCode: `A-${Math.random().toString(36).slice(2, 8)}`,
            officeName: "A branch",
            officeType: "branch",
            parentOfficeId
          })
        ).then(
          () => "accepted",
          (error: unknown) =>
            error instanceof ParentOfficeNotFoundError
              ? `rejected:${error.message}`
              : `other:${String(error)}`
        );

      const foreignOutcome = await attempt(foreignParentId);
      const unknownOutcome = await attempt(unknownId);

      expect(foreignOutcome).toBe(unknownOutcome);
      expect(foreignOutcome).toStartWith("rejected:");
    });

    /** A same-tenant parent is the normal case and must still work. */
    test("accepts a live parent in the same tenant", async () => {
      const tenantId = await createTenant("a");
      const parentId = await seedOffice(tenantId, "HQ");

      const office = await inTenant(tenantId, (tx) =>
        createOffice(tx, tenantId, ACTOR, {
          officeCode: "BR-1",
          officeName: "Branch 1",
          officeType: "branch",
          parentOfficeId: parentId
        })
      );

      expect(office.parentOfficeId).toBe(parentId);
    });

    /** Root offices (the common case) must be unaffected: MATCH SIMPLE skips the check when parent_office_id IS NULL. */
    test("accepts a null parent", async () => {
      const tenantId = await createTenant("a");

      const office = await inTenant(tenantId, (tx) =>
        createOffice(tx, tenantId, ACTOR, {
          officeCode: "HQ",
          officeName: "HQ",
          officeType: "head_office",
          parentOfficeId: null
        })
      );

      expect(office.parentOfficeId).toBeNull();
    });
  });

  describe("soft-deleted parent (Issue #149 §3)", () => {
    /**
     * No FK can express this — a soft-deleted row is still physically there —
     * so this is the application check's own responsibility, and the only one
     * of the three bad-parent cases that depends on it alone.
     */
    test("rejects a parent that is soft-deleted", async () => {
      const tenantId = await createTenant("a");
      const deletedParentId = await seedOffice(tenantId, "OLD-HQ", {
        deletedAt: new Date()
      });

      await expect(
        inTenant(tenantId, (tx) =>
          createOffice(tx, tenantId, ACTOR, {
            officeCode: "BR-1",
            officeName: "Branch 1",
            officeType: "branch",
            parentOfficeId: deletedParentId
          })
        )
      ).rejects.toBeInstanceOf(ParentOfficeNotFoundError);

      const leftovers = (await sql`
        SELECT id FROM awcms_offices
        WHERE tenant_id = ${tenantId} AND office_code = ${"BR-1"}
      `) as { id: string }[];
      expect(leftovers).toHaveLength(0);
    });
  });

  describe("duplicate officeCode (Issue #149 §2)", () => {
    test("maps 23505 to DuplicateOfficeCodeError", async () => {
      const tenantId = await createTenant("a");
      await seedOffice(tenantId, "HQ");

      await expect(
        inTenant(tenantId, (tx) =>
          createOffice(tx, tenantId, ACTOR, {
            officeCode: "HQ",
            officeName: "Another HQ",
            officeType: "branch",
            parentOfficeId: null
          })
        )
      ).rejects.toBeInstanceOf(DuplicateOfficeCodeError);
    });

    /**
     * The unique index is partial (`WHERE deleted_at IS NULL`), so a code
     * freed by a soft delete must be reusable — asserting the 409 above does
     * not accidentally forbid this.
     */
    test("allows reusing the code of a soft-deleted office", async () => {
      const tenantId = await createTenant("a");
      await seedOffice(tenantId, "HQ", { deletedAt: new Date() });

      const office = await inTenant(tenantId, (tx) =>
        createOffice(tx, tenantId, ACTOR, {
          officeCode: "HQ",
          officeName: "New HQ",
          officeType: "head_office",
          parentOfficeId: null
        })
      );

      expect(office.officeCode).toBe("HQ");
    });

    /** The same code in a DIFFERENT tenant is not a conflict — uniqueness is per tenant. */
    test("does not treat another tenant's code as a conflict", async () => {
      const tenantA = await createTenant("a");
      const tenantB = await createTenant("b");
      await seedOffice(tenantB, "HQ");

      const office = await inTenant(tenantA, (tx) =>
        createOffice(tx, tenantA, ACTOR, {
          officeCode: "HQ",
          officeName: "A HQ",
          officeType: "head_office",
          parentOfficeId: null
        })
      );

      expect(office.officeCode).toBe("HQ");
    });
  });

  describe("keyset pagination (Issue #149 §1)", () => {
    test("caps a page at OFFICE_LIST_LIMIT and pages through with the cursor", async () => {
      const tenantId = await createTenant("a");
      const total = OFFICE_LIST_LIMIT + 5;

      for (let index = 0; index < total; index += 1) {
        await seedOffice(tenantId, `OF-${String(index).padStart(3, "0")}`);
      }

      const first = await inTenant(tenantId, (tx) => listOffices(tx, tenantId));
      expect(first.items).toHaveLength(OFFICE_LIST_LIMIT);
      expect(first.nextCursor).not.toBeNull();

      const second = await inTenant(tenantId, (tx) =>
        listOffices(tx, tenantId, decodeKeysetCursor(first.nextCursor!))
      );
      expect(second.items).toHaveLength(total - OFFICE_LIST_LIMIT);
      // Last page: fewer rows than the limit means there is nothing after it.
      expect(second.nextCursor).toBeNull();

      // The two pages must partition the set — no row skipped, none repeated.
      const seen = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(seen).size).toBe(total);
    });

    /**
     * The worst case for cursor precision, and the reason the shared keyset
     * cursor now carries the full microsecond `created_at` as text (Issue #158)
     * instead of a millisecond-precision JS `Date`: rows created inside ONE
     * transaction share `created_at` exactly (it is transaction time), so a page
     * boundary landing inside such a group is decided entirely by the `id`
     * tiebreaker.
     *
     * Against the old millisecond cursor this returned 100 of 103 — page 2 came
     * back EMPTY, because a millisecond-precision cursor sorts strictly before
     * every microsecond-bearing row it was built from, and three offices became
     * permanently unreachable through the API. Asserting the partition (rather
     * than just the lengths) is what catches that:
     * silent loss looks like success to a caller who only checks page 1.
     */
    test("pages correctly when created_at ties across the page boundary", async () => {
      const tenantId = await createTenant("a");
      const total = OFFICE_LIST_LIMIT + 3;

      await sql.begin(async (tx) => {
        for (let index = 0; index < total; index += 1) {
          await tx`
            INSERT INTO awcms_offices (tenant_id, office_code, office_name)
            VALUES (${tenantId}, ${`TIE-${String(index).padStart(3, "0")}`}, ${"Tied"})
          `;
        }
      });

      const first = await inTenant(tenantId, (tx) => listOffices(tx, tenantId));
      expect(first.items).toHaveLength(OFFICE_LIST_LIMIT);

      const second = await inTenant(tenantId, (tx) =>
        listOffices(tx, tenantId, decodeKeysetCursor(first.nextCursor!))
      );

      const seen = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(seen).size).toBe(total);
      expect(second.nextCursor).toBeNull();
    });

    test("returns newest first and excludes soft-deleted offices", async () => {
      const tenantId = await createTenant("a");
      const oldestId = await seedOffice(tenantId, "OLD");
      const deletedId = await seedOffice(tenantId, "GONE", {
        deletedAt: new Date()
      });
      const newestId = await seedOffice(tenantId, "NEW");

      const page = await inTenant(tenantId, (tx) => listOffices(tx, tenantId));
      const ids = page.items.map((item) => item.id);

      expect(ids).toEqual([newestId, oldestId]);
      expect(ids).not.toContain(deletedId);
      expect(page.nextCursor).toBeNull();
    });

    /** A cursor must never leak rows across tenants. */
    test("a cursor does not carry rows across tenants", async () => {
      const tenantA = await createTenant("a");
      const tenantB = await createTenant("b");
      await seedOffice(tenantA, "A-HQ");
      const bOfficeId = await seedOffice(tenantB, "B-HQ");

      const page = await inTenant(tenantA, (tx) => listOffices(tx, tenantA));

      expect(page.items.map((item) => item.id)).not.toContain(bOfficeId);
    });
  });
});
