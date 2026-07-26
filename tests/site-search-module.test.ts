/**
 * `site_search` module wiring (ADR-0040, ported from awcms-micro Issue #270).
 *
 * These guard the failure modes that break nothing visibly at build time:
 *
 * 1. **Permission drift.** The descriptor, the sql/065 catalog seed, and every
 *    route guard must name the same six permissions. When they disagree the
 *    symptom is a bare 403 that denies even the tenant owner, with nothing
 *    pointing at the cause.
 * 2. **RLS drift.** Every one of the five tables is tenant data. `ENABLE ROW
 *    LEVEL SECURITY` without `FORCE` is inert for the table owner — the
 *    documented trap in this repo — so both are asserted per table.
 * 3. **Worker over-grant.** The scheduled reconcile runs as `awcms_worker`.
 *    A grant in the migration that `security-readiness`'s matrix does not
 *    declare (or vice versa) means the least-privilege claim is unverified.
 * 4. **Lifecycle key drift.** The `dataLifecycle` descriptors name tables and
 *    cursor columns that must actually exist, with the composite index the
 *    generic purge engine walks.
 * 5. **Arrow direction.** No module may depend on or consume `site_search` —
 *    the contribution arrow points inward (ADR-0040 §2). A reversed edge would
 *    still typecheck and still pass the DAG gate.
 *
 * Pure and DB-free: everything asserted here is code/SQL text, so it runs in the
 * ordinary unit suite rather than the DB-gated one.
 */
import { describe, expect, test } from "bun:test";

import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";
import { listModules } from "../src/modules";
import {
  siteSearchModule,
  SITE_SEARCH_INDEX_FAILURES_LIFECYCLE_KEY,
  SITE_SEARCH_QUERY_LOG_LIFECYCLE_KEY
} from "../src/modules/site-search/module";

const SCHEMA_PATH = "sql/064_awcms_site_search_schema.sql";
const PERMISSION_SEED_PATH = "sql/065_awcms_site_search_permissions.sql";

const TENANT_TABLES = [
  "awcms_site_search_documents",
  "awcms_site_search_settings",
  "awcms_site_search_index_runs",
  "awcms_site_search_index_failures",
  "awcms_site_search_query_log"
] as const;

/** Every permission this module claims, as `activity.action`. */
const EXPECTED_PERMISSIONS = [
  "index.read",
  "index.reconcile",
  "index.rebuild",
  "settings.read",
  "settings.update",
  "diagnostics.read"
] as const;

async function readRepoFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("site_search — registry wiring", () => {
  test("is registered in the base module registry", () => {
    expect(listModules().map((m) => m.key)).toContain("site_search");
  });

  test("declares exactly the modules it imports", () => {
    expect(siteSearchModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "module_management"
    ]);
  });

  test("never depends on a CONTENT module — the aggregator invariant", () => {
    // The point of this guard was never the literal number two. It is that a
    // consumer/aggregator must not depend on any module whose content it
    // aggregates, or the dependency runs backwards and the module stops being
    // generic. `module_management` was added 2026-07-26 (the public route gates
    // on `fetchTenantModuleEntry`); it is infrastructure, not content, so the
    // invariant holds. Asserting the invariant directly means adding another
    // infrastructure dep does not require editing a test, while adding a
    // content dep still fails.
    const CONTENT_MODULES = [
      "blog_content",
      "news_portal",
      "comments",
      "media_library",
      "site_search",
      "seo_distribution"
    ];
    expect(
      siteSearchModule.dependencies.filter((dep) =>
        CONTENT_MODULES.includes(dep)
      )
    ).toEqual([]);
  });

  test("declares its own OpenAPI fragment and base path", () => {
    expect(siteSearchModule.api?.openApiPath).toBe(
      "openapi/modules/site-search.openapi.yaml"
    );
    expect(siteSearchModule.api?.basePath).toBe("/api/v1/site-search");
  });

  test("no module depends on or consumes site_search — the arrow points inward (ADR-0040 §2)", () => {
    for (const module of listModules()) {
      if (module.key === "site_search") continue;
      expect(module.dependencies ?? []).not.toContain("site_search");
      const consumed = (module.capabilities?.consumes ?? []).map((c) =>
        typeof c === "string" ? c : c.capability
      );
      expect(consumed).not.toContain("search_source");
      expect(consumed).not.toContain("site_search");
    }
  });

  test("does NOT declare a search_source capability — >1 provider would be a provider conflict", () => {
    const provided = siteSearchModule.capabilities?.provides ?? [];
    expect(provided).toHaveLength(0);
  });

  test("registers the scheduled reconcile job, marked offline-LAN safe", () => {
    const job = (siteSearchModule.jobs ?? []).find(
      (j) => j.command === "bun run site-search:reconcile"
    );
    expect(job).toBeDefined();
    expect(job!.safeInOfflineLan).toBe(true);
  });
});

