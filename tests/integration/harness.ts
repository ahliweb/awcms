/**
 * Integration-test harness — real PostgreSQL, real migrations, real route
 * handlers (Issue #154).
 *
 * WHY THIS EXISTS. Every other file under `tests/` is a pure-unit test or a
 * migration-shape assertion; the handful that reach a database
 * (`workflow-approval-concurrency`, `reporting-projection-rebuild-lock`,
 * `office-directory-postgres`, `security-readiness-rls`) each open their OWN
 * `new Bun.SQL(DATABASE_URL)` connection. Nothing has ever proved that an
 * endpoint's real wiring (auth -> ABAC -> module-enabled -> transaction ->
 * RLS -> response envelope) holds, and — critically — nothing has ever proved
 * that RLS is ENFORCED rather than merely declared.
 *
 * ------------------------------------------------------------------------
 * TWO DATABASES, AND WHY (this is the load-bearing design decision)
 * ------------------------------------------------------------------------
 * `bun test` runs every file in ONE process, and `src/lib/database/client.ts`
 * memoizes ONE `Bun.SQL` pool per client kind for that whole process, with no
 * eviction API. So `getDatabaseClient()` is pinned to whatever database it is
 * FIRST called against — in a full suite, that is `DATABASE_URL` (some earlier
 * file's route invocation memoizes it), and this harness cannot repoint it.
 * A naive "repoint `process.env.DATABASE_URL` at a throwaway database and hope
 * `getDatabaseClient()` picks it up" — which awcms-mini's harness does — is
 * therefore UNSOUND here and produced real cross-database split-brain (the
 * worker writing to database A while the seed went to database B). This
 * harness never mutates `process.env` and never assumes it owns the memoized
 * pool.
 *
 * Instead it exposes TWO clearly separated worlds:
 *
 * 1. THE EPHEMERAL DATABASE (`awcms_it_<pid>`) — built here from the supplied
 *    superuser `DATABASE_URL`, with a purpose-built NON-SUPERUSER owner role
 *    that RUNS the migrations (so it owns every table) and is then demoted,
 *    plus migration 019's least-privilege `awcms_app` activated. Reached ONLY
 *    through DEDICATED connections this harness owns
 *    (`getAdminSql`/`getOwnerSql`/`getAppRoleSql`/`getRuntimeSql`), never
 *    through `getDatabaseClient()`. This is where RLS/`FORCE` can actually be
 *    observed, because the connection is genuinely a non-superuser table
 *    owner (or the non-owner `awcms_app`). Tests that drive functions
 *    directly (passing `sql` in) live here: `db-role-separation`,
 *    `reporting-projections`.
 *
 * 2. THE HANDLER DATABASE — whatever `getDatabaseClient()` resolves to (i.e.
 *    the migrated `DATABASE_URL` database in CI). Route handlers call
 *    `getDatabaseClient()`/`getSetupDatabaseClient()` INTERNALLY, so a test
 *    that drives real HTTP handlers (`module-tenant-lifecycle`) has no choice
 *    but to run there. It seeds/reads/truncates through `getHandlerAdminSql()`
 *    — a superuser connection to THAT SAME database, discovered at runtime —
 *    so seed and handler never diverge. Its assertions are application-logic
 *    invariants (MODULE_DISABLED wiring, tenant-scoped session lookup, audit)
 *    that hold under any role; RLS ENFORCEMENT is proved rigorously in world
 *    1, not re-litigated here.
 *
 * ------------------------------------------------------------------------
 * MIGRATIONS RUN AS A SUPERUSER OWNER, WHICH IS THEN DEMOTED
 * ------------------------------------------------------------------------
 * The ephemeral owner is created `SUPERUSER`, runs `bun scripts/db-migrate.ts`
 * (the real runner operators use, as a subprocess — never a reimplemented
 * apply loop), and is only THEN `ALTER`ed to `NOSUPERUSER NOBYPASSRLS`. Not
 * harness convenience: migration 019 contains
 * `ALTER ROLE awcms_app SET app.current_tenant_id = '<all-zero uuid>'`, and
 * `ALTER ROLE ... SET` of a CUSTOMIZED (placeholder) GUC requires SUPERUSER —
 * `CREATEROLE` is not enough (`permission denied to set parameter
 * "app.current_tenant_id"`). Demoting afterwards leaves a non-superuser role
 * that genuinely owns the schema, the only way to observe `FORCE` at work.
 *
 * ------------------------------------------------------------------------
 * GATING — `DATABASE_URL`, deliberately, and nothing else
 * ------------------------------------------------------------------------
 * `ci.yml`'s `quality` job runs `bun test` with NO Postgres service and no
 * `DATABASE_URL`, so `integrationEnabled` is false there and every suite
 * skips cleanly. Two pipelines DO provide a `postgres:18.4` service, set
 * `DATABASE_URL`, and migrate before executing this suite for real:
 * `ci.yml`'s dedicated `integration-tests` job (`bun test tests/integration/`
 * — scoped to exactly these 4 harness-based files, added alongside this
 * harness) and `release.yml`'s `validate` job (a separate, identically-scoped
 * step after `bun run check`). Gating on a bespoke variable of our own would
 * mean these tests run in NO pipeline while looking like coverage; that exact
 * mistake has already been made once in this repo (424 lines of inert
 * concurrency tests, PR #157). Do not "improve" this gate.
 *
 * The older, independent `*-postgres.test.ts`/concurrency files elsewhere
 * under `tests/` (each opening their own ad-hoc `DATABASE_URL` connection —
 * `office-directory-postgres`, `workflow-approval-concurrency`,
 * `keyset-pagination-precision-postgres`, `security-readiness-rls`,
 * `audit-log-purge`, `reporting-projection-rebuild-lock`) gate on the SAME
 * `DATABASE_URL` variable but were never designed to run concurrently against
 * one shared, already-migrated database in a single `bun test` process —
 * verified empirically (a bare `bun test` against a migrated DB collides, 26
 * failures). Neither pipeline runs a bare `bun test` against a migrated
 * database for that reason; both scope to `tests/integration/` explicitly.
 *
 * ------------------------------------------------------------------------
 * LIFECYCLE — single-use database, cleaned up after
 * ------------------------------------------------------------------------
 * World-1 files call `setupIntegrationDatabase()` in `beforeAll` and
 * `teardownIntegrationDatabase()` in `afterAll` (ref-counted: the first
 * provisions role+database+schema, the last drops them). The database/role
 * names are `<pid>`-suffixed and STABLE per process — load-bearing, because a
 * later file in the same process re-acquires and a `Bun.SQL` pool transparently
 * reconnects after `DROP DATABASE ... WITH (FORCE)` + `CREATE DATABASE` of the
 * same name (verified empirically). `awcms_app` is cluster-scoped and created
 * by the real migration, so it is only de-LOGIN'd on teardown, never dropped.
 *
 * `bun test` fires neither `process.on("exit")` nor `"beforeExit"` (verified),
 * so `afterAll` is the only teardown hook — hence the ref-count.
 */
