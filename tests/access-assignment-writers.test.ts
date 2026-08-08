/**
 * Every writer of `awcms_access_assignments` refuses SYSTEM roles — or is a
 * named exception with a reason.
 *
 * ## Why this is a gate and not a code review note
 *
 * `owner` is a system role, and `tenant-admin/application/platform-bootstrap.ts`
 * seeds it with the tenant's ENTIRE permission catalogue. So "may this actor
 * write a row into `awcms_access_assignments` naming a system role?" is the
 * single question standing between a scoped permission and full tenant
 * control.
 *
 * The ordinary path answered it correctly from the start:
 * `user-admin.ts#assignRole` throws `SystemRoleAssignmentError`, and its route
 * is gated on `access_control.assign`. Approval of a self-registration became a
 * SECOND writer, behind a DIFFERENT permission
 * (`registration_requests.approve`), and it validated `roleIds` with
 * `deleted_at IS NULL` alone. The result was a principal whose role exists
 * precisely so that it does NOT edit the RBAC catalogue being able to mint an
 * `owner` — and the audit row said only `roleCount: 1`.
 *
 * Nothing detected that, because the checks this repo already had answer
 * adjacent questions: `access:permissions:enforcement:check` asks whether a
 * permission has an enforcer, and `access:chokepoint:check` asks whether a
 * handler runs the guard chain. Both were green. Neither asks whether two
 * enforcement sites over one table agree about what may be written.
 *
 * ## What "refuses" means here
 *
 * The scan is textual on purpose: it asks whether the file that writes the row
 * also reads `is_system`, which is the column the rule lives in. It cannot
 * prove the check is correct — that is what
 * `tests/integration/self-registration.integration.test.ts` (system role
 * refused, zero rows) and the `assignRole` tests do against a real database.
 * This one closes the class: a THIRD writer landing tomorrow without any notion
 * of system roles turns it red on the day it lands, rather than on the day
 * someone reads it.
 */
import { describe, expect, test } from "bun:test";

const WRITE_MARKER = "INSERT INTO awcms_access_assignments";

/**
 * Writers that legitimately assign a system role, each with the reason that
 * makes it legitimate. A register of DECISIONS, not a backlog: adding an entry
 * here is the visible act of saying "this path may hand out `owner`".
 */
const SYSTEM_ROLE_WRITERS: Record<string, string> = {
  "src/modules/tenant-admin/application/platform-bootstrap.ts":
    "Tenant bootstrap IS the act of creating the first owner. It runs once, " +
    "before any session exists, from the setup wizard and tenant provisioning " +
    "— there is no actor whose privileges it could exceed."
};

async function assignmentWriters(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob("src/**/*.ts").scan({
    cwd: process.cwd()
  })) {
    const source = await Bun.file(file).text();

    if (source.includes(WRITE_MARKER)) {
      files.push(file);
    }
  }

  return files.sort();
}

describe("writers of awcms_access_assignments", () => {
  test("the scan finds the writers it is meant to check", async () => {
    const writers = await assignmentWriters();

    // A glob that resolves to nothing would make every assertion below pass
    // vacuously — the exact failure mode `tests/module-absence-claims.test.ts`
    // documents from its own first version.
    expect(writers.length).toBeGreaterThanOrEqual(2);
    expect(writers).toContain(
      "src/modules/identity-access/application/user-admin.ts"
    );
    expect(writers).toContain(
      "src/modules/identity-access/application/self-registration.ts"
    );
  });

  test("each one refuses system roles, or is a listed exception", async () => {
    const offenders: string[] = [];

    for (const file of await assignmentWriters()) {
      if (file in SYSTEM_ROLE_WRITERS) {
        continue;
      }

      const source = await Bun.file(file).text();

      if (!source.includes("is_system")) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no exception outlives the writer it excuses", async () => {
    // A stale entry is worse than a missing one: it reads as a reviewed
    // decision about code that no longer exists, and the next reader inherits
    // it as precedent. Same rule the permission-enforcement exception list
    // enforces on itself.
    const writers = new Set(await assignmentWriters());
    const stale = Object.keys(SYSTEM_ROLE_WRITERS).filter(
      (file) => !writers.has(file)
    );

    expect(stale).toEqual([]);
  });
});
