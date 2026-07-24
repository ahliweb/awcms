/**
 * security-readiness.ts — `bun run security:readiness`.
 *
 * Issue #142. Ported from awcms-mini's own `scripts/security-readiness.ts`
 * and adapted to THIS repo's real surface (no tax/CRM/AI/POS/analytics/social
 * modules here, no `docker-compose.yml`, no per-area `checkXxxConfig`
 * exports in `scripts/validate-env.ts`). Runs a fixed list of named security
 * checks against the REAL codebase/database/environment — every check below
 * is backed by a real signal (a DB query, a grep over tracked source files,
 * a call into a real domain function, or an env var read). None of them are
 * hardcoded to "pass".
 *
 * ## Why this script exists (the bug it is built to catch)
 *
 * Migrations 002-008 and 010-012 shipped 23 tenant-scoped tables with only
 * `ENABLE ROW LEVEL SECURITY` and never `FORCE` — PostgreSQL lets a table's
 * OWNER bypass RLS unless `FORCE` is set, and this app connects as the
 * migration owner. So `awcms_*_tenant_isolation` policies were never
 * evaluated: RLS was inert for two years' worth of migrations and NOT ONE
 * check caught it (found by manual audit, fixed by `sql/017`). The
 * `"RLS enabled AND forced on tenant-scoped tables"` check below exists
 * precisely so that class of regression fails loudly the next time: it
 * requires `relforcerowsecurity`, not just `relrowsecurity`. Its companion
 * `"App DB connection role does not bypass RLS"` closes the other half —
 * `FORCE` still does nothing against a SUPERUSER/BYPASSRLS connection role.
 *
 * ## Gate rule
 *
 * Any `critical` check with `status: "fail"` blocks go-live (non-zero exit
 * code). `warning`/`info` findings are printed but never block.
 *
 * ## Not part of `bun run check`
 *
 * Deliberately: the DB-backed checks need a real, migrated database, and
 * `.github/workflows/ci.yml` has no Postgres service. This is an operator/
 * go-live command (run it with the APP's `DATABASE_URL`, not a privileged
 * migration/superuser URL — see `checkAppDbUserNotSuperuser`), and it is
 * wired into the `logging` module's job descriptor list, not into the
 * per-commit lint gate. `OUT_OF_SCOPE_ITEMS` below records the checklist
 * items that genuinely cannot be automated from this repo alone, with a
 * reason each — never silently dropped.
 */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { getDatabaseClient } from "../src/lib/database/client";
import { hashPassword } from "../src/lib/auth/password";
import { listModules } from "../src/modules";
import {
  evaluateAccess,
  isHighRiskAction
} from "../src/modules/identity-access/domain/access-control";
import {
  formatLifecycleRegistryIssue,
  validateLifecycleRegistry
} from "../src/modules/data-lifecycle/domain/lifecycle-registry";
import { DATA_LIFECYCLE_PERMISSIONS } from "../src/modules/data-lifecycle/domain/data-lifecycle-permissions";
import { evaluateLoginAttempt } from "../src/modules/identity-access/domain/login-policy";
import { checkRateLimit } from "../src/lib/security/rate-limit";
import { buildSecurityHeaders } from "../src/lib/security/security-headers";
import {
  isTurnstileEnabled,
  TURNSTILE_REQUIRED_WHEN_ENABLED
} from "../src/lib/security/turnstile";
import {
  isFullOnlineSecurityActive,
  isOnlineSecurityEnabled,
  resolveOnlineSecurityProfile
} from "../src/lib/auth/online-security-config";
import { validateEnv } from "./validate-env";

export type CheckSeverity = "critical" | "warning" | "info";
export type CheckStatus = "pass" | "fail";

export type SecurityCheckResult = {
  name: string;
  severity: CheckSeverity;
  status: CheckStatus;
  evidence: string;
};