import type { APIContext, APIRoute } from "astro";

import {
  getDatabaseClient,
  getSetupDatabaseClient
} from "../../src/lib/database/client";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { resetWorkClassGatesForTests } from "../../src/lib/database/work-class";
import { resetRateLimitForTests } from "../../src/lib/security/rate-limit";

/**
 * Captured at module load. The privileged/admin connection string the CI
 * service (or a developer's scratch container) handed us. This harness treats
 * it purely as an admin channel and NEVER mutates `process.env.DATABASE_URL`
 * from it — see the header for why env mutation is unsound in a shared-process
 * suite.
 */
const ADMIN_DATABASE_URL = process.env.DATABASE_URL ?? "";

/**
 * Every suite gates itself with
 * `const suite = integrationEnabled ? describe : describe.skip;`
 * so a machine without a database skips cleanly instead of failing.
 */
export const integrationEnabled = ADMIN_DATABASE_URL.length > 0;

/**
 * Non-secret fixture passwords. Both roles live only inside a throwaway
 * database on a throwaway cluster; neither is a deployment credential.
 */
const OWNER_ROLE_PASSWORD = "integration_owner_role_password";
const APP_ROLE_PASSWORD = "integration_app_role_password";

const SUFFIX = String(process.pid);
const EPHEMERAL_DATABASE = `awcms_it_${SUFFIX}`;
const OWNER_ROLE = `awcms_it_owner_${SUFFIX}`;

