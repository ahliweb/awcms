/**
 * Role membership of a dedicated-role job's database role (the #1145
 * credential-path security review, MEDIUM-2). Shared by the two dedicated
 * roles that decrypt channel credentials: `awcms_social_dispatch` and
 * `awcms_telegram_engagement_dispatch`.
 *
 * ## The gap
 *
 * Every grant check readiness made (`has_table_privilege`,
 * `has_column_privilege`) follows only INHERITED memberships. After
 * `GRANT awcms_app TO awcms_social_dispatch WITH INHERIT FALSE, SET TRUE`
 * the role's matrix still looked exact, the job's start check (session user
 * and current user are the role, not superuser, not BYPASSRLS) still passed,
 * and a single `SET LOCAL ROLE awcms_app` in the job's own session then read
 * every tenant's secrets, WhatsApp included. An inherited membership of a
 * predefined role (`pg_read_all_data`) would bypass every column grant too.
 *
 * ## The rule
 *
 * 1. The role is a member of NO role, of any kind (`pg_auth_members.member`).
 * 2. A role that is a member OF it (so may `SET ROLE` to it or inherit its
 *    privileges) is allowed only when the membership carries neither INHERIT
 *    nor SET (the ADMIN-only membership PostgreSQL 16+ grants a non-superuser
 *    CREATEROLE creator automatically), or when the member is listed in
 *    `SECURITY_READINESS_DEDICATED_ROLE_MEMBERS` (comma separated: a readiness
 *    login granted membership so the behavioural probes can run). The runtime,
 *    worker and setup roles and the other dedicated roles are refused even when
 *    listed: membership would put a second login next to the job's key ring
 *    (ADR-0157 section 6), the direction the dedicated role exists to prevent.
 *
 * Needs PostgreSQL 16+ (`inherit_option` / `set_option`); the repo runs 18.
 */

/** Roles that may never be members of a dedicated role, whatever the allow list says. */
export const NEVER_DEDICATED_ROLE_MEMBERS: readonly string[] = [
  "awcms_app",
  "awcms_worker",
  "awcms_setup",
  "awcms_social_dispatch",
  "awcms_telegram_engagement_dispatch"
];

/** `SECURITY_READINESS_DEDICATED_ROLE_MEMBERS`, parsed. */
export function allowedDedicatedRoleMembersFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return (env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

type MembershipRow = {
  direction: "member_of" | "member";
  name: string;
  inherit: boolean;
  set: boolean;
};

/** Findings (empty when the rule holds) for `role`. A missing role yields none: its own check reports that. */
export async function findDedicatedRoleMembershipFindings(
  sql: Bun.SQL,
  role: string,
  allowedMembers: readonly string[] = allowedDedicatedRoleMembersFromEnv()
): Promise<string[]> {
  const rows = (await sql`
    SELECT 'member_of' AS direction, pg_get_userbyid(m.roleid)::text AS name,
           m.inherit_option AS inherit, m.set_option AS set
    FROM pg_auth_members m
    WHERE m.member = to_regrole(${role})
    UNION ALL
    SELECT 'member' AS direction, pg_get_userbyid(m.member)::text AS name,
           m.inherit_option AS inherit, m.set_option AS set
    FROM pg_auth_members m
    WHERE m.roleid = to_regrole(${role})
    ORDER BY 1, 2
  `) as MembershipRow[];

  return evaluateDedicatedRoleMemberships(role, rows, allowedMembers);
}

/** The pure half, for unit tests. */
export function evaluateDedicatedRoleMemberships(
  role: string,
  rows: readonly MembershipRow[],
  allowedMembers: readonly string[]
): string[] {
  const findings: string[] = [];

  for (const row of rows) {
    if (row.direction === "member_of") {
      findings.push(
        `${role} is a member of ${row.name}${row.set ? " (it can SET ROLE to it)" : ""}${row.inherit ? " (it inherits its privileges)" : ""}: a dedicated role must be a member of no role, or one statement in the job's own session escapes every pinned grant and policy`
      );
      continue;
    }

    if (!row.inherit && !row.set) continue;

    if (
      allowedMembers.includes(row.name) &&
      !NEVER_DEDICATED_ROLE_MEMBERS.includes(row.name)
    ) {
      continue;
    }

    findings.push(
      `${row.name} is a member of ${role} with ${[row.set ? "SET" : null, row.inherit ? "INHERIT" : null].filter(Boolean).join(" and ")}${NEVER_DEDICATED_ROLE_MEMBERS.includes(row.name) ? " (never allowed: it would hold the role's credential view next to its own login)" : " and is not listed in SECURITY_READINESS_DEDICATED_ROLE_MEMBERS"}`
    );
  }

  return findings;
}
