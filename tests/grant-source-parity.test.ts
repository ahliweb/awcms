/**
 * One grant source, and every reader on it (ADR-0079, Gelombang 3 PR 3.3 of
 * #423). Supersedes `granted-permission-keys-union.test.ts`, which pinned the
 * two-table union `sql/103` collapsed.
 *
 * ## The failure this file exists for
 *
 * PR 3.2 moved every grant WRITER to `awcms_access_policies`. Five readers kept
 * their own `FROM awcms_access_assignments` join and therefore kept answering
 * about a table nothing writes — each one silently, each one differently:
 * `GET /api/v1/auth/session` reported no roles, `/admin/users` listed none, ABAC
 * `subject.roles` went empty (which makes a DENY policy INERT — a widening), SoD
 * stopped seeing ordinary role grants, and the guard that refuses to deactivate
 * the last administrator concluded there were none, which is a tenant lockout.
 * Thirty-eight gates were green throughout. Nothing in the repo asserted that
 * two readers of the same fact agreed.
 *
 * So the parity is asserted here, on the only property that would have caught
 * it: a reader either goes through `activeRoleGrants` or it is not a reader.
 * `access:grant-readers:check` governs which files may NAME a grant table; this
 * file governs which files must USE the shared one.
 *
 * Pure: source text only, no database. The behavioural half is
 * `tests/integration/access-policy-equivalence.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { GRANT_SOURCE_TABLES } from "../src/modules/identity-access/application/grant-source";

/** Comments out — a docblock explaining a predicate must not satisfy a test about it. */
function codeOf(relativePath: string): string {
  return readFileSync(relativePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const GRANT_SOURCE_PATH =
  "src/modules/identity-access/application/grant-source.ts";
const AUTH_CONTEXT_PATH =
  "src/modules/identity-access/application/auth-context.ts";

const grantSource = codeOf(GRANT_SOURCE_PATH);
const authContext = codeOf(AUTH_CONTEXT_PATH);

/**
 * Every file that answers a question of the form "which roles does this subject
 * hold", with what each one would get WRONG on its own.
 *
 * A literal list rather than a derivation: the thing being asserted is that a
 * human enumerated the readers, and a list computed from the same source as the
 * code under test can only report that the code agrees with itself. Each of the
 * first five is a reader that HAD drifted; the consequence column is what that
 * cost, measured rather than imagined.
 */
const GRANT_CONSUMERS: { file: string; wouldBreak: string }[] = [
  {
    file: AUTH_CONTEXT_PATH,
    wouldBreak:
      "`TenantContext.roles` feeds ABAC `subject.roles`. Empty roles make an allow policy stop matching (narrowing, safe) AND a deny policy stop matching (inert — a widening nobody observes)."
  },
  {
    file: "src/modules/identity-access/application/session-introspection.ts",
    wouldBreak:
      "`GET /api/v1/auth/session` is how a cross-origin BFF renders a portal header; wrong roles there are wrong navigation for every user of the derived app."
  },
  {
    file: "src/modules/identity-access/application/access-directory.ts",
    wouldBreak:
      "/admin/users shows who holds what. Showing nobody as holding anything makes an administrator believe the grant failed and grant it again."
  },
  {
    file: "src/modules/identity-access/application/user-admin.ts",
    wouldBreak:
      "The `last_admin_blocked` guard. If it cannot see that anyone holds the system role, deactivating the only owner is permitted — a tenant lockout with no in-app recovery."
  },
  {
    file: "src/modules/identity-access/application/business-scope-facts.ts",
    wouldBreak:
      "SoD conflict detection reasons about ordinary RBAC grants. Blind to them, it stops reporting conflicts and reports SUCCESS while doing so."
  },
  {
    file: "src/modules/email/application/announcement-directory.ts",
    wouldBreak:
      "Announcement targeting by role. A silently empty recipient set is a send that reports success and reaches nobody."
  },
  {
    file: "src/pages/api/v1/access/policies/simulate.ts",
    wouldBreak:
      "The ABAC simulator. A grant set computed differently from the real path simulates a different system, so a policy can behave in production unlike its preview."
  }
];

describe("the grant source is one definition", () => {
  test("it names the live grant tables and NOT the retired one", () => {
    // The group tables joined the list in ADR-0081 because membership is now
    // part of the answer to "what has been granted to whom" — a change to who
    // is in a group is a change to authorization.
    expect(GRANT_SOURCE_TABLES).toEqual([
      "awcms_access_policies",
      "awcms_user_groups",
      "awcms_user_group_members"
    ]);

    for (const table of GRANT_SOURCE_TABLES) {
      expect(grantSource).toContain(table);
    }

    // Reading the retired table would resurrect grants that revocation can no
    // longer remove — `sql/103` took DELETE away from `awcms_app`.
    expect(grantSource).not.toContain("awcms_access_assignments");
  });

  test("a group grant reaches its members, and a deleted group reaches nobody", () => {
    // The union is what makes ADR-0081 safe to add in ONE place: every reader
    // gets group-derived roles at once, so a DENY policy written against a role
    // keeps working for somebody who holds it through a group. Asserted on the
    // text because the behavioural half needs a database — see
    // `tests/integration/user-groups.integration.test.ts`.
    expect(grantSource).toContain("UNION ALL");
    expect(grantSource).toContain("subject_type = 'user_group'");
    expect(grantSource).toContain("gr.deleted_at IS NULL");
    // And the direct branch must not start matching group rows: the two are
    // discriminated, never merged.
    expect(grantSource).toContain("subject_type = 'tenant_user'");
  });

  test("it filters the whole grant lifecycle", () => {
    expect(grantSource).toContain("status = 'active'");
    expect(grantSource).toContain("effective_from <= now()");
    expect(grantSource).toContain("effective_to > now()");
  });

  test("expiry is compared against the DATABASE clock, never a caller-supplied one", () => {
    // A grant that expires according to the application's idea of the time is a
    // grant an application bug can extend. `now()` in Postgres is the
    // transaction-start instant, so one authorization decision cannot see two
    // different times.
    expect(grantSource).not.toMatch(/effective_to\s*>\s*\$\{/);
    expect(grantSource).not.toMatch(/effective_from\s*<=\s*\$\{/);
  });

  test("it is tenant-filtered in its own text", () => {
    // RLS is the real boundary, but the fragment is spliced into statements that
    // join it against tenant-filtered tables; an unfiltered source would make
    // those joins depend entirely on RLS being on for the connection in hand.
    expect(grantSource).toContain("ap.tenant_id = ${tenantId}");
  });
});

describe("every reader of a role grant goes through it", () => {
  test.each(GRANT_CONSUMERS)("$file", ({ file }) => {
    const code = codeOf(file);

    expect(code).toContain("activeRoleGrants(");
    // The join itself must NOT be re-assembled. Naming either grant table here
    // is how all five drifted readers looked, and every one of them read as
    // correct.
    expect(code).not.toContain("FROM awcms_access_assignments");
    expect(code).not.toContain("FROM awcms_access_policies");
  });

  test("each consumer records what its drifting would cost", () => {
    // The list is only useful if the next person can see why a name is on it
    // without re-deriving the incident.
    for (const consumer of GRANT_CONSUMERS) {
      expect(consumer.wouldBreak.length).toBeGreaterThan(40);
    }
  });
});

describe("fetchGrantedPermissionKeys", () => {
  const query = authContext.slice(
    authContext.indexOf("export async function fetchGrantedPermissionKeys")
  );

  test("the soft-deleted role filter is still applied", () => {
    // A role's `deleted_at` belongs to the role, not to the grant: deleting a
    // role is exactly how an admin takes that access away, and it must bite even
    // while the grant row survives.
    expect(query).toContain("r.deleted_at IS NULL");
  });

  test("the name is unchanged, because a gate is keyed on the literal", () => {
    // `scripts/access-chokepoint-check.ts` keys its "this handler decides
    // permissions" signal on `fetchGrantedPermissionKeys(`. A rename leaves that
    // gate GREEN while it reports zero deciding handlers.
    expect(authContext).toContain(
      "export async function fetchGrantedPermissionKeys"
    );

    const gate = readFileSync("scripts/access-chokepoint-check.ts", "utf8");

    expect(gate).toContain("fetchGrantedPermissionKeys\\(");
  });

  test("the return type has NOT grown a scopes map yet", () => {
    // The program plan has this returning `{ keys, scopes }` for PR 3.4.
    // Shipping a field nothing reads is the unused-capability smell ADR-0077
    // removed. When 3.4 lands, this assertion is the one to delete —
    // deliberately, in the PR that consumes the map.
    expect(query).toContain("Promise<Set<string>>");
  });
});