/**
 * The least-privilege runtime role created by migration 019 (Issue #141).
 * Unlike the database and the owner role, this one is NOT ephemeral: Postgres
 * roles are CLUSTER-scoped, so this is the real, shared role the real
 * migration creates. `activateAppRole()` only flips it to `LOGIN` with a
 * fixture password (mirroring what a deployment does with a real secret);
 * teardown puts it back to `NOLOGIN`.
 */
export const APP_ROLE_NAME = "awcms_app";

/**
 * False when migration 019 has not created `awcms_app` (e.g. #141 reverted).
 * Suites that assert on the least-privilege role check this and skip with an
 * explanation rather than hard-failing; `getRuntimeSql()` falls back to the
 * OWNER role, which is still non-superuser, so every non-#141 assertion keeps
 * its meaning.
 */
export let appRoleActivated = false;

function buildUrl(database: string, user?: string, password?: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.pathname = `/${database}`;

  if (user !== undefined) {
    url.username = user;
    url.password = password ?? "";
  }

  return url.toString();
}

/** Connection string of the ephemeral database, as the schema OWNER. */
function ownerUrl(): string {
  return buildUrl(EPHEMERAL_DATABASE, OWNER_ROLE, OWNER_ROLE_PASSWORD);
}

/** Connection string of the ephemeral database, as least-privilege `awcms_app`. */
function appUrl(): string {
  return buildUrl(EPHEMERAL_DATABASE, APP_ROLE_NAME, APP_ROLE_PASSWORD);
}

/**
 * `postgres` rather than the admin database itself: `CREATE DATABASE` /
 * `DROP DATABASE` cannot run while connected to the target, and cannot run
 * inside a transaction block.
 */
let rootSql: Bun.SQL | undefined;
let adminSql: Bun.SQL | undefined;
let ownerSql: Bun.SQL | undefined;
let appRoleSql: Bun.SQL | undefined;
let handlerAdminSql: Bun.SQL | undefined;
let refCount = 0;
let setupPromise: Promise<void> | undefined;

function getRootSql(): Bun.SQL {
  if (!rootSql) {
    rootSql = new Bun.SQL(buildUrl("postgres"), { max: 1 });
  }

  return rootSql;
}

// ===========================================================================
// WORLD 1 — the ephemeral database (dedicated connections, never the pool)
// ===========================================================================

/**
 * SUPERUSER connection to the EPHEMERAL database. Bypasses RLS by design —
 * the fixture-seeding/inspection channel (seeding a second tenant, reading
 * rows the runtime role must NOT be able to see, truncation). Never use it to
 * assert "the app can read X": that is what `getRuntimeSql()`/`getOwnerSql()`
 * are for.
 */
export function getAdminSql(): Bun.SQL {
  if (!adminSql) {
    adminSql = new Bun.SQL(buildUrl(EPHEMERAL_DATABASE), { max: 4 });
  }

  return adminSql;
}

/**
 * The connection that OWNS every table — non-superuser, NOBYPASSRLS, and the
 * migration owner. The only posture in which `FORCE ROW LEVEL SECURITY`
 * (migration 017 / PR #139) is what stands between two tenants' rows, so every
 * FORCE assertion must use this.
 */
