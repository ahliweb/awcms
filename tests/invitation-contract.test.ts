/**
 * Structural contract for the invitation surface (ADR-0082, Gelombang 4 of
 * #423).
 *
 * The routes are not testable end to end without a database and a session, and
 * the properties that matter most about them are structural — which guard runs,
 * which column exists, which value cannot be represented. Each assertion below
 * is written to fail when the PROPERTY is removed rather than when the wording
 * changes.
 *
 * Every negative assertion runs against comment-stripped source. This repo has
 * hit the false positive six times, and it is always the FIX that plants it,
 * because a fix explains what it removed — so a docblock saying "the token is
 * never stored" would satisfy a naive search for a `token` column.
 *
 * The behavioural counterpart is `tests/integration/invitations.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import {
  SETUP_ROLE_GRANTS,
  WORKER_ROLE_GRANTS
} from "../scripts/security-readiness";
import { listModules } from "../src/modules";

const SCHEMA = "sql/106_awcms_identity_invitations_schema.sql";
const PERMISSIONS = "sql/107_awcms_identity_invitation_permissions.sql";
const WORKER_GRANT = "sql/108_awcms_identity_invitations_worker_grants.sql";
const TOKEN = "src/lib/auth/invitation-token.ts";
const ADMIN = "src/modules/identity-access/application/invitation-admin.ts";
const CREATE_ROUTE = "src/pages/api/v1/invitations/index.ts";
const REVOKE_ROUTE = "src/pages/api/v1/invitations/[id]/revoke.ts";
const RESEND_ROUTE = "src/pages/api/v1/invitations/[id]/resend.ts";

function read(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

/** Statements only — prose about SQL must never be mistaken for SQL. */
function sqlOf(relativePath: string): string {
  return read(relativePath)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function codeOf(relativePath: string): string {
  return stripComments(read(relativePath));
}

describe("sql/106 — the schema", () => {
  const sql = sqlOf(SCHEMA);

  test("both tables ENABLE and FORCE row level security", () => {
    // ENABLE alone is inert for the table owner. Both lines, both tables.
    for (const table of ["awcms_invitations", "awcms_invitation_policies"]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant_isolation`);
    }
  });

  test("the only GUC either policy reads is app.current_tenant_id", () => {
    const gucs = [...sql.matchAll(/current_setting\('([^']+)'/g)].map(
      (match) => match[1]
    );
    expect(gucs.length).toBeGreaterThan(0);
    expect([...new Set(gucs)]).toEqual(["app.current_tenant_id"]);
  });

  test("the raw token is never stored — only its hash", () => {
    expect(sql).toContain("token_hash text NOT NULL");
    expect(sql).not.toMatch(/^\s*token text/m);
  });

  test("token_hash is UNIQUE ALONE, not per tenant", () => {
    // A per-tenant unique index would let one raw token match two rows in two
    // tenants, and redemption would have to pick one. Same reasoning as
    // awcms_password_reset_tokens_hash_key.
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS awcms_invitations_token_hash_key\n  ON awcms_invitations (token_hash);"
    );
  });

  test("the resend ceiling is a database CHECK", () => {
    expect(sql).toContain("awcms_invitations_resend_count_check");
    expect(sql).toContain("resend_count >= 0 AND resend_count <= 5");
  });

  test("one live offer per address, enforced partially so a dead one can be reissued", () => {
    expect(sql).toContain("awcms_invitations_pending_key");
    expect(sql).toContain("WHERE status = 'pending'");
  });

  test("a scoped invitation policy cannot be represented", () => {
    // ADR-0080's limit, answered by refusing to be its writer. The columns
    // exist so widening is one DROP/ADD CONSTRAINT; the CHECK is what stops
    // the column lying in the meantime.
    expect(sql).toContain("awcms_invitation_policies_tenant_wide_only_check");
    expect(sql).toContain(
      "CHECK (scope_type = 'tenant' AND scope_id = tenant_id)"
    );
  });

  test("the child cascades, or the generic purge would abort on its FK", () => {
    expect(sql).toMatch(
      /REFERENCES awcms_invitations \(tenant_id, id\) ON DELETE CASCADE/
    );
  });

  test("every FK to a tenant-scoped parent is COMPOSITE", () => {
    // RI checks run as the table owner and BYPASS RLS, so a single-column
    // REFERENCES to a tenant-scoped table is a cross-tenant hole even under
    // FORCE RLS (sql/027). The only single-column references allowed here are
    // to awcms_tenants, which IS the tenant.
    const singleColumn = [...sql.matchAll(/REFERENCES (awcms_\w+) \((\w+)\)/g)];
    const offenders = singleColumn
      .filter((match) => match[1] !== "awcms_tenants")
      .map((match) => `${match[1]}(${match[2]})`);

    expect(offenders).toEqual([]);
    expect(sql).toContain("FOREIGN KEY (tenant_id, invited_by_tenant_user_id)");
    expect(sql).toContain("FOREIGN KEY (tenant_id, role_id)");
  });

  test("an accepted invitation must name the membership it produced", () => {
    expect(sql).toContain("awcms_invitations_accepted_consistency_check");
  });

  test("the worker grant is NOT here — this migration is applied and immutable", () => {
    // This assertion used to be the whole story, under a comment claiming
    // "neither the worker nor the setup wizard touches these tables". That was
    // factually wrong the day it was written: the descriptor below registers
    // this table for the GENERIC purge engine, which runs as `awcms_worker`.
    // What survives of the old test is only the narrow, true half — editing an
    // APPLIED migration to add the missing grant would block `db:migrate` on
    // every running deployment while staying green on empty CI, so the grant
    // lives in `sql/108` and is asserted there.
    expect(sql).not.toMatch(/GRANT[\s\S]*?TO awcms_(worker|setup)/);
  });

  test("the setup wizard really does touch neither table", () => {
    // The half of the old claim that was true, kept: `bootstrapPlatformTenant`
    // creates a tenant and its first owner directly, never through an
    // invitation, so `awcms_setup` holds nothing on either table.
    expect(sqlOf(WORKER_GRANT)).not.toMatch(/TO awcms_setup/);
    expect(Object.keys(SETUP_ROLE_GRANTS)).not.toContain("awcms_invitations");
    expect(Object.keys(SETUP_ROLE_GRANTS)).not.toContain(
      "awcms_invitation_policies"
    );
  });
});

describe("sql/108 — the grant the generic purge needs", () => {
  const sql = sqlOf(WORKER_GRANT);
  const descriptor = listModules()
    .find((module) => module.key === "identity_access")!
    .dataLifecycle!.find((entry) => entry.tableName === "awcms_invitations")!;

  test("the descriptor really does hand this table to the generic engine", () => {
    // The premise of everything below. If this ever becomes "delegated" the
    // grant stops being required — and the assertions after it should be
    // re-derived rather than kept passing.
    expect(descriptor.executionMode).toBe("generic");
    expect(descriptor.deletion.mode).toBe("hard_delete");
    expect(descriptor.archive.archivable).toBe(false);
  });

  test("awcms_worker is granted SELECT and DELETE on awcms_invitations", () => {
    // `archive-purge-job.ts` has NO catch block anywhere in it, so the missing
    // grant would not have under-purged this one table — the first `permission
    // denied` would have aborted the whole invocation, taking every other
    // descriptor's purge with it. SELECT because the DELETE's own subquery and
    // its `RETURNING created_at` both need it (and `planLifecycleDryRun`
    // counts rows), DELETE because the purge deletes.
    expect(sql).toContain(
      "GRANT SELECT, DELETE ON awcms_invitations TO awcms_worker;"
    );
    expect(WORKER_ROLE_GRANTS.awcms_invitations).toEqual(["SELECT", "DELETE"]);
  });

  test("the worker gets no INSERT and no UPDATE on the table", () => {
    // Issuing, resending and revoking are request-path writes on `awcms_app`.
    // A worker able to INSERT could address an offer of membership to any
    // mailbox; able to UPDATE, it could rotate `token_hash` to a value it
    // chose. Both mint a credential.
    for (const verb of ["INSERT", "UPDATE"]) {
      expect(sql).not.toContain(verb);
      expect(WORKER_ROLE_GRANTS.awcms_invitations).not.toContain(verb);
    }
  });

  test("the child table is granted nothing — the cascade needs no privilege", () => {
    // `awcms_invitation_policies` has no descriptor of its own; its rows go
    // with the parent through `ON DELETE CASCADE`, and a referential action
    // executes with the constraint owner's rights, not the deleting role's.
    expect(sql).not.toContain("awcms_invitation_policies");
    expect(Object.keys(WORKER_ROLE_GRANTS)).not.toContain(
      "awcms_invitation_policies"
    );
  });
});

describe("sql/107 — the permission seed", () => {
  const sql = sqlOf(PERMISSIONS);

  test("seeds exactly the four keys the descriptor declares", () => {
    const seeded = [
      ...sql.matchAll(/'identity_access', 'invitations', '(\w+)'/g)
    ]
      .map((match) => match[1]!)
      .sort();

    const declared = listModules()
      .find((module) => module.key === "identity_access")!
      .permissions!.filter((entry) => entry.activityCode === "invitations")
      .map((entry) => entry.action)
      .sort();

    expect(seeded).toEqual(["configure", "create", "read", "revoke"]);
    expect(declared).toEqual(seeded);
  });

  test("there is no update and no delete", () => {
    // Editing an invitation after it was sent would leave the link in
    // somebody's inbox describing something nobody reviewed; deleting one
    // destroys the only record that an offer was made.
    expect(sql).not.toContain("'invitations', 'update'");
    expect(sql).not.toContain("'invitations', 'delete'");
  });

  test("configure is seeded at PLATFORM scope, and it is the only INVITATION one", () => {
    expect(sql).toMatch(/'invitations', 'configure',[\s\S]*?'platform'/);

    // Scoped to `invitations`, not to the module. It used to read the module
    // and assert a single entry, which was true and said more than it meant:
    // ADR-0089's `partner_registry.*` is platform-scoped for reasons of its
    // own, and this test turned red on a change that has nothing to do with
    // invitations. What it is FOR is that the other three invitation
    // permissions stay tenant-scoped — a platform-scoped `create` would put
    // inviting into somebody else's company out of every tenant's reach and
    // into the platform's alone.
    const declared = listModules()
      .find((module) => module.key === "identity_access")!
      .permissions!.filter((entry) => entry.activityCode === "invitations")
      .map((entry) => `${entry.action}:${entry.scope ?? "tenant"}`)
      .sort();

    expect(declared).toEqual([
      "configure:platform",
      "create:tenant",
      "read:tenant",
      "revoke:tenant"
    ]);
  });
});

describe("src/lib/auth/invitation-token.ts", () => {
  const code = codeOf(TOKEN);

  test("32 CSPRNG bytes, base64url, sha256: prefixed hash", () => {
    expect(code).toContain('randomBytes(32).toString("base64url")');
    expect(code).toContain('`sha256:${createHash("sha256")');
  });

  test("the function names are DISTINCT from every other token pair", () => {
    // The precedent reset-token.ts wrote down: one token kind must never be
    // mistakable for another at a call site, even though the bytes match.
    expect(code).toContain("export function generateInviteToken");
    expect(code).toContain("export function hashInviteToken");
    expect(code).not.toContain("generateResetToken");
    expect(code).not.toContain("generateSessionToken");
  });

  test("no function name contains the substring password", () => {
    // CodeQL's js/insufficient-password-hash treats any function whose name
    // contains "password" as password-flavoured regardless of return type.
    const names = [...code.matchAll(/export function (\w+)/g)].map(
      (match) => match[1]!
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /password/i.test(name))).toEqual([]);
  });
});

describe("the write surface", () => {
  test("resend is guarded by create, not by an action of its own", () => {
    // Resend mints a fresh token — the authority `create` already names. A
    // separate permission would let an operator hand new credentials to
    // everyone previously invited while holding no authority to invite anyone.
    const code = codeOf(RESEND_ROUTE);
    expect(code).toContain('activityCode: "invitations"');
    expect(code).toContain('action: "create"');
    expect(code).not.toContain('action: "resend"');
  });

  test("revoke is guarded by revoke", () => {
    const code = codeOf(REVOKE_ROUTE);
    expect(code).toContain('action: "revoke"');
  });

  test("carrying roles demands access_control.assign as a SECOND guard", () => {
    // ADR-0081's split, and it matters more here: a grant carried by an
    // invitation reaches someone who does not exist yet.
    const code = codeOf(CREATE_ROUTE);
    expect(code).toContain('activityCode: "access_control"');
    expect(code).toContain('action: "assign"');
    expect(code).toMatch(
      /input\.roleIds\.length > 0[\s\S]{0,400}?ASSIGN_GUARD/
    );
  });

  test("skipEmailConfirmation demands the platform-scoped configure guard", () => {
    const code = codeOf(CREATE_ROUTE);
    expect(code).toMatch(
      /input\.skipEmailConfirmation[\s\S]{0,900}?SKIP_CONFIRMATION_GUARD/
    );
    expect(code).toContain('action: "configure"');
  });

  test("resend ROTATES the token rather than reissuing the same one", () => {
    // Without rotation, "resend" grows N live links from one invitation and
    // revoking it means revoking N secrets nobody counted.
    const code = codeOf(ADMIN);
    expect(code).toMatch(/UPDATE awcms_invitations[\s\S]{0,200}?token_hash = /);
    expect(code).toContain("resend_count = resend_count + 1");
  });

  test("the resend ceiling is enforced in the UPDATE predicate, not in JS", () => {
    // Two concurrent resends would both read the same count and both pass a
    // read-then-write check — the shape that made the login lockout counter
    // non-atomic (#483).
    const code = codeOf(ADMIN);
    expect(code).toContain("AND resend_count < ");
  });

  test("nothing in the write surface grants a role", () => {
    // An invitation is an OFFER. The grant only exists once acceptance calls
    // the shared writer, and teaching this file to write one would create the
    // second grant path ADR-0079 collapsed.
    for (const file of [ADMIN, CREATE_ROUTE, REVOKE_ROUTE, RESEND_ROUTE]) {
      const code = codeOf(file);
      expect(code).not.toContain("grantRolePolicy(");
      expect(code).not.toContain("INSERT INTO awcms_access_policies");
    }
  });

  test("identity_access never writes an email table itself", () => {
    // ADR-0013 §6 — `awcms_email_*` belongs to `email`, reached through the
    // capability port whose adapter the route injects.
    const code = codeOf(ADMIN);
    expect(code).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+awcms_email_/i
    );
    expect(code).toContain("enqueueAuthAddressNotification");
  });

  test("the listing masks the invitee's address", () => {
    const code = codeOf(ADMIN);
    expect(code).toContain("loginIdentifierMasked");
    expect(code).toMatch(/maskAddress\(row\.login_identifier\)/);
  });
});

describe("ADR-0082 exists and is the one these artifacts cite", () => {
  test("the ADR file is on disk", () => {
    expect(
      readFileSync(
        "docs/adr/0082-an-invitation-carries-its-own-policy.md",
        "utf8"
      ).length
    ).toBeGreaterThan(1000);
  });

  test("both migrations name it", () => {
    expect(read(SCHEMA)).toContain("ADR-0082");
    expect(read(PERMISSIONS)).toContain("ADR-0082");
  });
});
