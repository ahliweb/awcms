#!/usr/bin/env bun
/**
 * `bun run modules:table-writes:check` — ADR-0013 §6, "no shared-table write".
 *
 * Every `awcms_*` table is written by at most ONE module, or the sharing is in
 * the reviewed exception list below.
 *
 * ## The rule was cited but never enforced
 *
 * `_shared/module-contract.ts` invokes "ADR-0013 §6 no shared-table write" FOUR
 * separate times — in the docs for `dataLifecycle`, `searchSources`,
 * `commentableResources`, and `reportingProjections` — as the reason each of
 * those seams passes DECLARATIVE metadata to a central engine instead of
 * letting one module reach into another's schema. Each of those seams honours
 * it. Nothing checked the hand-written SQL everywhere else, and six tables were
 * being written by more than one module when this landed.
 *
 * The concrete cost was already visible in the smallest possible form:
 * `identity_access` had two independent `INSERT INTO awcms_profiles` sites
 * (JIT provisioning #185 and self-registration approval #276) that had drifted
 * apart on `verification_status`, so two accounts created minutes apart got
 * different verification postures for reasons nobody had decided. Both now go
 * through `profile_identity`'s own `createPersonProfileForIdentity`.
 *
 * ## Ownership is derived, not declared
 *
 * There is no `tables:` field in `ModuleDescriptor` and this gate deliberately
 * does not add one. The rule is "at most one writer", which is a property of
 * the code as written — so the writers ARE the evidence, and a new table needs
 * no registration to be covered. That also means the gate cannot go stale in
 * the dangerous direction: a table nobody registered is not a table nobody
 * checks.
 *
 * ## What it can and cannot see (stated, not silently dropped)
 *
 * It matches LITERAL table names in `INSERT INTO` / `UPDATE` / `DELETE FROM`.
 * It therefore does NOT see `data_lifecycle`'s bounded purge or `reporting`'s
 * projection workers, which write `${tableName}` interpolated from a
 * descriptor. That is the correct blind spot rather than a gap: those engines
 * touch only what the OWNING module declared, which is the very mechanism
 * ADR-0013 §6 prescribes, and `data-lifecycle:registry:check` /
 * `reporting:projections:registry:check` already gate the declarations. What is
 * left over — a hand-written INSERT naming another module's table — is exactly
 * the undeclared coupling this exists to catch.
 *
 * Pure: reads `listModules()` and the source tree. No database, no network.
 */
import { listModules } from "../src/modules";
import { collectClaims, resolveOwner, routeOf } from "./validate-module-routes";
import { stripComments } from "./lib/source-text";

/** `INSERT INTO x` / `UPDATE x` / `DELETE FROM x`, table name captured. */
const WRITE_PATTERN =
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(awcms_\w+)/gi;

const SOURCE_GLOBS = ["src/**/*.ts", "src/**/*.astro", "scripts/**/*.ts"];

/**
 * Owners that are not modules. Named so a violation reads as a sentence.
 *
 * `INFRASTRUCTURE` is exported because `data-lifecycle:registry:check`
 * (ADR-0076) decides who may hold an infrastructure lifecycle descriptor by
 * comparing against this exact literal. Passing it rather than re-typing it
 * there is deliberate: two copies of the string would drift, and the drift
 * would show up as a gate that quietly matches nothing.
 */
export const INFRASTRUCTURE_OWNER = "(src/lib infrastructure)";
const INFRASTRUCTURE = INFRASTRUCTURE_OWNER;
const TOOLING = "(scripts tooling)";
const UNCLAIMED_ROUTE = "(unclaimed route)";

export type TableWriter = {
  owner: string;
  file: string;
};

export type SharedTableWrite = {
  table: string;
  owners: string[];
  writers: TableWriter[];
};

/**
 * Sharing that is real, intentional, and cannot be removed without making
 * something else worse. Each needs a reason a reviewer can disagree with — an
 * entry without one is worse than no gate.
 */