export function getOwnerSql(): Bun.SQL {
  if (!ownerSql) {
    ownerSql = new Bun.SQL(ownerUrl(), { max: 4 });
  }

  return ownerSql;
}

/**
 * A DEDICATED connection to the ephemeral database as the least-privilege
 * `awcms_app` role (migration 019). Only valid when `appRoleActivated`; callers
 * MUST guard on it. Unlike `getDatabaseClient()`, this is a private pool this
 * harness fully controls, so it is immune to whatever database the process-wide
 * memoized client pool happens to be pinned to.
 */
export function getAppRoleSql(): Bun.SQL {
  if (!appRoleActivated) {
    throw new Error(
      "getAppRoleSql() called but awcms_app is not activated — guard on appRoleActivated first."
    );
  }

  if (!appRoleSql) {
    appRoleSql = new Bun.SQL(appUrl(), { max: 4 });
  }

  return appRoleSql;
}

/**
 * The least-privilege RUNTIME connection to the ephemeral database, for direct
 * function-level tests (e.g. the reporting worker, which takes its `sql` as an
 * argument). Resolves to `awcms_app` when migration 019 is present — the real
 * production runtime posture — and otherwise to the non-superuser OWNER. Both
 * are subject to RLS (the owner via `FORCE`, `awcms_app` by not owning the
 * tables), so an isolation assertion made through this connection is real
 * either way.
 */
export function getRuntimeSql(): Bun.SQL {
  return appRoleActivated ? getAppRoleSql() : getOwnerSql();
}

/** Whether a Postgres role exists — used to skip #141-dependent assertions. */
export async function roleExists(roleName: string): Promise<boolean> {
  const rows = (await getRootSql()`
    SELECT 1 FROM pg_roles WHERE rolname = ${roleName}
  `) as unknown[];

  return rows.length > 0;
}

/**
 * Runs the REAL migration runner (`bun scripts/db-migrate.ts`) as the owner
 * role, in a subprocess. The owner is still SUPERUSER at this point; see the
 * header for why (migration 019's `ALTER ROLE ... SET app.current_tenant_id`).
 */