export type OutOfScopeItem = {
  name: string;
  reason: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// 1. No hardcoded secret (critical)
// ---------------------------------------------------------------------------

/**
 * Heuristic, not a full secret-scanner. It flags lines that look like
 * `<name containing password/secret/apiKey/token> = "<literal>"` (or the
 * object-literal form `name: "<literal>"`), where:
 *
 * - the line does NOT mention `process.env` (a fallback like
 *   `token: process.env.TOKEN ?? "..."` reads from env, not hardcoded);
 * - the assignment is not a member-expression write like `url.password =
 *   "****"` (excluded by requiring the char before the name not be `.`) —
 *   `scripts/db-migrate.ts` masks a URL password with the literal `"****"`,
 *   which is a redaction placeholder, not a secret;
 * - the literal isn't an obvious placeholder (`change-me`, `xxx`, `***`,
 *   `...`, `redacted`, `todo`) or an i18n/error-code lookup key.
 *
 * Known limitations (documented, not silently hidden):
 * - Cannot see through string concatenation/template interpolation.
 * - A variable whose name merely contains one of the four keywords (e.g. a
 *   `tokenType = "Bearer"` constant) would false-positive. No such case
 *   exists in this repo today (verified by running this script).
 * - Only scans `src/`, `scripts/`, and root config files. `tests/` is
 *   excluded so test fixtures never count as findings.
 */
const HARDCODED_SECRET_PATTERN =
  /(^|[^.\w])([A-Za-z0-9_$]*(?:password|secret|api[_-]?key|token)[A-Za-z0-9_$]*)\s*(?<![=!<>])[:=](?!=)\s*["'`]([^"'`]{3,})["'`]/i;

const PLACEHOLDER_VALUE_PATTERN = /^(\*+|x+|change-?me|redacted|todo|\.{3})$/i;

/**
 * An i18n/error-code lookup key (e.g. `"error.token_expired"`) — a lowercase
 * dot-namespaced identifier with no entropy. Real secrets are never valid
 * instances of this shape: they are read from `process.env` (already
 * excluded above) or are high-entropy opaque strings.
 */
const I18N_KEY_LIKE_VALUE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/**
 * A constant holding the NAME of an env var, not a secret — e.g.
 * `const IP_HASH_SECRET_ENV = "AUTH_IP_HASH_SECRET";`
 * (`src/lib/security/client-fingerprint.ts`). Found live by running this
 * script against this repo on the very first run: the variable name contains
 * "SECRET" (matching `HARDCODED_SECRET_PATTERN`'s name group) but the value
 * is the identifier the code later looks up in `process.env` — the line
 * itself never mentions `process.env`, so the existing exclusion misses it.
 * Without this, `bun run security:readiness` reports a false `critical` on
 * unmodified, already-merged, genuinely-secure code and blocks go-live for
 * no reason — the exact way a gate teaches people to ignore it.
 *
 * Deliberately narrow: BOTH the variable name must end in `_ENV` AND the
 * value must be SCREAMING_SNAKE_CASE with at least one underscore (the shape
 * of an env var name). A real leaked credential (`API_SECRET =
 * "AKIAIOSFODNN7EXAMPLE"`) satisfies neither and still fires.
 */
const ENV_VAR_NAME_HOLDER_NAME_PATTERN = /_ENV$/;
const ENV_VAR_NAME_LIKE_VALUE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

const SECRET_SCAN_PATHSPECS = [
  "src/**/*.ts",
  "src/**/*.astro",
  "src/**/*.mjs",
  "scripts/**/*.ts",
  "scripts/**/*.mjs",
  "astro.config.mjs",
  "package.json"
];

// This script's own file is excluded: it legitimately declares constants
// whose *names* contain "secret" (the sync placeholder below) while holding
// known-safe placeholder strings. A secret scanner should not flag itself.
const SECRET_SCAN_SELF_EXCLUDE = "scripts/security-readiness.ts";

export function scanLineForHardcodedSecret(line: string): string | null {
  if (line.includes("process.env")) {
    return null;
  }

  const match = HARDCODED_SECRET_PATTERN.exec(line);

  if (!match) {
    return null;
  }

  const name = match[2];
  const value = match[3];

  if (
    !name ||
    !value ||
    PLACEHOLDER_VALUE_PATTERN.test(value) ||
    I18N_KEY_LIKE_VALUE_PATTERN.test(value) ||
    (ENV_VAR_NAME_HOLDER_NAME_PATTERN.test(name) &&
      ENV_VAR_NAME_LIKE_VALUE_PATTERN.test(value))
  ) {
    return null;
  }

  return name;
}

export async function checkNoHardcodedSecret(
  rootDir = process.cwd()
): Promise<SecurityCheckResult> {
  const name = "No hardcoded secret";
  const severity: CheckSeverity = "critical";

  try {
    const trackedOutput = execFileSync(
      "git",
      ["ls-files", ...SECRET_SCAN_PATHSPECS],
      { cwd: rootDir, encoding: "utf8" }
    );
    const trackedFiles = trackedOutput
      .split("\n")
      .filter(Boolean)
      .filter((file) => file !== SECRET_SCAN_SELF_EXCLUDE);

    const findings: string[] = [];

    for (const file of trackedFiles) {
      const content = await readFile(path.join(rootDir, file), "utf8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const hit = scanLineForHardcodedSecret(line);

        if (hit) {
          findings.push(`${file}:${index + 1} (variable "${hit}")`);
        }
      });
    }

    if (findings.length > 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `Suspicious literal assigned to a secret-like variable: ${findings.join("; ")}.`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence: `Scanned ${trackedFiles.length} tracked file(s) under src/, scripts/, and config — no literal secret-like assignment found (heuristic regex, see source comment for limits).`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not run the secret scan: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 2. .env not tracked by git (critical)
// ---------------------------------------------------------------------------

export function checkEnvNotTracked(
  rootDir = process.cwd()
): SecurityCheckResult {
  const name = ".env not tracked by git";
  const severity: CheckSeverity = "critical";

  try {
    const output = execFileSync("git", ["ls-files"], {
      cwd: rootDir,
      encoding: "utf8"
    });
    const trackedEnvFiles = output
      .split("\n")
      .filter(Boolean)
      .filter((file) => file === ".env" || file.endsWith("/.env"));

    if (trackedEnvFiles.length > 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `.env file(s) are tracked by git: ${trackedEnvFiles.join(", ")}.`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence:
        "git ls-files does not include any .env file (only .env.example is tracked)."
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not run "git ls-files": ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 3. Password hashing is modern (argon2id) (critical)
// ---------------------------------------------------------------------------

/**
 * Deliberately does NOT grep `src/lib/auth/password.ts` for the literal
 * `"argon2id"` — that string does not appear there. `hashPassword` calls
 * `Bun.password.hash(password)` with no explicit algorithm, relying on Bun's
 * documented `argon2id` default. A literal grep would report a false "fail"
 * against secure, working code. This calls the real function and inspects
 * the hash it actually produces — a stronger signal, and immune to Bun
 * changing its default (which grepping would also miss).
 */
export async function checkPasswordHashingModern(): Promise<SecurityCheckResult> {
  const name = "Password hashing is modern (argon2id)";
  const severity: CheckSeverity = "critical";

  try {
    const hash = await hashPassword("security-readiness-synthetic-check");

    if (hash.startsWith("$argon2id$")) {
      return {
        name,
        severity,
        status: "pass",
        evidence:
          "hashPassword() produced a $argon2id$ hash (Bun.password.hash's documented default algorithm)."
      };
    }

    return {
      name,
      severity,
      status: "fail",
      evidence: `hashPassword() produced a hash that is not argon2id: "${hash.slice(0, 16)}...".`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not call hashPassword(): ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Login lockout is implemented (critical)
// ---------------------------------------------------------------------------

export function checkLoginLockoutImplemented(): SecurityCheckResult {
  const name = "Login lockout is implemented";
  const severity: CheckSeverity = "critical";
  const now = new Date("2026-01-01T00:00:00.000Z");
  const maxFailedAttempts = 5;

  // Synthetic "5th consecutive failed attempt": identity already has 4
  // recorded failures; one more invalid password attempt should push the
  // count to 5 (== maxFailedAttempts) and trigger a lockout.
  const result = evaluateLoginAttempt({
    now,
    tenantStatus: "active",
    identity: { status: "active", failedLoginCount: 4, lockedUntil: null },
    tenantUserStatus: "active",
    passwordMatches: false,
    maxFailedAttempts,
    lockoutMinutes: 15
  });

  const lockedOut =
    result.outcome === "deny" &&
    result.failedLoginCount === maxFailedAttempts &&
    result.lockedUntil instanceof Date;

  if (lockedOut) {
    return {
      name,
      severity,
      status: "pass",
      evidence:
        'evaluateLoginAttempt() with 5 consecutive failed attempts (maxFailedAttempts=5) returns outcome="deny" with a lockedUntil timestamp.'
    };
  }

  return {
    name,
    severity,
    status: "fail",
    evidence: `evaluateLoginAttempt() did not lock out at the configured threshold; result=${JSON.stringify(result)}.`
  };
}

// ---------------------------------------------------------------------------
// 5. RLS enabled AND forced on tenant-scoped tables (critical) — Issue #142
// ---------------------------------------------------------------------------

/**
 * Single source of truth for every GLOBAL, RLS-free table. Maps each table's
 * name to the privileges `awcms_app` must NOT hold on it at runtime — and, by
 * its KEYS, defines the set of `awcms_%` tables that are intentionally RLS-free
 * because they are not tenant-scoped (no per-tenant row ownership). Derived by
 * reading `sql/*.sql` directly, not guessed: these are exactly the `awcms_%`
 * tables that are `CREATE TABLE`d but never `ENABLE ROW LEVEL SECURITY`d.
 *
 * - `awcms_schema_migrations` (sql/001) — migration bookkeeping ledger.
 * - `awcms_modules` (sql/008) — global module registry, no `tenant_id`.
 * - `awcms_module_dependencies`, `awcms_module_navigation`,
 *   `awcms_module_jobs`, `awcms_module_health_checks` (sql/008) —
 *   code-derived module registry metadata (dependency graph, admin nav,
 *   job/command catalog, instance-level health check history), synced from
 *   trusted per-module descriptors (each module's own `module.ts`), never
 *   tenant-writable.
 * - `awcms_tenants` (sql/002) — the tenant table itself; each row IS a
 *   tenant, it does not belong to one. `sql/017`'s header and
 *   `src/lib/jobs/batching.ts` both rely on this being RLS-free.
 * - `awcms_permissions` (sql/005) — global `module.activity.action`
 *   permission catalog, shared by every tenant.
 * - `awcms_setup_state` (sql/006) — global singleton setup lock that exists
 *   before any tenant does.
 *
 * ## Why ONE map, not two lists (Issue #162 / L2)
 *
 * This used to be two independent structures: an `RLS_FREE_TABLES` set (read by
 * `checkRlsEnabled`) plus a separate forbidden-privilege map (read by
 * `checkRuntimeRoleGrants`). The auditor of PR #161 flagged the "one-list
 * omission" gap: a future global RLS-free table added to the SET (to satisfy
 * `checkRlsEnabled`) but forgotten in the forbidden-privilege MAP was
 * `continue`d as "full DML kept by design" and passed silently — the exact "a
 * new global table inherits blanket DML from `ALTER DEFAULT PRIVILEGES`"
 * regression this whole check exists to catch. Merging them means you cannot
 * register a table in one place without the other: adding a key here FORCES an
 * explicit privilege declaration for it, and `checkRuntimeRoleGrants` fails
 * closed ("assert zero write") on any RLS-free table still missing one.
 *
 * The value is the list of privileges FORBIDDEN for `awcms_app`:
 * - `[]` — full DML legitimately kept. The five module-registry tables are
 *   written at request time by `descriptor-sync.ts`/`health-registry.ts` (see
 *   `sql/021`'s header). A DELIBERATE, explicit "allow" a reviewer can see and
 *   challenge — not an implicit default.
 * - `["INSERT", "UPDATE", "DELETE"]` — read-only at runtime, every write
 *   forbidden: `awcms_permissions` (global permission catalog, never written by
 *   the app) and `awcms_schema_migrations` (migration ledger, only `db:migrate`
 *   as owner writes it).
 * - `["DELETE"]` — keep SELECT/INSERT/UPDATE, forbid DELETE only:
 *   `awcms_tenants` (tenant-settings write path + setup-fallback bootstrap) and
 *   `awcms_setup_state` (setup-fallback singleton).
 *
 * Anything NOT keyed here that matches `awcms_%` is treated as tenant-scoped and
 * MUST have both `relrowsecurity` and `relforcerowsecurity` (`checkRlsEnabled`)
 * AND all four grants (`checkRuntimeRoleGrants`). That default-deny direction is
 * the point: a new migration adding a tenant table needs no registration to be
 * protected; a new genuinely-global table is the one case that requires a
 * deliberate edit here, with a reason — the correct place to force that
 * conversation.
 */
const GLOBAL_TABLE_FORBIDDEN_PRIVILEGES: Record<string, string[]> = {
  // Module registry (sql/008) — global, code-derived, full DML kept by design.
  awcms_modules: [],
  awcms_module_dependencies: [],
  awcms_module_navigation: [],
  awcms_module_jobs: [],
  awcms_module_health_checks: [],
  // Read-only at runtime — every write forbidden.
  awcms_permissions: ["INSERT", "UPDATE", "DELETE"],
  awcms_schema_migrations: ["INSERT", "UPDATE", "DELETE"],
  // Write-limited — only DELETE forbidden.
  awcms_tenants: ["DELETE"],
  awcms_setup_state: ["DELETE"]
};

/**
 * The set of intentionally RLS-free tables, DERIVED from the single source of
 * truth above so the two can never diverge (see that comment for the L2 gap
 * this closes). Read by `checkRlsEnabled` to know which `awcms_%` tables are
 * exempt from the RLS-forced requirement.
 */
const RLS_FREE_TABLES = new Set(Object.keys(GLOBAL_TABLE_FORBIDDEN_PRIVILEGES));

type RlsRow = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

/**
 * THE check this issue exists for. `relrowsecurity` alone (what migrations
 * 002-008/010-012 set) is NOT enforcement: PostgreSQL exempts a table's
 * owner from RLS unless `relforcerowsecurity` is also set, and this app
 * connects as the migration owner by default. Requiring BOTH flags is the
 * difference between a policy that runs and a policy that is decorative.
 *
 * `relkind IN ('r', 'p')` — ordinary AND partitioned tables. There is no
 * partitioned table in this repo today; including `'p'` costs nothing and
 * means a future partitioned high-volume log table (an obvious candidate:
 * `awcms_abac_decision_logs`) cannot slip past this check by being a
 * different relkind. Note that RLS flags on a partitioned parent are what
 * matter — Postgres applies the parent's policies to partition access.
 */
export async function checkRlsEnabled(): Promise<SecurityCheckResult> {
  const name = "RLS enabled AND forced on tenant-scoped tables";
  const severity: CheckSeverity = "critical";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();
    const rows = (await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname LIKE 'awcms\\_%' AND c.relkind IN ('r', 'p')
        AND n.nspname = current_schema()
      ORDER BY c.relname
    `) as RlsRow[];

    if (rows.length === 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence:
          "No awcms_% tables found in pg_class — has `bun run db:migrate` been run against this database?"
      };
    }

    const tenantScoped = rows.filter(
      (row) => !RLS_FREE_TABLES.has(row.relname)
    );
    const notEnforced = tenantScoped.filter(
      (row) => !row.relrowsecurity || !row.relforcerowsecurity
    );
    const excludedFound = [...RLS_FREE_TABLES].filter((table) =>
      rows.some((row) => row.relname === table)
    );

    if (notEnforced.length > 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `Tenant-scoped table(s) not fully enforced (need relrowsecurity AND relforcerowsecurity — ENABLE without FORCE leaves RLS inert for the table owner, see sql/017): ${notEnforced
          .map(
            (row) =>
              `${row.relname}(rls=${row.relrowsecurity},force=${row.relforcerowsecurity})`
          )
          .join(", ")}.`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence: `${tenantScoped.length} tenant-scoped table(s) all have relrowsecurity=true AND relforcerowsecurity=true. Excluded as documented RLS-free (non-tenant-scoped): ${excludedFound.join(", ")}.`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not connect to the database to verify RLS: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 6. App DB connection role does not bypass RLS (critical) — Issue #142
// ---------------------------------------------------------------------------

/**
 * The other half of the RLS gate. `FORCE ROW LEVEL SECURITY` still does not
 * apply to a SUPERUSER or a role with BYPASSRLS — so if the app's own
 * connection role is either, every policy on every table is skipped and
 * `checkRlsEnabled` passing above means nothing. This inspects the role of
 * the CURRENT connection (`DATABASE_URL`), which is the app's real posture:
 * run `security:readiness` with the app's `DATABASE_URL`, not a privileged
 * migration/superuser URL, or the result is meaningless.
 */
export async function checkAppDbUserNotSuperuser(): Promise<SecurityCheckResult> {
  const name = "App DB connection role does not bypass RLS";
  const severity: CheckSeverity = "critical";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();
    const rows = (await sql`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[];
    const role = rows[0];

    if (!role) {
      return {
        name,
        severity,
        status: "fail",
        evidence: "Could not resolve the current connection role."
      };
    }

    if (role.rolsuper || role.rolbypassrls) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `The app connects as "${role.rolname}" which is ${role.rolsuper ? "a SUPERUSER" : "BYPASSRLS"} — it bypasses RLS entirely regardless of FORCE, so tenant isolation is not enforced at the database. Connect as a least-privilege role instead (see the least-privilege role work tracked by Issue #141).`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence: `The app connects as "${role.rolname}" (rolsuper=false, rolbypassrls=false) — RLS policies are enforced for this role.`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not verify the connection role: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 7. Dedicated least-privilege runtime role (warning) — Issue #141 in flight
// ---------------------------------------------------------------------------

const LEAST_PRIVILEGE_APP_ROLE = "awcms_app";

/**
 * `warning`, not `critical`, ON PURPOSE — and this severity is expected to
 * be revisited exactly once.
 *
 * `sql/017`'s header states the split: closing the table-owner bypass was
 * part 1; a least-privilege `awcms_app` role is part 2, deferred because
 * introducing a role is a deployment-affecting change. Issue #141 adds that
 * role (`sql/019_awcms_db_role_separation.sql`, `CREATE ROLE awcms_app
 * NOLOGIN` + grants). This check works either side of that line by design:
 * a database migrated BEFORE 019 legitimately has no such role, and failing
 * `critical` there would block go-live for a state that is merely
 * un-migrated rather than insecure — the gate would be crying wolf, which is
 * how gates get ignored or disabled. What it buys meanwhile: the gap is
 * reported loudly and by name instead of being invisible, which was the
 * whole complaint behind #142.
 *
 * Promote to `critical` once 019 has landed AND deployments have been
 * migrated onto it.
 *
 * Note this check is about the role EXISTING in the cluster, which is a
 * weaker statement than "the app actually connects as it" — that stronger
 * property is what `checkAppDbUserNotSuperuser` above already verifies
 * independently, and it is `critical` today.
 */
export async function checkLeastPrivilegeRoleProvisioned(): Promise<SecurityCheckResult> {
  const name = "Dedicated least-privilege app DB role is provisioned";
  const severity: CheckSeverity = "warning";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();
    const rows = (await sql`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles WHERE rolname = ${LEAST_PRIVILEGE_APP_ROLE}
    `) as {
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }[];
    const role = rows[0];

    if (!role) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" does not exist in this cluster. Expected until Issue #141 (least-privilege DB role) has landed AND this database has been migrated — reported, not blocking. Today the app connects as the migration owner, so tenant isolation rests on FORCE RLS (sql/017) alone, with no defense left if a future change adds BYPASSRLS/SUPERUSER to that owner.`
      };
    }

    if (role.rolsuper || role.rolbypassrls) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" exists but is ${role.rolsuper ? "a SUPERUSER" : "BYPASSRLS"} — it is not least-privilege and would bypass every RLS policy.`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" exists (rolsuper=false, rolbypassrls=false, rolcanlogin=${role.rolcanlogin}). Whether the app actually CONNECTS as it is verified separately by "App DB connection role does not bypass RLS".`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not verify the least-privilege role: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 7b. Runtime role table grants match least-privilege matrix (critical) —
//     Issue #160
// ---------------------------------------------------------------------------

/**
 * The three write privileges. A GLOBAL, RLS-free table that is registered as
 * RLS-free (in `RLS_FREE_TABLES`) but has NO entry in
 * `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` is asserted fail-closed against this list
 * — "zero write allowed" — so a forgotten registration FAILS the check instead
 * of silently keeping blanket DML (Issue #162 / L2). In practice the two are
 * derived from one map so this cannot happen in shipped code; the fail-closed
 * default is the belt-and-suspenders guard against any future re-split.
 */
const ALL_WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE"];

/**
 * Privileges every TENANT-SCOPED table must grant `awcms_app`. `sql/019` grants
 * all four blanket + an `ALTER DEFAULT PRIVILEGES` that re-grants all four on
 * future tables. Requiring all four here is the exact mirror of that — and it
 * catches the failure mode `checkRlsEnabled` structurally cannot: a table
 * created by a DIFFERENT owner than the one the default privileges are bound to
 * ends up RLS-forced (so the RLS check passes) but UNGRANTED, which is
 * `permission denied` at runtime, not "no data". The reviewer of #159 flagged
 * exactly this (`ALTER DEFAULT PRIVILEGES` is executing-role-bound, so a
 * `db:migrate` under a second superuser produces forced-but-ungranted tables).
 */
const TENANT_SCOPED_REQUIRED_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE"
];

type RoleGrantRow = {
  relname: string;
  sel: boolean;
  ins: boolean;
  upd: boolean;
  del: boolean;
};

/**
 * A grant check, distinct from `checkRlsEnabled` (flags) and
 * `checkLeastPrivilegeRoleProvisioned` (role attributes). Two directions, both
 * of which the other checks miss:
 *
 * - UNDER-granted: a tenant-scoped table missing any of SELECT/INSERT/UPDATE/
 *   DELETE for `awcms_app` — RLS-forced but unreachable, `permission denied`
 *   at runtime. The `ALTER DEFAULT PRIVILEGES`-is-executing-role-bound gap.
 * - OVER-granted: a global RLS-free table where `awcms_app` still holds a
 *   forbidden write — the residual #160 closes, and its regression guard for a
 *   FUTURE global table silently inheriting blanket DML from default privileges.
 *
 * The over-granted direction is FAIL-CLOSED (Issue #162 / L2): a table that is
 * RLS-free (present in `rlsFreeTables`) but carries NO explicit privilege
 * declaration in `forbiddenPrivileges` is asserted to hold ZERO writes. Any
 * write it does hold is reported as an over-grant with a "register the allowed
 * privileges" message, rather than being skipped as "full DML by design". This
 * closes the exact gap the auditor of #161 flagged: a future global table added
 * to the RLS-free set but forgotten in the forbidden-privilege map now FAILS
 * instead of passing silently.
 *
 * Uses `has_table_privilege(role, oid, priv)` so it reports the EFFECTIVE grant
 * (direct + default-privilege + PUBLIC), which is what the runtime actually
 * gets — reading `relacl` directly would miss default-privilege grants. The
 * function is available to any role and does not require membership in the
 * checked role, so this runs correctly even when `security:readiness` is run
 * AS `awcms_app` (the recommended way to run it).
 *
 * Non-blocking when `awcms_app` does not exist: a database migrated before
 * `sql/019` legitimately has no such role, and a `critical` fail there would
 * cry wolf over a merely-un-migrated state — the missing-role signal is already
 * the job of `checkLeastPrivilegeRoleProvisioned` (warning). Once the role
 * exists, wrong grants ARE `critical`.
 *
 * `policy` is injectable purely so tests can simulate the divergence the guard
 * defends against — an RLS-free table absent from the forbidden map — without
 * mutating shared module state (the `mock.module` cross-file-leak trap). It
 * defaults to the single source of truth, which is always internally consistent.
 */
export type RuntimeRoleGrantsPolicy = {
  rlsFreeTables: ReadonlySet<string>;
  forbiddenPrivileges: Record<string, string[]>;
};

/**
 * The real, internally-consistent policy `checkRuntimeRoleGrants` uses by
 * default. Exposed so tests can build a DIVERGENT policy from it (e.g. an
 * RLS-free table registered in `rlsFreeTables` but absent from
 * `forbiddenPrivileges`) to exercise the fail-closed guard, without mutating
 * shared module state.
 */
export function defaultRuntimeRoleGrantsPolicy(): RuntimeRoleGrantsPolicy {
  return {
    rlsFreeTables: RLS_FREE_TABLES,
    forbiddenPrivileges: GLOBAL_TABLE_FORBIDDEN_PRIVILEGES
  };
}

export async function checkRuntimeRoleGrants(
  policy?: Partial<RuntimeRoleGrantsPolicy>
): Promise<SecurityCheckResult> {
  const name = "Runtime role table grants match least-privilege matrix";
  const severity: CheckSeverity = "critical";
  const rlsFreeTables = policy?.rlsFreeTables ?? RLS_FREE_TABLES;
  const forbiddenPrivileges =
    policy?.forbiddenPrivileges ?? GLOBAL_TABLE_FORBIDDEN_PRIVILEGES;

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();

    const roleRows = (await sql`
      SELECT 1 AS present FROM pg_roles WHERE rolname = ${LEAST_PRIVILEGE_APP_ROLE}
    `) as { present: number }[];

    if (roleRows.length === 0) {
      return {
        name,
        severity,
        status: "pass",
        evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" does not exist (this database has not been migrated onto sql/019 yet) — grants cannot be checked. The "Dedicated least-privilege app DB role is provisioned" warning covers the missing-role state; this check does not block for it.`
      };
    }

    const rows = (await sql`
      SELECT
        c.relname,
        has_table_privilege(${LEAST_PRIVILEGE_APP_ROLE}, c.oid, 'SELECT') AS sel,
        has_table_privilege(${LEAST_PRIVILEGE_APP_ROLE}, c.oid, 'INSERT') AS ins,
        has_table_privilege(${LEAST_PRIVILEGE_APP_ROLE}, c.oid, 'UPDATE') AS upd,
        has_table_privilege(${LEAST_PRIVILEGE_APP_ROLE}, c.oid, 'DELETE') AS del
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname LIKE 'awcms\\_%' AND c.relkind IN ('r', 'p')
        AND n.nspname = current_schema()
      ORDER BY c.relname
    `) as RoleGrantRow[];

    if (rows.length === 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence:
          "No awcms_% tables found in pg_class — has `bun run db:migrate` been run against this database?"
      };
    }

    const held = (row: RoleGrantRow): Record<string, boolean> => ({
      SELECT: row.sel,
      INSERT: row.ins,
      UPDATE: row.upd,
      DELETE: row.del
    });

    const overGranted: string[] = [];
    const underGranted: string[] = [];

    for (const row of rows) {
      const privileges = held(row);

      if (rlsFreeTables.has(row.relname)) {
        // Global, RLS-free table. RLS can claw nothing back here (no policy),
        // so any write `awcms_app` holds is a real, un-mitigated privilege. The
        // table MUST carry an explicit privilege declaration. A registered
        // RLS-free table missing from `forbiddenPrivileges` is asserted
        // FAIL-CLOSED against every write (zero-write allowed) — the L2 guard:
        // a forgotten registration FAILS instead of silently keeping blanket
        // DML (Issue #162).
        const declared = forbiddenPrivileges[row.relname];
        const forbidden = declared ?? ALL_WRITE_PRIVILEGES;
        const excess = forbidden.filter((privilege) => privileges[privilege]);

        if (excess.length > 0) {
          overGranted.push(
            declared === undefined
              ? `${row.relname} (RLS-free but not declared in GLOBAL_TABLE_FORBIDDEN_PRIVILEGES — register the privileges awcms_app may hold; asserted zero-write until then, found ${excess.join(", ")})`
              : `${row.relname} (still has ${excess.join(", ")})`
          );
        }

        continue;
      }

      const missing = TENANT_SCOPED_REQUIRED_PRIVILEGES.filter(
        (privilege) => !privileges[privilege]
      );

      if (missing.length > 0) {
        underGranted.push(`${row.relname} (missing ${missing.join(", ")})`);
      }
    }

    if (overGranted.length > 0 || underGranted.length > 0) {
      const parts: string[] = [];

      if (overGranted.length > 0) {
        parts.push(
          `over-granted on global RLS-free table(s): ${overGranted.join("; ")}`
        );
      }

      if (underGranted.length > 0) {
        parts.push(
          `tenant-scoped table(s) unreachable at runtime (RLS-forced but ungranted -> permission denied; ALTER DEFAULT PRIVILEGES is executing-role-bound, see sql/021): ${underGranted.join("; ")}`
        );
      }

      return {
        name,
        severity,
        status: "fail",
        evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" grants do not match the least-privilege matrix — ${parts.join(". ")}.`
      };
    }

    const tenantScopedCount = rows.filter(
      (row) => !rlsFreeTables.has(row.relname)
    ).length;
    const narrowedGlobalTables = Object.entries(forbiddenPrivileges)
      .filter(([, forbidden]) => forbidden.length > 0)
      .map(([table]) => table)
      .join(", ");

    return {
      name,
      severity,
      status: "pass",
      evidence: `Role "${LEAST_PRIVILEGE_APP_ROLE}" holds SELECT/INSERT/UPDATE/DELETE on all ${tenantScopedCount} tenant-scoped table(s) and none of the forbidden writes on the narrowed global tables (${narrowedGlobalTables}).`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not verify runtime role grants: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 7c. Worker/setup least-privilege role grants match matrix (critical) —
//     Issue #163
// ---------------------------------------------------------------------------

/**
 * The purpose-specific runtime roles the worker/setup split (`sql/022`,
 * Issue #163) adds alongside `awcms_app`. Both are OPT-IN: `client.ts` falls
 * back to `DATABASE_URL` (`awcms_app`) when `WORKER_DATABASE_URL`/
 * `SETUP_DATABASE_URL` are unset, so a deployment can migrate onto `sql/022`
 * (creating the roles) without configuring them yet.
 */
const WORKER_ROLE = "awcms_worker";
const SETUP_ROLE = "awcms_setup";

/**
 * `awcms_worker`'s least-privilege grant matrix — table -> the exact verbs the
 * seven unattended cron scripts use, traced per-write-path (see `sql/022`'s
 * header and project memory `awcms-db-role-separation-notes`). This is the
 * SINGLE SOURCE OF TRUTH that `sql/022`'s GRANTs must match exactly:
 * `tests/db-role-separation-worker-setup-migration.test.ts` asserts the
 * migration text and this map agree, so neither can drift from the other.
 *
 * Any awcms_% table NOT keyed here MUST be ungranted for this role (fail-closed
 * least-privilege): the crown-jewel global catalogs (`awcms_permissions`,
 * `awcms_schema_migrations`, `awcms_setup_state`, the module registry) are
 * absent on purpose — the worker never touches them, and holding any privilege
 * on them would be the exact isolation breach this split exists to prevent.
 */
export const WORKER_ROLE_GRANTS: Record<string, string[]> = {
  awcms_tenants: ["SELECT"],
  awcms_audit_events: ["SELECT", "INSERT", "DELETE"],
  awcms_object_sync_queue: ["SELECT", "UPDATE"],
  awcms_email_messages: ["SELECT", "UPDATE"],
  awcms_email_delivery_attempts: ["INSERT"],
  awcms_email_templates: ["SELECT"],
  awcms_email_suppression_list: ["SELECT"],
  awcms_workflow_tasks: ["SELECT", "UPDATE"],
  awcms_workflow_instances: ["SELECT"],
  awcms_workflow_definitions: ["SELECT"],
  awcms_workflow_task_assignments: ["INSERT"],
  awcms_domain_events: ["SELECT", "INSERT"],
  awcms_domain_event_deliveries: ["SELECT", "INSERT", "UPDATE"],
  awcms_domain_event_consumer_state: ["SELECT"],
  awcms_domain_event_consumer_effects: ["SELECT", "INSERT"],
  awcms_domain_event_activity_daily: ["INSERT", "UPDATE"],
  awcms_reporting_projection_cursors: ["SELECT", "INSERT", "UPDATE"],
  awcms_reporting_projection_metrics: ["SELECT", "INSERT", "UPDATE"],
  awcms_reporting_projection_state: ["INSERT", "UPDATE"],
  awcms_reporting_rebuild_runs: ["SELECT", "UPDATE"],
  awcms_reporting_scheduled_exports: ["SELECT"],
  awcms_reporting_export_runs: ["SELECT", "INSERT"],
  awcms_abac_decision_logs: ["SELECT"],
  awcms_identities: ["SELECT"],
  awcms_sync_nodes: ["SELECT"],
  // Issue #180 — identity-access:business-scope:expiry (sql/027): SELECT the
  // expiry backlog + refresh gauges, UPDATE elapsed assignments to expired,
  // INSERT the append-only lifecycle event rows. No DELETE (status transition
  // only). The aggregate audit INSERT reuses awcms_audit_events above.
  awcms_business_scope_assignments: ["SELECT", "UPDATE"],
  awcms_business_scope_assignment_events: ["INSERT"],
  // Issue #181 — the same expiry job's SoD-exception pass (sql/029): SELECT the
  // approved-but-elapsed backlog, UPDATE those rows to expired. No DELETE, and
  // NO access to awcms_sod_conflict_evaluations (request-path chokepoint only,
  // on awcms_app). The per-exception audit INSERT reuses awcms_audit_events.
  awcms_sod_conflict_exceptions: ["SELECT", "UPDATE"],
  // blog_content — blog:publish:scheduled (sql/035): SELECT the due-post
  // batch `FOR UPDATE`, UPDATE it to published. No DELETE (status transition
  // only, never removes a row). SELECT-only on the two tables the content
  // quality checklist reads (post-term count, tenant checklist policy). The
  // job's own audit INSERT reuses awcms_audit_events above.
  awcms_blog_posts: ["SELECT", "UPDATE"],
  awcms_blog_post_terms: ["SELECT"],
  awcms_blog_settings: ["SELECT"],
  // news_portal — news-media:reconcile (sql/041): SELECT the reconciliation
  // snapshot, UPDATE claiming pending_upload/uploaded rows to `failed` and
  // soft-deleting stale `orphaned` rows, DELETE hard-deleting expired `failed`
  // rows. The job's own audit INSERT reuses awcms_audit_events above.
  awcms_news_media_objects: ["SELECT", "UPDATE", "DELETE"],
  // visitor_analytics — analytics:rollup + analytics:purge (sql/050). Rollup
  // SELECTs raw events and SELECT/INSERT/UPDATEs the daily rollups; purge
  // DELETEs aged events, SELECT/UPDATE/DELETEs sessions (raw-detail clear +
  // orphan delete), and DELETEs aged rollups. No audit INSERT (analytics is
  // log-like, not an audited high-risk action from the scheduled path).
  awcms_visit_events: ["SELECT", "DELETE"],
  awcms_visitor_sessions: ["SELECT", "UPDATE", "DELETE"],
  awcms_visitor_daily_rollups: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  // data_lifecycle — data-lifecycle:archive-purge (sql/055, ADR-0037). Legal
  // holds are SELECT-ONLY for the worker: it reads holds to decide whether to
  // skip a descriptor's purge, but never creates/releases them (that stays an
  // admin/API action on awcms_app). Cursors + manifests are SELECT/INSERT/
  // UPDATE (bounded pause/resume state + archive evidence); runs are
  // SELECT/INSERT/DELETE (the generic engine purges its own aged run history).
  awcms_data_lifecycle_legal_holds: ["SELECT"],
  awcms_data_lifecycle_cursors: ["SELECT", "INSERT", "UPDATE"],
  awcms_data_lifecycle_archive_manifests: ["SELECT", "INSERT", "UPDATE"],
  awcms_data_lifecycle_runs: ["SELECT", "INSERT", "DELETE"]
};

/**
 * `awcms_setup`'s least-privilege grant matrix — exactly what
 * `bootstrapPlatformTenant` writes on the one-time
 * `POST /api/v1/setup/initialize`. SELECT accompanies INSERT on every table it
 * inserts into WITH a `RETURNING id` (Postgres requires SELECT for a column to
 * appear in RETURNING). `awcms_permissions` is READ-only (source of the
 * role-permission seed's `INSERT ... SELECT`); no DELETE anywhere; the module
 * registry and migration ledger are absent (never touched by the bootstrap).
 */
export const SETUP_ROLE_GRANTS: Record<string, string[]> = {
  awcms_setup_state: ["SELECT", "INSERT", "UPDATE"],
  awcms_tenants: ["SELECT", "INSERT"],
  awcms_permissions: ["SELECT"],
  awcms_tenant_settings: ["INSERT"],
  awcms_offices: ["SELECT", "INSERT"],
  awcms_profiles: ["SELECT", "INSERT"],
  awcms_identities: ["SELECT", "INSERT"],
  awcms_tenant_users: ["SELECT", "INSERT"],
  awcms_roles: ["SELECT", "INSERT"],
  awcms_role_permissions: ["INSERT"],
  awcms_access_assignments: ["INSERT"]
};

export type WorkerSetupRoleGrantsPolicy = {
  worker: Record<string, string[]>;
  setup: Record<string, string[]>;
};

/**
 * The real matrices `checkWorkerSetupRoleGrants` uses by default. Exposed so
 * tests can inject a DIVERGENT matrix (e.g. drop a table to simulate an
 * under-grant, or add one to simulate a forgotten REVOKE) to exercise both
 * failure directions, without mutating shared module state (the `mock.module`
 * cross-file-leak trap the L2 test already documents).
 */
export function defaultWorkerSetupRoleGrantsPolicy(): WorkerSetupRoleGrantsPolicy {
  return { worker: WORKER_ROLE_GRANTS, setup: SETUP_ROLE_GRANTS };
}

const ALL_FOUR_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];

