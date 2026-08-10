/**
 * access-grant-readers-check.ts — `bun run access:grant-readers:check`.
 *
 * Every file that reads a GRANT table by name is on the list below, with the
 * reason it is there. Anything else naming one fails the gate. Pure: source text
 * only, no database, no network.
 *
 * ## What this protects, and why it lands BEFORE the thing it protects
 *
 * Today a grant is `(tenant_user, role)` and answers one question: does this
 * person hold this role, anywhere in the tenant. Gelombang 3 of the membership
 * program (#423) makes a grant carry its own SCOPE, so the same join stops
 * meaning "may act" and starts meaning "may act SOMEWHERE" — and every reader
 * that assembled its own join keeps the old, wider answer while looking
 * untouched. That is not a hypothetical failure mode: it is the same shape as
 * PROJECT_STATE §4 R3, where 31 admin screens decided from raw RBAC and every
 * one of them read as correct.
 *
 * The gate is GREEN today and changes no behaviour. That is the point, and it is
 * why it lands before `awcms_access_policies` rather than beside it: a gate that
 * must be green today is cheapest to add today, and a list written after the
 * risky change is a list written by someone who already has a reason to keep it
 * short. `access:decision-log:coverage:check` (Issue #426) landed on exactly the
 * same argument, one wave earlier.
 *
 * ## Why a file list rather than a call-graph rule
 *
 * The honest signal is "this file names the table". A rule about which module
 * may IMPORT which would miss all of it — every one of these files reaches the
 * table through a SQL template literal, not an import, so the module DAG has
 * nothing to say about them and `modules:table-writes:check` only governs
 * writes. Three of the eleven entries below are outside `identity_access`
 * entirely, and none of them violates a single existing gate.
 *
 * ## Deny-only
 *
 * Nothing here can make an access decision, permit a read, or widen anything.
 * It fails a build or it says nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { stripComments } from "./access-chokepoint-check";

/**
 * The tables that answer "what has been granted to whom".
 *
 * `awcms_permissions` is deliberately absent: it is the global catalogue of what
 * a permission IS, carries no grant, and is read by seed migrations and admin
 * pickers that have no business being on this list. `awcms_roles` is absent for
 * the same reason — a role is a container, not a grant.
 *
 * `awcms_access_policies` (ADR-0078) joined the list in the migration that
 * created it — the moment this file said it should. Every name below is
 * therefore already accountable for the scoped shape before a single scoped
 * grant exists to read.
 */
export const GRANT_TABLES: readonly string[] = [
  "awcms_access_assignments",
  "awcms_access_policies",
  "awcms_role_permissions",
  // ADR-0081 — a group holds grants, so membership is now part of the answer to
  // "what has been granted to whom". A file that changes who is in a group is
  // changing authorization, and it belongs on this list for the same reason the
  // policy table does.
  "awcms_user_groups",
  "awcms_user_group_members"
];

/**
 * Grant tables that `sql/103` turned into read-only history (ADR-0079).
 *
 * `awcms_access_assignments` stays in `GRANT_TABLES` above rather than being
 * deleted from it, and that is the entire protection: no file may name it, so a
 * reader that drifts back onto it — the failure ADR-0079 exists to record, which
 * happened to FIVE files at once and was invisible in every one of them — fails
 * this gate instead of silently answering about rows no writer can add to.
 *
 * Listed here only so the message can say WHY rather than "not a recorded
 * reader", which would send the next person to add an allow-list entry.
 */
export const RETIRED_GRANT_TABLES: readonly string[] = [
  "awcms_access_assignments"
];

export type GrantReaderEntry = {
  /** Repo-relative path, forward slashes. */
  file: string;
  /** Why this file is allowed to name a grant table. */
  reason: string;
};

/**
 * The eleven files that may name a grant table.
 *
 * It was eleven. Three left in ADR-0079 — not because their reads went away but
 * because they stopped writing their own join and now embed `activeRoleGrants`,
 * which is the outcome this list is supposed to drive. Shrinking is the healthy
 * direction; a file that leaves has one fewer way to be wrong.
 *
 * Being on this list is NOT an endorsement. The last two entries are outside
 * `identity_access` and each says what would go wrong if the grant shape changed
 * while it kept its own join — written down so the next person changing that
 * shape has the list in front of them instead of a grep they might narrow.
 */
