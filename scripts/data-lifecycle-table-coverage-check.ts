#!/usr/bin/env bun
/**
 * `bun run data-lifecycle:table-coverage:check` — issue #437.
 *
 * Every `awcms_*` table must have ANSWERED the retention question. Not
 * answered it the same way — answered it at all.
 *
 * ## Why this is not the gate the issue asked for
 *
 * #437 asked for a gate over "high-volume tables" whose list is DERIVED rather
 * than hand-written, because a hand-written list is green forever for the
 * high-volume table nobody remembered to add. That reasoning still holds. What
 * does not hold is the premise that such a derivation exists here. Three were
 * built and measured against this schema before this one:
 *
 * 1. **Append-only in source** (a table the code only ever `INSERT`s into).
 *    46 tables, and wrong in both directions: `INSERT … ON CONFLICT DO UPDATE`
 *    reads as an append while being a bounded upsert, and the retention engine
 *    deletes through an interpolated `${tableName}` the scanner cannot see.
 * 2. **No deletion path** (never `DELETE`d, no cascading parent). 94 tables —
 *    because this schema uses `ON DELETE CASCADE` in exactly ONE migration, so
 *    "no cascade" describes almost everything and distinguishes nothing.
 * 3. **Unbounded by schema** (no UNIQUE constraint over entity columns). 121 of
 *    128. Real bounded tables key on curated text (`module_key`, `slug`,
 *    `tenant_code`), which is not a foreign key and cannot be told apart from a
 *    free-form value by looking at the DDL.
 *
 * A gate whose exemption list is 90% of the schema is the hand-written list
 * wearing a costume. So the question changed: instead of deriving WHICH tables
 * are high-volume — which requires knowing how the product is used — derive
 * only that a table EXISTS, and make the obligation impossible to skip.
 *
 * ## The shape, and why forgetting is impossible
 *
 * The table set comes from `sql/` via `deriveTableRlsStates` — the same
 * function `repo:inventory` uses, deliberately, so there is one answer to "what
 * tables are there" and not two that can drift.
 *
 * A table passes three ways, and a NEW table has only two of them:
 *
 * - a `dataLifecycle` descriptor — declared by the owning module, or (ADR-0076)
 *   in `INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS` when the table is owned by
 *   `src/lib/` and has no module to declare it. `data-lifecycle:registry:check`
 *   validates the contents of both and proves the second kind really is
 *   infrastructure-owned; this gate only asks whether one exists;
 * - `BOUNDED_BY_DESIGN` — a reasoned refusal. **Starts empty.** A new bounded
 *   table joins it with a sentence a reviewer can disagree with;
 * - `TABLES_PREDATING_THE_RULE` — the 114 tables that already existed. It may
 *   only SHRINK, and an entry that has since gained a descriptor is an error,
 *   not a tolerated duplicate.
 *
 * The ledger carries no per-entry reason on purpose. One reason covers all of
 * them — they predate the rule — and inventing 114 individual justifications
 * would manufacture exactly the fiction this file exists to avoid. Its length
 * is a debt counter, printed on every run.
 *
 * What this cannot do is tell you that an EXISTING table on that ledger is
 * quietly eating the disk. It was never going to: that is a question about
 * traffic, and the honest place to answer it is `security:readiness` against a
 * real database, not a pure gate in the `check` chain.
 *
 * Pure: reads `sql/`, `listModules()`, and the infrastructure registry. No
 * database, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import { INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS } from "../src/modules/data-lifecycle/domain/infrastructure-lifecycle-registry";
import { deriveTableRlsStates } from "./repo-inventory";

const MIGRATIONS_DIR = "sql";

/**
 * A table whose row count is bounded by something other than time, declared
 * deliberately. **Empty, and meant to stay short.**
 *
 * An entry here says "this will not grow without bound, and here is why" — a
 * claim a reviewer can dispute. It is not a place to park a table because
 * writing the descriptor was inconvenient; a table that grows with traffic and
 * sits here is a lie that reads as a decision, which is worse than no entry.
 */
export const BOUNDED_BY_DESIGN: readonly {
  table: string;
  reason: string;
}[] = [
  {
    table: "awcms_access_policies",
    reason:
      "ADR-0078. Every row is created by an ADMINISTRATOR granting a role at a scope, never by traffic, and the active partial unique index means a subject can hold a given (role, scope) at most once at a time — so the ordinary ceiling is users x roles x scopes, all human-authored. Growth past that requires somebody granting and revoking the same thing repeatedly, which is an audit signal rather than load. An age-based purge would be actively WRONG here: `executionMode: 'generic'` deletes purely by age with no status predicate, so it would delete LIVE grants, and a revoked row is the only record that answers 'did this person have access last March' — the question an audit actually asks. Its two siblings `awcms_access_assignments` and `awcms_business_scope_assignments` sit on the predating ledger for want of the same answer; this one states it."
  },
  {
    table: "awcms_access_policy_events",
    reason:
      "ADR-0078, and bounded by the table above rather than independently: append-only, at most three rows per policy (granted / revoked / expired), so its ceiling is a small multiple of a bound that is already human-authored. Given a retention policy it would be a grant PROVENANCE trail that forgets who widened someone's access, which is the one question the trail exists to answer — and its exact sibling `awcms_business_scope_assignment_events` has no retention either, so a rule applied here and not there would be a difference nobody could defend. Reviewed together with the live table on purpose: a table and its history treated differently is worse than either treatment."
  }
];