type NamedGrantRow = {
  relname: string;
  sel: boolean;
  ins: boolean;
  upd: boolean;
  del: boolean;
};

/**
 * Verifies each opt-in split role holds EXACTLY its least-privilege matrix —
 * no less (under-grant -> `permission denied` for that job in production) and
 * no more (over-grant -> the isolation the split exists for is a lie). For
 * every awcms_% table it checks `has_table_privilege` in both directions:
 * matrix tables must match their declared verbs exactly; every other table
 * must be fully ungranted (fail-closed — the crown-jewel catalogs are absent
 * from the matrices ON PURPOSE, so an accidental grant on one is a critical
 * finding, not a silent "by design").
 *
 * Mirrors `checkLeastPrivilegeRoleProvisioned`'s non-blocking stance for the
 * opt-in default: a role that does NOT exist is reported (info) and does not
 * fail, because a deployment on the `DATABASE_URL` fallback legitimately has
 * neither role — same reasoning that keeps the `awcms_app` provisioning check a
 * warning until deployments migrate. But a role that DOES exist with wrong
 * grants, or with SUPERUSER/BYPASSRLS, is `critical`: once you opt in, the
 * least-privilege promise must actually hold.
 *
 * `policy` is injectable purely for tests (see
 * `defaultWorkerSetupRoleGrantsPolicy`); it defaults to the single source of
 * truth the migration is pinned against.
 */