export const GRANT_READERS: readonly GrantReaderEntry[] = [
  {
    file: "src/modules/identity-access/application/grant-source.ts",
    reason:
      "THE definition, since ADR-0079. `activeRoleGrants` emits the 'which grants are in force' join once and every reader embeds it as a subquery — which is why eight of the entries that used to be on this list are not any more."
  },
  {
    file: "src/modules/identity-access/application/auth-context.ts",
    reason:
      "THE reader. `fetchGrantedPermissionKeys` is what every guard goes through, and `access:chokepoint:check` keys its signal on that function name. Names `awcms_role_permissions` only — the grant side comes from `activeRoleGrants`."
  },
  {
    file: "src/modules/identity-access/application/business-scope-facts.ts",
    reason:
      "The two SoD assignment resolvers. They must not lose precision when the grant shape changes — that is what `access:sod-fact-parity:check` will pin once groups can grant roles too. ADR-0079 is what happens when they do lose it: the ordinary-RBAC resolver kept reading the abandoned table and SoD went blind to every grant written after PR 3.2."
  },
  {
    file: "src/modules/identity-access/application/user-admin.ts",
    reason:
      "The assign/unassign writer for BOTH subjects since ADR-0081. It names `awcms_user_groups` for one thing only — the existence check that refuses to grant a role to a group that does not live in this tenant — and it is exactly the check whose absence would let a composite-FK violation decide the answer instead of a 404."
  },
  {
    file: "src/modules/identity-access/application/user-group-admin.ts",
    reason:
      "THE group surface, since ADR-0081. It writes membership — which confers every role the group holds — and reads `awcms_access_policies` for the ROLE COUNT its screen shows, because a group holding grants nobody can see by looking at the people is the thing this screen exists to make visible. It never writes a grant: that stays on `access_control.assign`."
  },
  {
    file: "src/modules/identity-access/application/access-directory.ts",
    reason:
      "The admin read model behind /admin/users and /admin/roles — 'who holds what', a listing rather than a decision."
  },
  {
    file: "src/modules/identity-access/application/role-admin.ts",
    reason:
      "The role-to-permission writer for `awcms_role_permissions` — the surface where an admin deliberately narrows a role, which is why the backfill may only re-grant catalogue rows newer than the role itself."
  },
  {
    file: "src/modules/identity-access/application/access-policy-writer.ts",
    reason:
      "THE writer, since ADR-0078. Every path that used to INSERT a grant calls `grantRolePolicy`, and removal goes through `revokeRoleGrants`. It no longer touches the legacy table: `sql/103` made that table history, and a DELETE against it would now fail the whole revocation with 42501."
  },
  {
    file: "src/modules/identity-access/application/owner-permission-backfill-job.ts",
    reason:
      "The backfill writer. Grants only catalogue rows NEWER than the role, so it cannot resurrect a deliberate removal (`owner-permission-backfill.ts`)."
  },
  {
    file: "src/modules/tenant-admin/application/platform-bootstrap.ts",
    reason:
      "OUTSIDE identity_access. It seeds a brand-new tenant's owner role and its grant, before `identity_access` has any surface to do it through — a bootstrap-ordering fact, recorded rather than excused. The seeded grant names its scope explicitly (tenant-wide) rather than inheriting that by default, and `awcms_setup` holds exactly the privileges those two INSERTs need (`sql/103`)."
  },
  {
    file: "src/pages/api/v1/access/policies/simulate.ts",
    reason:
      "OUTSIDE identity_access, and a ROUTE. Its grant set comes from `fetchGrantedPermissionKeys` and `activeRoleGrants`, so the simulator and the real path can no longer disagree; it stays listed because it still names `awcms_role_permissions` to expand the hypothetical-roles branch, which has no subject and therefore no grant to read."
  }
];

const SOURCE_ROOT = "src";
const SOURCE_EXTENSIONS = [".ts", ".astro"];

function collectSourceFiles(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, into);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      into.push(path);
    }
  }
}

export type GrantReaderProblem = { file: string; message: string };

/**
 * `sources` maps repo-relative path -> file text.
 *
 * Comments are stripped before matching, and it is load-bearing rather than
 * tidy: three files in this repo discuss these tables in a docblock and touch
 * neither. `access-chokepoint-check.ts` records why the fix is always what
 * plants the false positive — a fix explains what it removed.
 */
export function findGrantReaderProblems(
  sources: ReadonlyMap<string, string>,
  allowed: readonly GrantReaderEntry[] = GRANT_READERS,
  tables: readonly string[] = GRANT_TABLES
): GrantReaderProblem[] {
  const allowedFiles = new Set(allowed.map((entry) => entry.file));
  const problems: GrantReaderProblem[] = [];
  const seen = new Set<string>();

  for (const [file, source] of sources) {
    const code = stripComments(source);
    const named = tables.filter((table) => code.includes(table));

    if (named.length === 0) continue;

    seen.add(file);

    if (allowedFiles.has(file)) continue;

    const retired = named.filter((table) =>
      RETIRED_GRANT_TABLES.includes(table)
    );

    problems.push({
      file,
      message:
        retired.length > 0
          ? `names RETIRED grant table(s) ${retired.join(", ")}. Those rows are read-only history (ADR-0079, sql/103): nothing writes them, revocation cannot remove them, and a reader consulting them reports access that no admin can take away. Read live grants through activeRoleGrants (identity-access/application/grant-source.ts).`
          : `names grant table(s) ${named.join(", ")} but is not a recorded grant reader. Call fetchGrantedPermissionKeys (or the identity_access application function that owns this read) instead — or add an entry to GRANT_READERS in scripts/access-grant-readers-check.ts saying why this file assembles its own join.`
    });
  }

  for (const entry of allowed) {
    if (seen.has(entry.file)) continue;

    problems.push({
      file: entry.file,
      message:
        "stale entry: this file no longer names a grant table (or no longer exists). Remove it from GRANT_READERS — an allow-list entry that outlives its reason is how the list stops describing the repo."
    });
  }

  return problems;
}

function main(): void {
  const files: string[] = [];
  collectSourceFiles(SOURCE_ROOT, files);

  const sources = new Map(
    files.map((file) => [file, readFileSync(file, "utf8")])
  );
  const problems = findGrantReaderProblems(sources);

  if (problems.length === 0) {
    console.log(
      `access:grant-readers:check OK — ${GRANT_READERS.length} recorded reader(s) of ${GRANT_TABLES.length} grant table(s); no file assembles its own grant join unrecorded.`
    );
    return;
  }

  console.error(
    `access:grant-readers:check GAGAL — ${problems.length} temuan.`
  );

  for (const problem of problems) {
    console.error(`  ${problem.file} — ${problem.message}`);
  }

  process.exit(1);
}

if (import.meta.main) {
  main();
}