export const DOCUMENTED_EXCEPTIONS: readonly {
  table: string;
  /**
   * The EXTRA writer being forgiven — never the table's real owner. Subtracted
   * from the owner set before the one-writer rule is applied, so the exception
   * buys exactly one more writer on exactly one table.
   *
   * The obvious alternative — listing every owner allowed to touch the table —
   * was written first and was wrong: naming `tenant_admin`, `profile_identity`
   * and `identity_access` together on `awcms_profiles` to excuse bootstrap also
   * silently re-permitted the `identity_access` write this change removed. The
   * gate's own test caught it. An exception must forgive a known writer, not
   * open a table to a group.
   */
  excusedOwner: string;
  reason: string;
}[] = [
  ...[
    "awcms_profiles",
    "awcms_identities",
    "awcms_tenant_users",
    "awcms_roles",
    "awcms_role_permissions",
    "awcms_access_assignments",
    // ADR-0078 moved the owner grant here. The exception moves WITH it rather
    // than being added beside it: leaving the old table listed after nothing
    // writes it would excuse a writer that no longer exists, and `sql/102` did
    // not change who bootstraps a tenant — only which table records it.
    "awcms_access_policies",
    "awcms_access_policy_events"
  ].map((table) => ({
    table,
    excusedOwner: "tenant_admin",
    reason:
      "`tenant_admin/application/platform-bootstrap.ts` is the one-time setup " +
      "wizard: it creates tenant, office, owner profile, identity, tenant-user, " +
      "role, and access assignment in a SINGLE transaction, before any of those " +
      "modules can be reached through their normal surfaces (there is no tenant " +
      "to scope to and no owner to authorize as until it finishes). Its own " +
      "header records the same decision and why it is not a `dependencies` " +
      "edge: declaring one would wrongly imply `tenant_admin` cannot function " +
      "without the other two enabled. Confined to that ONE file — a second " +
      "bootstrap-shaped writer is a finding, not a precedent."
  })),
  ...[
    "awcms_tenants",
    "awcms_channel_secrets",
    "awcms_channel_provider_connections",
    "awcms_channel_accounts",
    "awcms_channel_account_capabilities"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/security-readiness.ts` `probeSocialDispatchSecretVisibility` " +
      "(Issue #1145, M-1 of the PR #1261 audit) seeds a throwaway tenant and " +
      "negative channel rows inside ONE transaction that it ALWAYS rolls back " +
      "(it throws a sentinel), assumes `awcms_social_dispatch`, and proves the " +
      "role sees exactly one secret. Nothing it writes is ever committed, so it " +
      "is a behavioural probe of the row policy, not a second writer of these " +
      "tables."
  })),
  ...[
    "awcms_tenants",
    "awcms_channel_accounts",
    "awcms_channel_webhook_subscriptions",
    "awcms_email_provider_events"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/security-readiness.ts` `probeEmailProviderEventRetentionFloor` " +
      "(Issue #1161, M-3 of the PR #1272 audit) seeds a throwaway tenant, a " +
      "Mailketing account, a callback and four back-dated quarantine rows inside " +
      "ONE transaction that it ALWAYS rolls back (it throws a sentinel), assumes " +
      "`awcms_worker`, and proves the retention DELETE removes exactly the two " +
      "rows past their window. Nothing it writes is ever committed, so it is a " +
      "behavioural probe of the floor, not a second writer of these tables."
  })),
  ...[
    "awcms_tenants",
    "awcms_channel_accounts",
    "awcms_channel_provider_connections",
    "awcms_channel_secrets"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/lib/worker-secret-probe.ts` (used by `security:readiness`, Issue #1160 " +
      "audit M3) seeds one throwaway tenant, accounts, a connection and secrets " +
      "INSIDE a transaction it always rolls back, then reads them as " +
      "`awcms_worker` to measure the worker's real secret visibility. Nothing is " +
      "ever committed: it is a behavioural probe of a row policy, not a second " +
      "writer of tenant or channel-account data. Confined to that one function."
  })),
  ...[
    "awcms_tenants",
    "awcms_channel_secrets",
    "awcms_channel_accounts",
    "awcms_telegram_engagement_endpoints",
    "awcms_telegram_engagement_contacts",
    // The probe's `refused(...)` forged-opt-in attempt, run as the dispatch
    // role. It is NOT a seed: the database is expected to refuse it, and the
    // probe records a finding if it succeeds. It becomes visible only now that
    // the gate scans `scripts/**` (Issue #1268), and it is excused for the same
    // reason as the other refused writes, on this one table.
    "awcms_telegram_engagement_consents"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/lib/telegram-engagement-dispatch-probe.ts` (used by " +
      "`security:readiness`, Issue #1156, M-A/M-B of the PR #1260 re-audit) seeds " +
      "two throwaway tenants, channel secrets, customer bot accounts, webhook " +
      "endpoints and contacts INSIDE one transaction it always rolls back (it " +
      "throws a sentinel), then assumes `awcms_telegram_engagement_dispatch` to " +
      "prove what the role can see and that its forbidden writes are refused. " +
      "Nothing is ever committed: it is a behavioural probe of row policies, not " +
      "a second writer. Its attempted writes as the role (the forged consent " +
      "opt-in, domain events and deliveries) are expected to be REFUSED, never " +
      "succeed, and roll back with the rest."
  })),
  ...[
    "awcms_channel_webhook_subscriptions",
    "awcms_whatsapp_service_windows",
    "awcms_whatsapp_webhook_receipts"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/security-readiness.ts` `probeWorkerPurgeDeleteFloors` (Issue " +
      "#1143, L-2 of the PR #1267 review) seeds one fresh and one aged window " +
      "and webhook receipt (and the subscription a receipt references) inside " +
      "ONE transaction that it ALWAYS rolls back (it throws a sentinel), " +
      "assumes `awcms_worker`, and proves the role can delete exactly the aged " +
      "rows. Nothing it writes is ever committed, so it is a behavioural probe " +
      "of the purge-only DELETE policies, not a second writer of these tables."
  })),
  ...[
    "awcms_social_publications",
    "awcms_social_publish_jobs",
    "awcms_channel_account_health",
    "awcms_audit_events",
    "awcms_domain_events",
    "awcms_domain_event_deliveries"
  ].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/security-readiness.ts` `probeSocialDispatchWriteBoundary` " +
      "(Issue #1146, sql/373) seeds a throwaway tenant, a publication and jobs, " +
      "then, as `awcms_social_dispatch`, attempts the legitimate and the " +
      "forbidden writes (each in a savepoint) inside ONE transaction that it " +
      "ALWAYS rolls back (it throws a sentinel). Nothing it writes is ever " +
      "committed: a behavioural probe of the role's RESTRICTIVE write " +
      "policies, not a second writer of these tables."
  })),
  ...["awcms_blog_posts", "awcms_news_media_objects"].map((table) => ({
    table,
    excusedOwner: TOOLING,
    reason:
      "`scripts/security-readiness.ts` `probeSocialSourceRecheck` (Issue " +
      "#1145, ADR-0157 L8, sql/386) seeds two throwaway tenants with articles " +
      "and media objects in every state that matters INSIDE one transaction it " +
      "ALWAYS rolls back (it throws a sentinel), then, as " +
      "`awcms_social_dispatch`, asks the two SECURITY DEFINER re-check " +
      "functions for their verdicts and proves a direct read is refused. " +
      "Nothing it writes is ever committed: a behavioural probe of the " +
      "functions, not a second writer of posts or media."
  }))
];

function accountableOwners(table: string, owners: readonly string[]): string[] {
  const excused = new Set(
    DOCUMENTED_EXCEPTIONS.filter((entry) => entry.table === table).map(
      (entry) => entry.excusedOwner
    )
  );

  return owners.filter((owner) => !excused.has(owner));
}

/**
 * Directory name to descriptor key, taken from the IMPORTED descriptor — the
 * same derivation `tests/module-boundary.test.ts` uses, and for the same
 * reason: four modules assign `key` from a constant and one directory
 * (`workflow-approval`) does not match its key at all, so neither a string
 * transform nor a grep resolves them.
 */
async function directoryKeyMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for await (const file of new Bun.Glob("src/modules/*/module.ts").scan({
    cwd: process.cwd(),
    dot: true
  })) {
    const directory = file.split("/")[2]!;
    const exports: Record<string, unknown> = await import(
      `${process.cwd()}/${file}`
    );

    for (const value of Object.values(exports)) {
      const key = (value as { key?: unknown } | null)?.key;

      if (typeof key === "string") {
        map.set(directory, key);
        break;
      }
    }
  }

  return map;
}