export async function checkWorkerSetupRoleGrants(
  policy?: Partial<WorkerSetupRoleGrantsPolicy>
): Promise<SecurityCheckResult> {
  const name = "Worker/setup least-privilege role grants match matrix";
  const severity: CheckSeverity = "critical";
  const matrices: { role: string; grants: Record<string, string[]> }[] = [
    { role: WORKER_ROLE, grants: policy?.worker ?? WORKER_ROLE_GRANTS },
    { role: SETUP_ROLE, grants: policy?.setup ?? SETUP_ROLE_GRANTS }
  ];

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();
    const findings: string[] = [];
    const absent: string[] = [];
    const present: string[] = [];

    for (const { role, grants } of matrices) {
      const roleRows = (await sql`
        SELECT rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = ${role}
      `) as { rolsuper: boolean; rolbypassrls: boolean }[];

      if (roleRows.length === 0) {
        // Opt-in default: this deployment uses the DATABASE_URL fallback and
        // has never provisioned the role. Not a misconfiguration.
        absent.push(role);
        continue;
      }

      present.push(role);
      const role0 = roleRows[0]!;

      if (role0.rolsuper || role0.rolbypassrls) {
        findings.push(
          `${role} is ${role0.rolsuper ? "a SUPERUSER" : "BYPASSRLS"} — it would bypass every RLS policy, defeating the split`
        );
      }

      const rows = (await sql`
        SELECT
          c.relname,
          has_table_privilege(${role}, c.oid, 'SELECT') AS sel,
          has_table_privilege(${role}, c.oid, 'INSERT') AS ins,
          has_table_privilege(${role}, c.oid, 'UPDATE') AS upd,
          has_table_privilege(${role}, c.oid, 'DELETE') AS del
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname LIKE 'awcms\\_%' AND c.relkind IN ('r', 'p')
          AND n.nspname = current_schema()
        ORDER BY c.relname
      `) as NamedGrantRow[];

      for (const row of rows) {
        const held = new Set(
          ALL_FOUR_PRIVILEGES.filter(
            (privilege) =>
              ({
                SELECT: row.sel,
                INSERT: row.ins,
                UPDATE: row.upd,
                DELETE: row.del
              })[privilege]
          )
        );
        const expected = new Set(grants[row.relname] ?? []);

        const missing = [...expected].filter((p) => !held.has(p));
        const extra = ALL_FOUR_PRIVILEGES.filter(
          (p) => held.has(p) && !expected.has(p)
        );

        if (missing.length > 0) {
          findings.push(
            `${role} under-granted on ${row.relname} (missing ${missing.join(", ")} -> permission denied at runtime)`
          );
        }
        if (extra.length > 0) {
          findings.push(
            expected.size === 0
              ? `${role} over-granted on ${row.relname} (holds ${extra.join(", ")} but this table is NOT in its least-privilege matrix — isolation breach)`
              : `${role} over-granted on ${row.relname} (holds ${extra.join(", ")} beyond its matrix)`
          );
        }
      }
    }

    if (findings.length > 0) {
      return {
        name,
        severity,
        status: "fail",
        evidence: `Opt-in split role grants do not match the least-privilege matrix (sql/022): ${findings.join("; ")}.`
      };
    }

    if (present.length === 0) {
      return {
        name,
        severity,
        status: "pass",
        evidence: `Neither "${WORKER_ROLE}" nor "${SETUP_ROLE}" is provisioned — this deployment uses the DATABASE_URL fallback (opt-in, sql/022). Nothing to verify; not blocking. Provision + point WORKER_DATABASE_URL/SETUP_DATABASE_URL at them to gain per-job isolation.`
      };
    }

    return {
      name,
      severity,
      status: "pass",
      evidence: `Provisioned split role(s) ${present.join(", ")} hold exactly their least-privilege matrix and nothing more (non-super, non-BYPASSRLS, zero grant on every out-of-matrix awcms_% table)${absent.length > 0 ? `; ${absent.join(", ")} not provisioned (DATABASE_URL fallback, fine)` : ""}.`
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not verify worker/setup role grants: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 8. ABAC default-deny works (critical)
// ---------------------------------------------------------------------------

export function checkAbacDefaultDeny(): SecurityCheckResult {
  const name = "ABAC default-deny works";
  const severity: CheckSeverity = "critical";

  const decision = evaluateAccess(
    {
      tenantId: "00000000-0000-0000-0000-000000000000",
      tenantUserId: "00000000-0000-0000-0000-0000000000aa",
      identityId: "00000000-0000-0000-0000-0000000000bb",
      roles: []
    },
    {
      moduleKey: "identity_access",
      activityCode: "user_management",
      action: "read"
    },
    new Set()
  );

  if (decision.allowed === false && decision.matchedPolicy === "default_deny") {
    return {
      name,
      severity,
      status: "pass",
      evidence:
        'evaluateAccess() with an empty granted-permission set returns allowed=false (matchedPolicy="default_deny").'
    };
  }

  return {
    name,
    severity,
    status: "fail",
    evidence: `evaluateAccess() with an empty granted-permission set unexpectedly allowed access: ${JSON.stringify(decision)}.`
  };
}

// ---------------------------------------------------------------------------
// Data lifecycle (ADR-0037, ported from awcms-micro Issue #745)
// ---------------------------------------------------------------------------

/**
 * Pure code-registry check (no DB, no I/O) — same shape as `checkAbacDefaultDeny`
 * above. `bun run data-lifecycle:registry:check` already gates this in CI (`bun
 * run check`); this duplicates the SAME `validateLifecycleRegistry` call as a
 * `security:readiness`/go-live signal too, so a broken high-volume table
 * descriptor (wrong owner, missing legal-hold precedence, unbounded batch limit,
 * etc.) is also visible from the go-live checklist, not only from CI.
 */
export function checkDataLifecycleRegistryValid(): SecurityCheckResult {
  const name = "data_lifecycle high-volume table registry is valid";
  const severity: CheckSeverity = "critical";

  const result = validateLifecycleRegistry(listModules());

  if (result.valid) {
    return {
      name,
      severity,
      status: "pass",
      evidence: `${result.descriptors.length} registered high-volume table descriptor(s) all pass validateLifecycleRegistry (owner, scope, cursor, bounds, indexes, legal-hold, archive, purge strategy).`
    };
  }

  return {
    name,
    severity,
    status: "fail",
    evidence: `${result.issues.length} registry issue(s): ${result.issues.map(formatLifecycleRegistryIssue).join("; ")}.`
  };
}

/**
 * Guards the "default-deny release" invariant (ADR-0037 critical requirement)
 * structurally: every `DATA_LIFECYCLE_PERMISSIONS` value must stay UNIQUE (in
 * particular `legal_hold.create` and `legal_hold.release` must never collapse
 * into one `legal_hold.manage`-style permission a future refactor might be
 * tempted to introduce — a role granted create must not implicitly also be able
 * to release), and `release` must stay classified as a high-risk action. Pure
 * code check, no DB. Iterates `Object.values` (plain `string[]`) rather than
 * comparing two specific literal-typed constants directly, so this stays a
 * genuine RUNTIME safety net — comparing two same-file literal types directly
 * would be flagged by `tsc` as a statically-impossible comparison and defeat the
 * point of a regression guard.
 */
export function checkDataLifecycleLegalHoldReleaseSeparate(): SecurityCheckResult {
  const name =
    "data_lifecycle legal hold release is a separate, high-risk permission";
  const severity: CheckSeverity = "critical";

  const values: string[] = Object.values(DATA_LIFECYCLE_PERMISSIONS);
  const uniqueValues = new Set(values);

  if (uniqueValues.size !== values.length) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `DATA_LIFECYCLE_PERMISSIONS has duplicate permission key(s) — expected ${values.length} unique values, found ${uniqueValues.size}. legal_hold.create must never resolve to the same key as legal_hold.release.`
    };
  }

  if (!isHighRiskAction("release")) {
    return {
      name,
      severity,
      status: "fail",
      evidence:
        '"release" is no longer classified in HIGH_RISK_ACTIONS (access-control.ts) — releasing a legal hold removes a data-protection safeguard and must stay high-risk.'
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence: `All ${values.length} DATA_LIFECYCLE_PERMISSIONS values are unique (legal_hold.create ("${DATA_LIFECYCLE_PERMISSIONS.legalHoldCreate}") and legal_hold.release ("${DATA_LIFECYCLE_PERMISSIONS.legalHoldRelease}") included), and "release" is classified as a high-risk action.`
  };
}

// ---------------------------------------------------------------------------
// 9. Audit log table exists and reachable (critical)
// ---------------------------------------------------------------------------

export async function checkAuditLogTableReachable(): Promise<SecurityCheckResult> {
  const name = "Audit log table exists and reachable";
  const severity: CheckSeverity = "critical";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }

    const sql = getDatabaseClient();
    const rows = (await sql`
      SELECT to_regclass('awcms_audit_events') AS to_regclass
    `) as { to_regclass: string | null }[];
    const value = rows[0]?.to_regclass ?? null;

    if (value) {
      return {
        name,
        severity,
        status: "pass",
        evidence: `to_regclass('awcms_audit_events') = ${value}.`
      };
    }

    return {
      name,
      severity,
      status: "fail",
      evidence:
        "to_regclass('awcms_audit_events') returned null — the audit table does not exist."
    };
  } catch (error) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `Could not query the database for the audit table: ${errorMessage(error)}.`
    };
  }
}