/**
 * The tables that existed when this rule landed. **May only shrink.**
 *
 * Not a judgement about any of them — the opposite. Nobody asked the retention
 * question of these, and this gate does not pretend to answer it retroactively.
 * What it does is make the next table unable to skip the question.
 */
export const TABLES_PREDATING_THE_RULE: readonly string[] = [
  "awcms_abac_policies",
  "awcms_access_assignments",
  "awcms_auth_providers",
  "awcms_bff_clients",
  "awcms_blog_ad_placements",
  "awcms_blog_ads",
  "awcms_blog_internal_tag_link_settings",
  "awcms_blog_menu_items",
  "awcms_blog_menus",
  "awcms_blog_pages",
  "awcms_blog_post_terms",
  "awcms_blog_posts",
  "awcms_blog_redirects",
  "awcms_blog_revisions",
  "awcms_blog_settings",
  "awcms_blog_templates",
  "awcms_blog_terms",
  "awcms_blog_theme_settings",
  "awcms_blog_widgets",
  "awcms_business_scope_assignment_events",
  "awcms_business_scope_assignments",
  "awcms_comments_moderation_events",
  "awcms_comments_reports",
  "awcms_comments_settings",
  "awcms_comments_threads",
  "awcms_data_lifecycle_archive_manifests",
  "awcms_data_lifecycle_cursors",
  "awcms_data_lifecycle_legal_holds",
  "awcms_domain_event_activity_daily",
  "awcms_domain_event_consumer_effects",
  "awcms_domain_event_consumer_state",
  "awcms_domain_event_replays",
  "awcms_domain_events",
  "awcms_email_suppression_list",
  "awcms_email_templates",
  "awcms_external_identities",
  "awcms_idempotency_keys",
  "awcms_identities",
  "awcms_identity_mfa_factors",
  "awcms_identity_mfa_recovery_codes",
  "awcms_idn_admin_regions",
  "awcms_idn_region_datasets",
  "awcms_machine_credentials",
  "awcms_media_library_tenant_state",
  "awcms_mfa_challenges",
  "awcms_module_dependencies",
  "awcms_module_health_checks",
  "awcms_module_jobs",
  "awcms_module_navigation",
  "awcms_module_settings",
  "awcms_modules",
  "awcms_news_media_objects",
  "awcms_news_portal_ad_placements",
  "awcms_news_portal_homepage_sections",
  "awcms_offices",
  "awcms_oidc_auth_requests",
  "awcms_permissions",
  "awcms_profile_entity_links",
  "awcms_profile_identifiers",
  "awcms_profiles",
  "awcms_reporting_export_runs",
  "awcms_reporting_projection_cursors",
  "awcms_reporting_projection_metrics",
  "awcms_reporting_projection_state",
  "awcms_reporting_rebuild_runs",
  "awcms_reporting_reconciliation_runs",
  "awcms_reporting_scheduled_exports",
  "awcms_role_permissions",
  "awcms_roles",
  "awcms_schema_migrations",
  "awcms_seo_redirect_settings",
  "awcms_seo_redirects",
  "awcms_seo_tenant_settings",
  "awcms_session_handoff_codes",
  "awcms_sessions",
  "awcms_setup_state",
  "awcms_sidebar_menu_items",
  "awcms_sidebar_menu_types",
  "awcms_site_search_documents",
  "awcms_site_search_index_runs",
  "awcms_site_search_settings",
  "awcms_sod_conflict_evaluations",
  "awcms_sod_conflict_exceptions",
  "awcms_sync_aggregate_versions",
  "awcms_sync_conflicts",
  "awcms_sync_inbox",
  "awcms_sync_nodes",
  "awcms_sync_push_batches",
  "awcms_tenant_auth_policies",
  "awcms_tenant_domains",
  "awcms_tenant_mfa_policies",
  "awcms_tenant_modules",
  "awcms_tenant_settings",
  "awcms_tenant_status_transitions",
  "awcms_tenant_users",
  "awcms_tenants",
  "awcms_theming_config_versions",
  "awcms_theming_preview_sessions",
  "awcms_theming_tenant_state",
  "awcms_visitor_daily_rollups",
  "awcms_visitor_sessions",
  "awcms_workflow_decisions",
  "awcms_workflow_definitions",
  "awcms_workflow_delegations",
  "awcms_workflow_instances",
  "awcms_workflow_join_arrivals",
  "awcms_workflow_task_assignments",
  "awcms_workflow_tasks"
];