/**
 * Attributes a file to the module accountable for it. Routes resolve through
 * `api.routes` (the same longest-prefix ownership `modules:routes:check`
 * enforces), so an `INSERT` in `src/pages/api/v1/auth/login.ts` counts as
 * `identity_access` rather than as a nameless second writer.
 */
export function ownerOfFile(
  file: string,
  directoryToKey: ReadonlyMap<string, string>,
  claims: readonly { prefix: string; moduleKey: string }[]
): string {
  if (file.startsWith("src/modules/")) {
    const directory = file.split("/")[2]!;

    return directoryToKey.get(directory) ?? `(unmapped: ${directory})`;
  }

  if (file.startsWith("src/pages/")) {
    return resolveOwner(routeOf(file), claims) ?? UNCLAIMED_ROUTE;
  }

  if (file.startsWith("src/lib/")) {
    return INFRASTRUCTURE;
  }

  return TOOLING;
}

/** The whole check, as a function, so a test can run it against planted input. */
export function findSharedTableWrites(
  writes: readonly { table: string; owner: string; file: string }[]
): SharedTableWrite[] {
  const byTable = new Map<string, TableWriter[]>();

  for (const write of writes) {
    const writers = byTable.get(write.table) ?? [];
    writers.push({ owner: write.owner, file: write.file });
    byTable.set(write.table, writers);
  }

  const shared: SharedTableWrite[] = [];

  for (const [table, writers] of [...byTable].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const owners = [...new Set(writers.map((writer) => writer.owner))].sort();

    if (accountableOwners(table, owners).length > 1) {
      shared.push({ table, owners, writers });
    }
  }

  return shared;
}

