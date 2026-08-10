/**
 * Every writer of a role GRANT refuses SYSTEM roles — or is a named exception
 * with a reason.
 *
 * ## Why this is a gate and not a code review note
 *
 * `owner` is a system role, and `tenant-admin/application/platform-bootstrap.ts`
 * seeds it with the tenant's ENTIRE permission catalogue. So "may this actor
 * cause a grant row naming a system role?" is the single question standing
 * between a scoped permission and full tenant control.
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
 * ## The definition of "writer" moved with the writers (ADR-0078)
 *
 * It used to be one string: a file containing `INSERT INTO
 * awcms_access_assignments`. Gelombang 3 PR 3.2 moved grants to
 * `awcms_access_policies` AND routed most of them through one shared function,
 * so a file can now cause a grant without containing an INSERT at all.
 *
 * Both had to change together. A marker naming a table nothing writes any more
 * leaves this file green by finding nothing — the exact failure its own first
 * assertion exists to catch — and a marker that saw only the INSERT would have
 * silently narrowed a four-writer rule down to two.
 *
 * ## What "refuses" means here
 *
 * The scan is textual on purpose: it asks whether the file that causes the grant
 * also reads `is_system`, which is the column the rule lives in. It cannot prove
 * the check is correct — that is what
 * `tests/integration/self-registration.integration.test.ts` (system role
 * refused, zero rows) and the `assignRole` tests do against a real database.
 * This one closes the class: a writer landing tomorrow with no notion of system
 * roles turns it red on the day it lands, rather than on the day someone reads
 * it.
 */
import { describe, expect, test } from "bun:test";

/** A file causes a grant if it INSERTs one, or calls the shared writer that does. */
const WRITE_MARKERS = ["INSERT INTO awcms_access_policies", "grantRolePolicy("];

const SHARED_WRITER =
  "src/modules/identity-access/application/access-policy-writer.ts";

/**
 * Writers that legitimately grant a system role, each with the reason that makes
 * it legitimate. A register of DECISIONS, not a backlog: adding an entry here is
 * the visible act of saying "this path may hand out `owner`".
 */
const SYSTEM_ROLE_WRITERS: Record<string, string> = {
  "src/modules/tenant-admin/application/platform-bootstrap.ts":
    "Tenant bootstrap IS the act of creating the first owner. It runs once, " +
    "before any session exists, from the setup wizard and tenant provisioning " +
    "— there is no actor whose privileges it could exceed.",
  [SHARED_WRITER]:
    "The shared INSERT, and deliberately ignorant of system roles: it has no " +
    "actor and no request context to judge against. The refusal belongs to " +
    "each CALLER, which is what the second assertion below checks — so this " +
    "entry excuses the mechanism, never a decision."
};

async function grantWriters(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob("src/**/*.ts").scan({
    cwd: process.cwd()
  })) {
    const source = await Bun.file(file).text();

    if (WRITE_MARKERS.some((marker) => source.includes(marker))) {
      files.push(file);
    }
  }

  return files.sort();
}

describe("writers of awcms_access_policies", () => {
  test("the scan finds the writers it is meant to check", async () => {
    const writers = await grantWriters();

    // A glob that resolves to nothing would make every assertion below pass
    // vacuously — the exact failure mode `tests/module-absence-claims.test.ts`
    // documents from its own first version.
    expect(writers.length).toBeGreaterThanOrEqual(3);
    expect(writers).toContain(
      "src/modules/identity-access/application/user-admin.ts"
    );
    expect(writers).toContain(
      "src/modules/identity-access/application/self-registration.ts"
    );
    expect(writers).toContain(SHARED_WRITER);
  });

  test("it finds a file that only CALLS the shared writer, not just ones that INSERT", async () => {
    // `user-admin.ts` no longer contains an INSERT of its own. If the marker had
    // stayed a single INSERT string, the file carrying the repo's primary
    // system-role refusal would have dropped out of the rule entirely.
    const source = await Bun.file(
      "src/modules/identity-access/application/user-admin.ts"
    ).text();

    expect(source).not.toContain("INSERT INTO awcms_access_policies");
    expect(source).toContain("grantRolePolicy(");
  });

  test("each one refuses system roles, or is a listed exception", async () => {
    const offenders: string[] = [];

    for (const file of await grantWriters()) {
      if (file in SYSTEM_ROLE_WRITERS) continue;

      const source = await Bun.file(file).text();

      if (!source.includes("is_system")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  test("no exception outlives the writer it excuses", async () => {
    // A stale entry is worse than a missing one: it reads as a reviewed
    // decision about code that no longer exists, and the next reader inherits
    // it as precedent. Same rule the permission-enforcement exception list
    // enforces on itself.
    const writers = new Set(await grantWriters());
    const stale = Object.keys(SYSTEM_ROLE_WRITERS).filter(
      (file) => !writers.has(file)
    );

    expect(stale).toEqual([]);
  });
});