export type CoverageInput = {
  tables: readonly string[];
  described: readonly string[];
  boundedByDesign: readonly { table: string; reason: string }[];
  ledger: readonly string[];
};

export type CoverageProblem = { table: string; message: string };

/**
 * Five ways this can be wrong, and every one of them fails the gate. Four of
 * them are about the LEDGER rather than the tables — a one-way list that is
 * allowed to rot is just a list.
 */
export function findCoverageProblems(input: CoverageInput): CoverageProblem[] {
  const tables = new Set(input.tables);
  const described = new Set(input.described);
  const ledger = new Set(input.ledger);
  const bounded = new Map(
    input.boundedByDesign.map((entry) => [entry.table, entry.reason])
  );
  const problems: CoverageProblem[] = [];

  for (const table of input.tables) {
    if (described.has(table) || bounded.has(table) || ledger.has(table)) {
      continue;
    }

    problems.push({
      table,
      message:
        `\`${table}\` ada di \`sql/\` tetapi tidak pernah menjawab pertanyaan retensi. ` +
        "Deklarasikan deskriptor `dataLifecycle` di modul pemiliknya, atau — bila " +
        "pertumbuhannya memang dibatasi sesuatu selain waktu — tambahkan ke " +
        "`BOUNDED_BY_DESIGN` beserta alasannya. `TABLES_PREDATING_THE_RULE` " +
        "TERTUTUP untuk tabel baru."
    });
  }

  for (const table of input.ledger) {
    if (!tables.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` ada di \`TABLES_PREDATING_THE_RULE\` tetapi tidak ada lagi di \`sql/\`. ` +
          "Hapus entrinya — ledger yang memuat tabel hantu berhenti bisa dipercaya " +
          "sebagai hitungan utang."
      });
      continue;
    }

    if (described.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` kini punya deskriptor \`dataLifecycle\` DAN masih ada di ` +
          "`TABLES_PREDATING_THE_RULE`. Hapus entri ledger-nya di PR yang sama — " +
          "ledger ini hanya boleh MENYUSUT, dan utang yang sudah dibayar tetapi " +
          "masih tercatat membuat angkanya bohong."
      });
    }
  }

  for (const [table, reason] of bounded) {
    if (!tables.has(table)) {
      problems.push({
        table,
        message: `\`${table}\` ada di \`BOUNDED_BY_DESIGN\` tetapi tidak ada di \`sql/\`.`
      });
    }

    if (reason.trim().length === 0) {
      problems.push({
        table,
        message:
          `\`${table}\` dikecualikan lewat \`BOUNDED_BY_DESIGN\` tanpa alasan. ` +
          "Pengecualian tanpa alasan lebih buruk daripada tidak ada gerbang."
      });
    }

    if (ledger.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` ada di \`BOUNDED_BY_DESIGN\` DAN di \`TABLES_PREDATING_THE_RULE\`. ` +
          "Dua jawaban untuk satu pertanyaan — pilih satu."
      });
    }
  }

  return problems;
}

export function collectTables(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  return deriveTableRlsStates(
    files.map((name) => ({
      name,
      sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")
    }))
  ).map((state) => state.table);
}

/**
 * Both registries — a table has answered the question wherever its descriptor
 * lives (ADR-0076).
 *
 * Reading only `listModules()` here was correct while modules were the only
 * source. Left that way after the infrastructure registry landed, it would have
 * counted `awcms_edge_cache_purges` as undescribed while its descriptor sat
 * right there — a gate telling the truth about the wrong thing.
 */
export function collectDescribedTables(): string[] {
  return [
    ...listModules().flatMap((module) =>
      (module.dataLifecycle ?? []).map((descriptor) => descriptor.tableName)
    ),
    ...INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.map(
      (descriptor) => descriptor.tableName
    )
  ];
}

function main(): void {
  const tables = collectTables();
  const described = collectDescribedTables();
  const problems = findCoverageProblems({
    tables,
    described,
    boundedByDesign: BOUNDED_BY_DESIGN,
    ledger: TABLES_PREDATING_THE_RULE
  });

  if (problems.length === 0) {
    console.log(
      `data-lifecycle:table-coverage:check OK — ${tables.length} tabel: ` +
        `${described.length} berdeskriptor, ${BOUNDED_BY_DESIGN.length} dikecualikan ` +
        `beralasan, ${TABLES_PREDATING_THE_RULE.length} utang warisan (hanya boleh menyusut).`
    );
    return;
  }

  console.error("data-lifecycle:table-coverage:check GAGAL —");
  for (const problem of problems) {
    console.error(`  ${problem.message}`);
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