// ---------------------------------------------------------------------------
// 10. Environment configuration is valid (critical)
// ---------------------------------------------------------------------------

/**
 * Reuses `validateEnv` from `scripts/validate-env.ts` VERBATIM rather than
 * re-deriving any env rule a second, divergent way. Unlike mini — whose
 * `validate-env.ts` exports a per-area `checkEmailConfig`/`checkMfaConfig`/
 * ... family this file wraps one-by-one — this repo's `validate-env.ts`
 * exports a single `validateEnv(env): string[]` (a list of problems). So
 * this is ONE check, not a dozen; splitting it would mean re-implementing
 * that file's internals here, which is exactly what the "don't diverge"
 * rule forbids.
 */
export function checkEnvConfigValid(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name = "Environment configuration is valid";
  const severity: CheckSeverity = "critical";
  const problems = validateEnv(env);

  if (problems.length > 0) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `validate-env reported ${problems.length} problem(s): ${problems.join("; ")}.`
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence:
      "validateEnv() (the same rules `bun run config:validate` enforces) reports no problem for the current environment."
  };
}

// ---------------------------------------------------------------------------
// 11. Sync HMAC secret is not left at its documented default (warning/info)
// ---------------------------------------------------------------------------

const SYNC_SECRET_PLACEHOLDER = "change-me"; // literal default from .env.example