async function applyMigrationsAsOwner(): Promise<void> {
  const proc = Bun.spawn(["bun", "scripts/db-migrate.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DATABASE_URL: ownerUrl() }
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    throw new Error(
      `db:migrate failed against the ephemeral integration database (exit ${exitCode}).\n${stdout}\n${stderr}`
    );
  }
}

async function dropEphemeralDatabase(): Promise<void> {
  const root = getRootSql();

  // `WITH (FORCE)` terminates backends still attached — including any this
  // harness's own dedicated pools are holding.
  await root.unsafe(
    `DROP DATABASE IF EXISTS "${EPHEMERAL_DATABASE}" WITH (FORCE)`
  );

  // `awcms_app` is cluster-scoped and created by the REAL migration, possibly
  // shared with other databases on this cluster (in `release.yml`, the primary
  // `awcms` database's own `db:migrate` step created it first). Never dropped —
  // only the LOGIN this harness granted is revoked, restoring migration 019's
  // shipped NOLOGIN state.
  if (await roleExists(APP_ROLE_NAME)) {
    await root.unsafe(`ALTER ROLE "${APP_ROLE_NAME}" NOLOGIN PASSWORD NULL`);
  }

  appRoleActivated = false;

  // After DROP DATABASE: a role cannot be dropped while it still owns objects.
  await root.unsafe(`DROP ROLE IF EXISTS "${OWNER_ROLE}"`);
}

async function createEphemeralDatabase(): Promise<void> {
  const root = getRootSql();

  // A previous run of THIS pid's database may survive a hard kill (bun test
  // fires no exit hook). Drop first — the deterministic name makes this both
  // the leftover sweep and the precondition for a virgin schema.
  await dropEphemeralDatabase();

  // SUPERUSER only for the migration run; demoted immediately after.
  await root.unsafe(
    `CREATE ROLE "${OWNER_ROLE}" LOGIN SUPERUSER PASSWORD '${OWNER_ROLE_PASSWORD}'`
  );
  await root.unsafe(
    `CREATE DATABASE "${EPHEMERAL_DATABASE}" OWNER "${OWNER_ROLE}"`
  );
}

/** Strips the migration-time superuser bit — the owner is now exactly a plain non-superuser role that happens to own every table, the posture `FORCE` exists for. */
async function demoteOwnerRole(): Promise<void> {
  await getRootSql().unsafe(
    `ALTER ROLE "${OWNER_ROLE}" NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
  );
}

/**
 * Gives migration 019's `awcms_app` a LOGIN + fixture password, exactly as
 * `sql/019_awcms_db_role_separation.sql`'s own header instructs a deployment to
 * (`ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`) — the migration ships it
 * NOLOGIN because a password is a secret and cannot be committed. No-op (and
 * `appRoleActivated` stays false) when the role does not exist.
 */
async function activateAppRole(): Promise<void> {
  if (!(await roleExists(APP_ROLE_NAME))) {
    appRoleActivated = false;
    return;
  }

  await getRootSql().unsafe(
    `ALTER ROLE "${APP_ROLE_NAME}" LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`
  );
  appRoleActivated = true;
}

/**
 * `beforeAll` entry point for WORLD-1 files. Ref-counted + memoized: the first
 * caller provisions role + database + schema + `awcms_app`; later files reuse
 * it until the ref-count drops to zero. Does NOT touch `process.env`.
 */
export async function setupIntegrationDatabase(): Promise<void> {
  if (!integrationEnabled) {
    return;
  }

  refCount += 1;

  if (!setupPromise) {
    setupPromise = (async () => {
      await createEphemeralDatabase();
      await applyMigrationsAsOwner();
      await demoteOwnerRole();
      await activateAppRole();
    })();
  }

  await setupPromise;
}

/**
 * `afterAll` entry point for WORLD-1 files. The last to release drops the
 * database and the owner role — a single-use database cleaned up after itself,
 * exactly as the `postgres:18.4` CI service is thrown away after the job.
 */
export async function teardownIntegrationDatabase(): Promise<void> {
  if (!integrationEnabled) {
    return;
  }

  refCount -= 1;

  if (refCount > 0) {
    return;
  }

  await adminSql?.close({ timeout: 1 });
  await ownerSql?.close({ timeout: 1 });
  await appRoleSql?.close({ timeout: 1 });
  adminSql = undefined;
  ownerSql = undefined;
  appRoleSql = undefined;
  setupPromise = undefined;

  await dropEphemeralDatabase();
  await rootSql?.close({ timeout: 1 });
  rootSql = undefined;
}

/**
 * Truncates every runtime table in the EPHEMERAL database between tests,
 * preserving exactly the two things the MIGRATIONS own and no test may
 * recreate: `awcms_schema_migrations` (the runner's ledger — wiping it would
 * make the next migration run replay everything) and `awcms_permissions` (the
 * global ABAC seed catalog INSERTed by migrations — wiping it would silently
 * break every access check and turn real 200s into misleading 403s).
 *
 * ALSO resets the two pieces of PROCESS-GLOBAL in-memory state `withTenant`
 * consults on every call: the database circuit breaker and the work-class
 * gates. Both live in module memory, not Postgres, so TRUNCATE does not touch
 * them — and both are shared across every file in the one process `bun test`
 * uses. Without this reset, a PRIOR file that tripped the breaker (e.g.
 * `tenant-context-circuit-breaker.test.ts`, or any DB-gated test that saw real
 * failures) leaves it OPEN, and the first `withTenant` here returns `503
 * DATABASE_BUSY` before touching the database at all — turning a green suite
 * red for a reason unrelated to what it asserts. Same cross-file pollution the
 * project's own memory records from PR #157.
 */
export async function resetDatabase(): Promise<void> {
  resetDatabaseCircuitBreakerForTests();
  resetWorkClassGatesForTests();
  resetRateLimitForTests();

  await truncateAwcmsTables(getAdminSql());
}

async function truncateAwcmsTables(sql: Bun.SQL): Promise<void> {
  const rows = (await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'awcms\\_%'
      AND tablename NOT IN ('awcms_schema_migrations', 'awcms_permissions')
  `) as { tablename: string }[];

  if (rows.length === 0) {
    return;
  }

  const list = rows.map((row) => `"${row.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

// ===========================================================================
// WORLD 2 — the handler database (whatever getDatabaseClient() resolves to)
// ===========================================================================

let handlerDatabaseName: string | undefined;
let handlerDatabaseReady = false;

/**
 * The client the route handlers themselves use — `getDatabaseClient()`,
 * process-wide memoized and beyond this harness's control. In a full `bun test`
 * run it resolves to the migrated `DATABASE_URL` database. World-2 tests
 * (`module-tenant-lifecycle`) drive real handlers, which reach for this
 * internally, so their fixtures MUST target the same database — hence
 * `getHandlerAdminSql()`.
 */
export function getHandlerDatabaseClient(): Bun.SQL {
  return getDatabaseClient();
}

/**
 * `beforeAll` entry point for WORLD-2 files. Discovers which database
 * `getDatabaseClient()` (and `getSetupDatabaseClient()`, used by the setup
 * route) actually resolve to, and verifies it carries the migrated schema.
 * Returns `false` (with a warning) when the schema is absent — a clean skip,
 * never a hard failure, mirroring the `DATABASE_URL`-gating convention: this
 * lets a developer run the suite against a bare `postgres` database without a
 * red run.
 */
export async function ensureHandlerDatabaseReady(): Promise<boolean> {
  if (!integrationEnabled) {
    return false;
  }

  if (handlerDatabaseReady) {
    return true;
  }

  const client = getDatabaseClient();
  const rows = (await client`
    SELECT current_database() AS db,
           to_regclass('public.awcms_tenants') IS NOT NULL AS migrated
  `) as { db: string; migrated: boolean }[];

  handlerDatabaseName = rows[0]?.db;

  // The setup route uses a DIFFERENT client kind (`getSetupDatabaseClient`).
  // It must resolve to the SAME database, or a bootstrapped tenant would be
  // invisible to the handlers that then act on it. In this repo both fall back
  // to `DATABASE_URL`, so they agree — assert it rather than assume it.
  const setupRows = (await getSetupDatabaseClient()`
    SELECT current_database() AS db
  `) as { db: string }[];

  if (!rows[0]?.migrated || setupRows[0]?.db !== handlerDatabaseName) {
    console.warn(
      `[skip] the handler database (${handlerDatabaseName ?? "unknown"}) is not ` +
        `a migrated schema, or the app/setup clients disagree on which database ` +
        `they use (app=${handlerDatabaseName}, setup=${setupRows[0]?.db}). ` +
        `Run 'bun run db:migrate' against DATABASE_URL first. Skipping.`
    );
    return false;
  }

  handlerDatabaseReady = true;
  return true;
}

/**
 * SUPERUSER connection to the HANDLER database (the one `getDatabaseClient()`
 * uses), for seeding/reading/truncating the fixtures a route-handler test needs.
 * Built from the admin `DATABASE_URL` credentials repointed at the discovered
 * handler database, so it and the handlers act on the same rows even when
 * `getDatabaseClient()` itself is a non-superuser role that could not, say,
 * TRUNCATE. Requires `ensureHandlerDatabaseReady()` to have run.
 */
export function getHandlerAdminSql(): Bun.SQL {
  if (!handlerDatabaseName) {
    throw new Error(
      "getHandlerAdminSql() called before ensureHandlerDatabaseReady() resolved the handler database."
    );
  }

  if (!handlerAdminSql) {
    handlerAdminSql = new Bun.SQL(buildUrl(handlerDatabaseName), { max: 4 });
  }

  return handlerAdminSql;
}

/**
 * `afterAll` for WORLD-2 files: leaves the handler database as it found it
 * (empty of `awcms_*` runtime rows) and closes the admin pool. Other DB-gated
 * files share this database and run in their own sequential window, so a clean
 * table state on exit is the courteous default.
 */
export async function teardownHandlerDatabase(): Promise<void> {
  if (!integrationEnabled || !handlerDatabaseReady) {
    return;
  }

  await truncateAwcmsTables(getHandlerAdminSql());
  await handlerAdminSql?.close({ timeout: 1 });
  handlerAdminSql = undefined;
  handlerDatabaseReady = false;
  handlerDatabaseName = undefined;
}

/** `beforeEach` for WORLD-2 files — truncate the handler database + reset the process-global gates (see `resetDatabase`). */
export async function resetHandlerDatabase(): Promise<void> {
  resetDatabaseCircuitBreakerForTests();
  resetWorkClassGatesForTests();
  resetRateLimitForTests();

  await truncateAwcmsTables(getHandlerAdminSql());
}

// ===========================================================================
// Shared assertion + route-invocation helpers
// ===========================================================================

/**
 * Asserts a query is rejected by PostgreSQL (permission denied, RLS write
 * violation, FK violation, ...).
 *
 * Uses try/catch rather than `expect(promise).rejects.*`: per awcms-mini's own
 * hard-won note, `expect().rejects` against a `Bun.SQL` query promise HANGS the
 * process on this Bun version. Never rewrite these as `.rejects.toThrow()`.
 */
export async function assertRejected(
  promise: Promise<unknown>,
  what: string
): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error(`Expected PostgreSQL to reject ${what}, but it succeeded.`);
}

// ---------------------------------------------------------------------------
// Cookie jar — only login/logout write cookies, but `resolveAuthInputs` reads
// them on every guarded route, so a jar must always be present.
// ---------------------------------------------------------------------------

export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: unknown): void;
  delete(name: string, options?: unknown): void;
  has(name: string): boolean;
};

export function createCookieJar(): CookieJar {
  const store = new Map<string, string>();

  return {
    get: (name) =>
      store.has(name) ? { value: store.get(name) as string } : undefined,
    set: (name, value) => {
      store.set(name, value);
    },
    delete: (name) => {
      store.delete(name);
    },
    has: (name) => store.has(name)
  };
}

// ---------------------------------------------------------------------------
// Route invocation — a real Request + a minimal Astro context, calling the
// handler directly (no dev server, no build).
// ---------------------------------------------------------------------------

export type InvokeOptions = {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  locals?: Record<string, unknown>;
  cookies?: CookieJar;
};

export type InvokeResult<T = unknown> = {
  status: number;
  body: T;
  response: Response;
};

/**
 * Calls an Astro `APIRoute` with a synthetic context. Only the fields real
 * handlers destructure are provided (`request`, `url`, `params`, `locals`,
 * `cookies`, `clientAddress`); the single `as unknown as APIContext` cast is
 * centralized here so no test file needs it.
 */
export async function invoke<T = unknown>(
  handler: APIRoute,
  options: InvokeOptions = {}
): Promise<InvokeResult<T>> {
  const method = options.method ?? "GET";
  const path = options.path ?? "/";
  const url = new URL(`http://integration.test${path}`);
  const hasBody = options.body !== undefined && method !== "GET";

  const request = new Request(url.toString(), {
    method,
    headers: options.headers,
    body: hasBody ? JSON.stringify(options.body) : undefined
  });

  const context = {
    request,
    url,
    params: options.params ?? {},
    locals: options.locals ?? {},
    cookies: options.cookies ?? createCookieJar(),
    clientAddress: "127.0.0.1"
  } as unknown as APIContext;

  const response = await handler(context);
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as T) : (undefined as T);

  return { status: response.status, body, response };
}