describe("site_search — permission single-source agreement", () => {
  test("module.ts declares exactly the six expected permissions", () => {
    const declared = (siteSearchModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );
    expect(declared.sort()).toEqual([...EXPECTED_PERMISSIONS].sort());
  });

  test("the sql/065 catalog seed declares exactly the same six", () => {
    const sql = Bun.file(PERMISSION_SEED_PATH);
    return sql.text().then((text) => {
      const seeded = [
        ...text.matchAll(/\('site_search',\s*'([a-z_]+)',\s*'([a-z_]+)'/g)
      ].map((m) => `${m[1]}.${m[2]}`);
      expect(seeded.sort()).toEqual([...EXPECTED_PERMISSIONS].sort());
    });
  });

  test("every route guard names a permission the catalog actually seeds", async () => {
    const routes: [string, string][] = [
      ["src/pages/api/v1/site-search/settings.ts", "settings"],
      ["src/pages/api/v1/site-search/index/status.ts", "index"],
      ["src/pages/api/v1/site-search/index/rebuild.ts", "index"],
      ["src/pages/api/v1/site-search/index/reconcile.ts", "index"],
      ["src/pages/api/v1/site-search/index/failures.ts", "diagnostics"]
    ];
    for (const [path, activity] of routes) {
      const source = await readRepoFile(path);
      const actions = [...source.matchAll(/action:\s*"([a-z_]+)"\s*as const/g)]
        .map((m) => m[1])
        .filter((a): a is string => a !== undefined);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(EXPECTED_PERMISSIONS as readonly string[]).toContain(
          `${activity}.${action}`
        );
      }
    }
  });

  test("the two mutating admin routes require an Idempotency-Key and audit the run", async () => {
    for (const path of [
      "src/pages/api/v1/site-search/index/rebuild.ts",
      "src/pages/api/v1/site-search/index/reconcile.ts",
      "src/pages/api/v1/site-search/settings.ts"
    ]) {
      const source = await readRepoFile(path);
      expect(source).toContain("IDEMPOTENCY_REQUIRED");
      expect(source).toContain("recordAuditEvent");
    }
  });
});

describe("site_search — schema invariants (sql/064)", () => {
  test("every tenant table is ENABLE *and* FORCE row level security", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    for (const table of TENANT_TABLES) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      // FORCE is the load-bearing half — ENABLE alone is inert for the owner.
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`${table}_tenant_isolation`);
    }
  });

  test("every tenant table's isolation policy keys off app.current_tenant_id", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    const policies = [
      ...sql.matchAll(/CREATE POLICY (\w+)\s+ON (\w+)\s+USING \((.+?)\);/gs)
    ];
    expect(policies).toHaveLength(TENANT_TABLES.length);
    for (const match of policies) {
      expect(match[3]).toContain(
        "tenant_id = current_setting('app.current_tenant_id')"
      );
    }
  });

  test("the index document is pinned to public content by a CHECK, not by convention", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    expect(sql).toContain("CHECK (privacy_classification = 'public')");
  });

  test("the reconcile upsert key exists as a UNIQUE index", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS awcms_site_search_documents_dedup"
    );
    expect(sql).toContain("(tenant_id, source_key, resource_id, locale)");
  });

  test("both query paths are index-backed (FTS GIN + trigram on title only)", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    expect(sql).toContain("USING GIN (search_vector)");
    expect(sql).toContain("USING GIN (title gin_trgm_ops)");
    // A trigram index on the BODY would be the cardinality mistake this module
    // deliberately avoids — suggestions match titles only.
    expect(sql).not.toContain("body_text gin_trgm_ops");
  });
});

describe("site_search — least-privilege worker grants", () => {
  test("every table the migration GRANTs to awcms_worker is declared in the readiness matrix", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    const grants = [
      ...sql.matchAll(
        /GRANT ([A-Z, ]+) ON (awcms_site_search_\w+) TO awcms_worker;/g
      )
    ];
    expect(grants.length).toBeGreaterThan(0);
    for (const match of grants) {
      const privileges = match[1]!.split(",").map((p) => p.trim());
      const table = match[2]!;
      expect(WORKER_ROLE_GRANTS[table]).toEqual(privileges);
    }
  });

  test("the readiness matrix declares no site_search table the migration does not grant", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    const declared = Object.keys(WORKER_ROLE_GRANTS).filter((t) =>
      t.startsWith("awcms_site_search_")
    );
    expect(declared.length).toBe(5);
    for (const table of declared) {
      expect(sql).toContain(`ON ${table} TO awcms_worker;`);
    }
  });

  test("the worker never gets write access to tenant search settings", () => {
    expect(WORKER_ROLE_GRANTS.awcms_site_search_settings).toEqual(["SELECT"]);
  });
});

describe("site_search — data_lifecycle descriptor agreement", () => {
  test("both purgeable telemetry tables are registered with generic execution", () => {
    const descriptors = siteSearchModule.dataLifecycle ?? [];
    expect(descriptors.map((d) => d.key).sort()).toEqual(
      [
        SITE_SEARCH_INDEX_FAILURES_LIFECYCLE_KEY,
        SITE_SEARCH_QUERY_LOG_LIFECYCLE_KEY
      ].sort()
    );
    for (const descriptor of descriptors) {
      expect(descriptor.executionMode).toBe("generic");
      expect(descriptor.ownerModuleKey).toBe("site_search");
      expect(descriptor.scope).toBe("tenant");
      expect(descriptor.deletion.mode).toBe("hard_delete");
    }
  });

  test("each descriptor's table + cursor column + required index actually exist in sql/064", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    for (const descriptor of siteSearchModule.dataLifecycle ?? []) {
      expect(sql).toContain(
        `CREATE TABLE IF NOT EXISTS ${descriptor.tableName}`
      );
      expect(sql).toContain(`${descriptor.cursorColumn} timestamptz`);
      // The (tenant, cursor) composite the generic purge engine filters/orders by.
      expect(sql).toContain(`(tenant_id, ${descriptor.cursorColumn})`);
      expect(descriptor.requiredIndexes?.[0]?.columns).toEqual([
        "tenant_id",
        descriptor.cursorColumn
      ]);
    }
  });

  test("the index table itself is NOT registered for purge — it is rebuilt, not aged out", () => {
    const tables = (siteSearchModule.dataLifecycle ?? []).map(
      (d) => d.tableName
    );
    expect(tables).not.toContain("awcms_site_search_documents");
  });
});