export function checkSyncHmacSecretNotDefault(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name = "Sync HMAC secret is not left at its documented default";

  if (env.AWCMS_SYNC_ENABLED !== "true") {
    return {
      name,
      severity: "info",
      status: "pass",
      evidence: `AWCMS_SYNC_ENABLED is not "true" — sync is disabled by design, so its HMAC secret is not a live risk (not checked).`
    };
  }

  const secret = env.AWCMS_SYNC_HMAC_SECRET;

  if (!secret || secret === SYNC_SECRET_PLACEHOLDER) {
    return {
      name,
      severity: "warning",
      status: "fail",
      evidence: `AWCMS_SYNC_ENABLED=true but AWCMS_SYNC_HMAC_SECRET is unset or still the documented placeholder ("${SYNC_SECRET_PLACEHOLDER}").`
    };
  }

  return {
    name,
    severity: "warning",
    status: "pass",
    evidence:
      "AWCMS_SYNC_ENABLED=true and AWCMS_SYNC_HMAC_SECRET has been changed from its documented placeholder."
  };
}

// ---------------------------------------------------------------------------
// MFA TOTP secret encryption key is configured when MFA is enabled (critical)
// ---------------------------------------------------------------------------

const MFA_KEY_PLACEHOLDERS = new Set(["change-me", "changeme", "secret", ""]);