export async function collectTableWrites(): Promise<
  { table: string; owner: string; file: string }[]
> {
  const directoryToKey = await directoryKeyMap();
  const { claims } = collectClaims(listModules());
  const writes: { table: string; owner: string; file: string }[] = [];
  const seen = new Set<string>();

  for (const pattern of SOURCE_GLOBS) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: process.cwd()
    })) {
      // `_shared` is neutral ground by construction (it is where cross-module
      // contracts live), and no file in it writes a domain table today. Scoping
      // it out keeps a future shared helper from reading as a second owner of
      // every table its callers touch.
      if (file.includes("/_shared/") || seen.has(file)) {
        continue;
      }

      seen.add(file);
      const text = stripComments(await Bun.file(file).text());
      const owner = ownerOfFile(file, directoryToKey, claims);

      for (const match of text.matchAll(WRITE_PATTERN)) {
        writes.push({ table: match[1]!, owner, file });
      }
    }
  }

  return writes;
}

async function main(): Promise<void> {
  const writes = await collectTableWrites();
  const shared = findSharedTableWrites(writes);
  const tableCount = new Set(writes.map((write) => write.table)).size;

  if (shared.length > 0) {
    console.error(
      `modules:table-writes:check GAGAL — ${shared.length} tabel ditulis lebih dari satu pemilik (ADR-0013 §6 no shared-table write):`
    );

    for (const entry of shared) {
      console.error(`\n  ${entry.table} — ${entry.owners.join(" + ")}`);

      for (const writer of entry.writers) {
        console.error(`      ${writer.owner}: ${writer.file}`);
      }
    }

    console.error(
      "\nRoute tulisnya lewat modul pemilik tabel (lihat " +
        "`profile-identity/application/person-profile.ts` sebagai contoh), atau " +
        "tambahkan entri ber-alasan di DOCUMENTED_EXCEPTIONS."
    );
    process.exit(1);
  }

  console.log(
    `modules:table-writes:check OK — ${tableCount} tabel dengan tulis literal, tiap tabel satu pemilik ` +
      `(${DOCUMENTED_EXCEPTIONS.length} pengecualian ber-alasan). Tulis dinamis milik engine data-lifecycle/reporting ` +
      `sengaja di luar cakupan — lihat header berkas ini.`
  );
}

if (import.meta.main) {
  await main();
}

/**
 * Re-exported for the callers that already import it from here — finding D2
 * moved the implementation to `scripts/lib/source-text.ts` and left the name
 * reachable rather than editing 21 import lines in the same change.
 */
export { stripComments };