/**
 * Issue #184 — when `AUTH_MFA_ENABLED=true`, the TOTP secret encryption key
 * MUST be a real 32-byte AES-256 key. There is no default key by design, so a
 * missing/placeholder/wrong-length key means every enrollment and every login
 * challenge fails closed (`MFA_MISCONFIGURED`) AND — worse — an operator who
 * believes MFA is protecting privileged accounts has no working second factor.
 * `critical` because it silently disables a security control the deployment
 * declared it wanted.
 */
export function checkMfaEncryptionKeyConfigured(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name =
    "MFA TOTP secret encryption key is configured when MFA is enabled";
  const severity: CheckSeverity = "critical";

  if (env.AUTH_MFA_ENABLED !== "true") {
    return {
      name,
      severity: "info",
      status: "pass",
      evidence: `AUTH_MFA_ENABLED is not "true" — MFA enrollment is disabled by design, so its encryption key is not a live risk (not checked).`
    };
  }

  const raw = env.AUTH_MFA_SECRET_ENCRYPTION_KEY?.trim() ?? "";

  if (MFA_KEY_PLACEHOLDERS.has(raw)) {
    return {
      name,
      severity,
      status: "fail",
      evidence:
        "AUTH_MFA_ENABLED=true but AUTH_MFA_SECRET_ENCRYPTION_KEY is unset or a placeholder — there is no default key, so MFA is entirely non-functional (fails closed)."
    };
  }

  let byteLength = 0;
  try {
    byteLength = Buffer.from(raw, "base64").length;
  } catch {
    byteLength = 0;
  }

  if (byteLength !== 32) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `AUTH_MFA_SECRET_ENCRYPTION_KEY base64-decodes to ${byteLength} bytes, not 32 — AES-256-GCM requires exactly a 32-byte key (\`openssl rand -base64 32\`).`
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence:
      "AUTH_MFA_ENABLED=true and AUTH_MFA_SECRET_ENCRYPTION_KEY is a valid 32-byte AES-256 key."
  };
}

// ---------------------------------------------------------------------------
// OIDC/SSO client-secret encryption key is configured when SSO is enabled
// (critical), and the SSRF escape hatch is not set in production (critical)
// ---------------------------------------------------------------------------

const SSO_KEY_PLACEHOLDERS = new Set(["change-me", "changeme", "secret", ""]);

/**
 * Issue #185 — when `AUTH_SSO_ENABLED=true`, the client-secret encryption key
 * MUST be a real 32-byte AES-256 key (no default by design), otherwise every
 * provider create/token-exchange fails closed (SSO_MISCONFIGURED) and an
 * operator who believes SSO is configured has a non-functional login path. Also
 * asserts the SSRF escape hatch `AUTH_SSO_ALLOW_INSECURE_HOSTS` (loopback/http
 * for a local fake IdP in tests) is NOT set in production — leaving it set
 * re-opens the SSRF surface this issue closes. `critical` because both silently
 * defeat a security control the deployment declared it wanted.
 */
export function checkSsoCredentialEncryptionKeyConfigured(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name =
    "OIDC/SSO client-secret encryption key is configured and SSRF escape hatch is off in production";
  const severity: CheckSeverity = "critical";

  if (
    env.APP_ENV === "production" &&
    (env.AUTH_SSO_ALLOW_INSECURE_HOSTS ?? "").trim() !== ""
  ) {
    return {
      name,
      severity,
      status: "fail",
      evidence:
        "AUTH_SSO_ALLOW_INSECURE_HOSTS is set in production — this disables the OIDC SSRF guard's HTTPS/private-IP checks and must be empty outside tests."
    };
  }

  if (env.AUTH_SSO_ENABLED !== "true") {
    return {
      name,
      severity: "info",
      status: "pass",
      evidence: `AUTH_SSO_ENABLED is not "true" — tenant SSO is disabled by design, so its encryption key is not a live risk (not checked).`
    };
  }

  const raw = env.AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";

  if (SSO_KEY_PLACEHOLDERS.has(raw)) {
    return {
      name,
      severity,
      status: "fail",
      evidence:
        "AUTH_SSO_ENABLED=true but AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY is unset or a placeholder — there is no default key, so SSO provider secrets cannot be stored/used (fails closed)."
    };
  }

  let byteLength = 0;
  try {
    byteLength = Buffer.from(raw, "base64").length;
  } catch {
    byteLength = 0;
  }

  if (byteLength !== 32) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY base64-decodes to ${byteLength} bytes, not 32 — AES-256-GCM requires exactly a 32-byte key (\`openssl rand -base64 32\`).`
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence:
      "AUTH_SSO_ENABLED=true and AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY is a valid 32-byte AES-256 key; SSRF escape hatch is not set in production."
  };
}

// ---------------------------------------------------------------------------
// Full-online deployment-profile gate is correctly configured (Issue #186) —
// critical when misconfigured, informational when disabled intentionally
// ---------------------------------------------------------------------------

/**
 * Issue #186 — the deployment-profile gate every full-online-only control
 * (today: Turnstile) checks. This is what lets a production preflight tell
 * "disabled intentionally" (the flag is unset — LAN/offline is fine, nothing
 * required) apart from "misconfigured" (the flag is on but the profile is
 * anything other than `full_online`). `critical` because a misconfigured gate
 * silently changes whether an online-only control activates at all.
 */
export function checkOnlineAuthSecurityReady(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name = "Full-online deployment-profile gate is correctly configured";
  const severity: CheckSeverity = "critical";

  if (!isOnlineSecurityEnabled(env)) {
    return {
      name,
      severity: "info",
      status: "pass",
      evidence:
        'AUTH_ONLINE_SECURITY_ENABLED is not "true" — full-online auth hardening (Turnstile) is disabled intentionally; LAN/offline deployments are unaffected.'
    };
  }

  const profile = resolveOnlineSecurityProfile(env);

  if (profile !== "full_online") {
    return {
      name,
      severity,
      status: "fail",
      evidence: `AUTH_ONLINE_SECURITY_ENABLED=true but AUTH_ONLINE_SECURITY_PROFILE is "${
        env.AUTH_ONLINE_SECURITY_PROFILE ?? "unset"
      }", not "full_online" — this is a MISCONFIGURED gate, not "disabled intentionally".`
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence:
      "AUTH_ONLINE_SECURITY_ENABLED=true and AUTH_ONLINE_SECURITY_PROFILE=full_online — the full-online gate is active."
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile configuration is complete when enabled (Issue #186) —
// critical when misconfigured, informational when disabled intentionally
// ---------------------------------------------------------------------------

/**
 * Issue #186 — when `TURNSTILE_ENABLED=true`, the public site key, the secret
 * key, AND the expected hostname must all be present or Turnstile fails closed
 * for every gated request (login/setup) on the full-online profile. `critical`
 * because it silently defeats a bot-mitigation control the deployment declared
 * it wanted. Deliberately independent of the outer profile gate (an operator
 * may stage credentials before flipping the profile on).
 *
 * NEVER prints a secret value — only which required var NAME is missing, from
 * the feature's own `TURNSTILE_REQUIRED_WHEN_ENABLED` list, so this check can
 * never drift from `validate-env.ts` and never leaks the key.
 */
export function checkTurnstileReady(
  env: NodeJS.ProcessEnv = process.env
): SecurityCheckResult {
  const name = "Turnstile configuration is complete when enabled";
  const severity: CheckSeverity = "critical";

  if (!isTurnstileEnabled(env)) {
    return {
      name,
      severity: "info",
      status: "pass",
      evidence:
        'TURNSTILE_ENABLED is not "true" — Cloudflare Turnstile is disabled intentionally; no widget, CSP origin, or outbound verification call is active.'
    };
  }

  const missing = TURNSTILE_REQUIRED_WHEN_ENABLED.filter(
    (varName) => (env[varName] ?? "").trim() === ""
  );

  if (missing.length > 0) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `TURNSTILE_ENABLED=true but missing/empty: ${missing.join(
        ", "
      )} — Turnstile would fail closed for every gated request (secret values are never printed).`
    };
  }

  // Issue #186 (F3) — fully configured but INERT. `TURNSTILE_ENABLED=true` with
  // every key present, yet the full-online deployment-profile gate is off, means
  // `isTurnstileRequired()` is false: login/setup run with NO Turnstile at all.
  // This is a LEGITIMATE staging state (keys provisioned ahead of the profile
  // flip), so it is a `warning`, not blocking — but it must be surfaced loudly,
  // because otherwise an operator who staged the keys and forgot to flip the
  // profile sees every preflight check pass green while the control does nothing.
  if (!isFullOnlineSecurityActive(env)) {
    return {
      name,
      severity: "warning",
      status: "fail",
      evidence:
        "TURNSTILE_ENABLED=true and all keys present, but Turnstile is INERT: the full-online profile gate is off (needs AUTH_ONLINE_SECURITY_ENABLED=true AND AUTH_ONLINE_SECURITY_PROFILE=full_online). Login/setup run WITHOUT Turnstile until the profile is flipped on — legitimate only if you are staging credentials ahead of go-live."
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence:
      "TURNSTILE_ENABLED=true, all keys present, AND the full-online profile gate is active — Turnstile is enforced (secret values never printed)."
  };
}

// ---------------------------------------------------------------------------
// 12. Login rate limiting is implemented (warning)
// ---------------------------------------------------------------------------

export function checkLoginRateLimitImplemented(): SecurityCheckResult {
  const name = "Login rate limiting is implemented (source-scoped volumetric)";
  const severity: CheckSeverity = "warning";
  const key = `security-readiness-synthetic-rate-limit-check-${crypto.randomUUID()}`;
  const config = { maxAttempts: 3, windowMs: 60_000 };
  const now = 1_000_000;

  checkRateLimit(key, config, now);
  checkRateLimit(key, config, now + 1);
  checkRateLimit(key, config, now + 2);
  const fourth = checkRateLimit(key, config, now + 3);

  if (!fourth.allowed) {
    return {
      name,
      severity,
      status: "pass",
      evidence: `checkRateLimit() with maxAttempts=3 denies the 4th call within the same window (retryAfterSec=${fourth.retryAfterSec}).`
    };
  }

  return {
    name,
    severity,
    status: "fail",
    evidence: `checkRateLimit() did not deny the 4th call after exceeding maxAttempts=3; result=${JSON.stringify(fourth)}.`
  };
}

// ---------------------------------------------------------------------------
// 13. Security response headers are built (warning)
// ---------------------------------------------------------------------------

const REQUIRED_SECURITY_HEADERS = [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy"
];

/**
 * Calls the real `buildSecurityHeaders` (which `src/middleware.ts` applies to
 * every response) rather than `fetch`ing a running server the way mini's
 * equivalent does. This repo is API-only — it has no `/login` page to GET,
 * and a readiness gate that silently downgrades to "not checked — no server
 * reachable" whenever it is run without a live server (mini's behavior) is a
 * check that mostly does not run. Calling the builder is deterministic and
 * needs no server; the residual gap is that it cannot prove middleware is
 * actually wired, which `tests/security-headers-csp.test.ts` covers.
 */
export function checkSecurityHeadersBuilt(): SecurityCheckResult {
  const name = "Security response headers are built (CSP/X-Frame-Options/etc.)";
  const severity: CheckSeverity = "warning";
  const headers = new Map(buildSecurityHeaders({ isProduction: true }));
  const missing = REQUIRED_SECURITY_HEADERS.filter(
    (header) => !headers.has(header)
  );

  if (missing.length > 0) {
    return {
      name,
      severity,
      status: "fail",
      evidence: `buildSecurityHeaders({ isProduction: true }) is missing header(s): ${missing.join(", ")}.`
    };
  }

  if (!headers.has("Strict-Transport-Security")) {
    return {
      name,
      severity,
      status: "fail",
      evidence:
        "buildSecurityHeaders({ isProduction: true }) did not include Strict-Transport-Security — HSTS is expected for a production (TLS) deployment."
    };
  }

  return {
    name,
    severity,
    status: "pass",
    evidence: `buildSecurityHeaders({ isProduction: true }) includes all of: ${REQUIRED_SECURITY_HEADERS.join(", ")}, Strict-Transport-Security.`
  };
}

// ---------------------------------------------------------------------------
// Out-of-scope items — printed as their own report section, never silently
// dropped.
// ---------------------------------------------------------------------------

export const OUT_OF_SCOPE_ITEMS: OutOfScopeItem[] = [
  {
    name: "Audit log retention is actually being executed",
    reason:
      "`bun run logs:audit:purge` (Issue #146) implements retention, but whether it is SCHEDULED is a deployment concern (cron/systemd timer/k8s CronJob) this script cannot observe from the repo. Run `bun run logs:audit:purge --dry-run` against the target database to see the real backlog past cutoff."
  },
  {
    name: "Tax data masking / CRM opt-out / AI read-only / POS smoke test",
    reason:
      "No tax/CRM/AI/POS module exists in this generic base — domain concern of a derived app (e.g. AWPOS)."
  },
  {
    name: "PostgreSQL not publicly exposed",
    reason:
      "Deployment-profile concern — network exposure is set by the operator, not verifiable from this repo. Check the actual deployed network exposure manually."
  },
  {
    name: "Backup/restore tested",
    reason:
      "Requires a real backup/restore run against a provisioned environment. Manual — run it and verify a restored row count."
  },
  {
    name: "PostgreSQL version pinned",
    reason:
      "Deployment-profile concern; this repo has no docker-compose.yml. Confirm the running server manually (`SELECT version();`)."
  }
];

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runSecurityReadinessChecks(): Promise<
  SecurityCheckResult[]
> {
  return [
    await checkNoHardcodedSecret(),
    checkEnvNotTracked(),
    await checkPasswordHashingModern(),
    checkLoginLockoutImplemented(),
    await checkRlsEnabled(),
    await checkAppDbUserNotSuperuser(),
    await checkLeastPrivilegeRoleProvisioned(),
    await checkRuntimeRoleGrants(),
    await checkWorkerSetupRoleGrants(),
    checkAbacDefaultDeny(),
    checkDataLifecycleRegistryValid(),
    checkDataLifecycleLegalHoldReleaseSeparate(),
    await checkAuditLogTableReachable(),
    checkEnvConfigValid(),
    checkSyncHmacSecretNotDefault(),
    checkMfaEncryptionKeyConfigured(),
    checkSsoCredentialEncryptionKeyConfigured(),
    checkOnlineAuthSecurityReady(),
    checkTurnstileReady(),
    checkLoginRateLimitImplemented(),
    checkSecurityHeadersBuilt()
  ];
}

function statusIcon(result: SecurityCheckResult): string {
  return result.status === "pass" ? "PASS" : "FAIL";
}

export function printReport(results: SecurityCheckResult[]): boolean {
  console.log("security:readiness — production security readiness checklist");
  console.log("");

  for (const result of results) {
    console.log(
      `[${statusIcon(result)}] (${result.severity}) ${result.name}\n    ${result.evidence}`
    );
  }

  console.log("");
  console.log("Out of scope for this base (documented, not silently dropped):");

  for (const item of OUT_OF_SCOPE_ITEMS) {
    console.log(`  - ${item.name}: ${item.reason}`);
  }

  const criticalFailures = results.filter(
    (result) => result.severity === "critical" && result.status === "fail"
  );
  const warningFailures = results.filter(
    (result) => result.severity === "warning" && result.status === "fail"
  );

  console.log("");
  console.log(
    `Summary: ${results.length} check(s) run, ${criticalFailures.length} critical failure(s), ${warningFailures.length} warning failure(s).`
  );

  if (criticalFailures.length > 0) {
    console.log("GO-LIVE DIBLOKIR — critical finding(s) present:");
    for (const failure of criticalFailures) {
      console.log(`  - ${failure.name}: ${failure.evidence}`);
    }
    return false;
  }

  console.log("No critical findings — security:readiness passes.");
  return true;
}

async function main() {
  const results = await runSecurityReadinessChecks();
  const passed = printReport(results);

  if (!passed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
