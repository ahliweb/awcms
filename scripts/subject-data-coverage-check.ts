#!/usr/bin/env bun
/**
 * `bun run subject-data:coverage:check` — ADR-0094, Issue #542.
 *
 * Every `awcms_*` table must have ANSWERED the subject question. Not answered
 * it the same way — answered it at all.
 *
 * The question is one sentence: **how does this table answer about a data
 * subject.** Three answers are accepted and silence is not:
 *
 * - a `subjectData` descriptor — declared by the owning module, naming which
 *   column joins a row to the person, whether it exports, and what erasure
 *   means for it;
 * - `NO_SUBJECT_DATA` — a reasoned refusal, for a table that holds nothing
 *   about a person. A new entry is a sentence a reviewer can disagree with;
 * - `TABLES_PREDATING_THE_SUBJECT_RULE` — the tables that already existed. It
 *   may only SHRINK, and an entry that has since gained a descriptor is an
 *   error rather than a tolerated duplicate.
 *
 * ## Why this gate lands before any endpoint
 *
 * An export endpoint that landed first would export the tables its author
 * happened to remember and stay silent about the rest. A subject-access report
 * that is incomplete is worse than none, because it is signed. This makes
 * completeness a property the schema enforces rather than one a PR claims.
 *
 * The shape is `data-lifecycle:table-coverage:check` (#437) deliberately
 * copied, down to the table derivation, so there is one idea to learn and not
 * two that can drift apart.
 *
 * The ledger carries no per-entry reason, for the same reason its sibling
 * carries none: one reason covers all of them — they predate the rule — and
 * inventing 139 individual justifications would manufacture exactly the fiction
 * this file exists to avoid. Its length is a debt counter, printed on every run.
 *
 * Pure — reads `sql/` and the module registry, no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import { deriveTableRlsStates } from "./repo-inventory";

const MIGRATIONS_DIR = "sql";

/**
 * Tables that hold nothing about a person. **Reasoned refusals**, not a
 * convenience list: saying a catalogue of permission names is not personal data
 * is cheap; saying it about a table that turns out to carry an email address is
 * the failure this gate exists to make loud.
 */
export const NO_SUBJECT_DATA: readonly { table: string; reason: string }[] = [
  {
    table: "awcms_permissions",
    reason:
      "The global catalogue of permission NAMES, written only by migrations. Every row is a string an author chose; no column can be traced to a person, and none is scoped to a tenant."
  },
  {
    table: "awcms_entitlements",
    reason:
      "ADR-0084. The catalogue of entitlement names, migration-written and denied every write verb for `awcms_app`. A commercial capability name is not personal data."
  },
  {
    table: "awcms_plans",
    reason:
      "ADR-0084. One row per package an operator sells — a price and a name, both authored rather than observed."
  },
  {
    table: "awcms_schema_migrations",
    reason:
      "The migration ledger. It records which SQL file ran and when, which is a fact about the deployment and about nobody."
  }
];

/**
 * Tables that existed before the rule. One-way: it may shrink and never grow,
 * and its length is printed on every run so the debt stays visible instead of
 * becoming the background.
 */
export const TABLES_PREDATING_THE_SUBJECT_RULE: readonly string[] = [
  "awcms_abac_decision_logs",
  "awcms_abac_policies",
  "awcms_access_assignments",
  "awcms_access_policies",
  "awcms_access_policy_events",
  "awcms_audit_events",
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
  "awcms_comments_abuse_events",
  "awcms_comments_comments",
  "awcms_comments_moderation_events",
  "awcms_comments_reply_subscriptions",
  "awcms_comments_reports",
  "awcms_comments_settings",
  "awcms_comments_threads",
  "awcms_data_lifecycle_archive_manifests",
  "awcms_data_lifecycle_cursors",
  "awcms_data_lifecycle_legal_holds",
  "awcms_data_lifecycle_runs",
  "awcms_delegated_access_grants",
  "awcms_domain_event_activity_daily",
  "awcms_domain_event_consumer_effects",
  "awcms_domain_event_consumer_state",
  "awcms_domain_event_deliveries",
  "awcms_domain_event_replays",
  "awcms_domain_events",
  "awcms_edge_cache_purges",
  "awcms_email_delivery_attempts",
  "awcms_email_messages",
  "awcms_email_suppression_list",
  "awcms_email_templates",
  "awcms_external_identities",
  "awcms_form_drafts",
  "awcms_idempotency_keys",
  "awcms_identity_mfa_factors",
  "awcms_identity_mfa_recovery_codes",
  "awcms_idn_admin_regions",
  "awcms_idn_region_datasets",
  "awcms_invitation_policies",
  "awcms_invitations",
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
  "awcms_object_sync_queue",
  "awcms_offices",
  "awcms_oidc_auth_requests",
  "awcms_partner_managed_tenants",
  "awcms_partners",
  "awcms_password_reset_tokens",
  "awcms_plan_entitlements",
  "awcms_principal_mfa_factors",
  "awcms_principal_mfa_recovery_codes",
  "awcms_principals",
  "awcms_profile_entity_links",
  "awcms_profile_identifiers",
  "awcms_profiles",
  "awcms_push_delivery_attempts",
  "awcms_push_messages",
  "awcms_push_subscriptions",
  "awcms_registration_requests",
  "awcms_reporting_export_runs",
  "awcms_reporting_projection_cursors",
  "awcms_reporting_projection_metrics",
  "awcms_reporting_projection_state",
  "awcms_reporting_rebuild_runs",
  "awcms_reporting_reconciliation_runs",
  "awcms_reporting_scheduled_exports",
  "awcms_role_permissions",
  "awcms_roles",
  "awcms_seo_not_found_observations",
  "awcms_seo_redirect_settings",
  "awcms_seo_redirects",
  "awcms_seo_tenant_settings",
  "awcms_session_handoff_codes",
  "awcms_setup_state",
  "awcms_sidebar_menu_items",
  "awcms_sidebar_menu_types",
  "awcms_site_search_documents",
  "awcms_site_search_index_failures",
  "awcms_site_search_index_runs",
  "awcms_site_search_query_log",
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
  "awcms_tenant_entitlements",
  "awcms_tenant_mfa_policies",
  "awcms_tenant_modules",
  "awcms_tenant_settings",
  "awcms_tenant_status_transitions",
  "awcms_tenant_subscriptions",
  "awcms_tenants",
  "awcms_theming_config_versions",
  "awcms_theming_preview_sessions",
  "awcms_theming_tenant_state",
  "awcms_user_group_members",
  "awcms_user_groups",
  "awcms_visit_events",
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

export type SubjectCoverageInput = {
  tables: readonly string[];
  described: readonly string[];
  noSubjectData: readonly { table: string; reason: string }[];
  ledger: readonly string[];
};

export type SubjectCoverageProblem = { table: string; message: string };

/**
 * Five ways this can be wrong, and four of them are about the LEDGER — a
 * one-way list that is allowed to rot is just a list.
 */
export function findSubjectCoverageProblems(
  input: SubjectCoverageInput
): SubjectCoverageProblem[] {
  const tables = new Set(input.tables);
  const described = new Set(input.described);
  const ledger = new Set(input.ledger);
  const refused = new Map(
    input.noSubjectData.map((entry) => [entry.table, entry.reason])
  );
  const problems: SubjectCoverageProblem[] = [];

  for (const table of input.tables) {
    if (described.has(table) || refused.has(table) || ledger.has(table)) {
      continue;
    }

    problems.push({
      table,
      message:
        `\`${table}\` ada di \`sql/\` tetapi tidak pernah menjawab pertanyaan subjek data. ` +
        "Deklarasikan deskriptor `subjectData` di modul pemiliknya, atau — bila " +
        "tabelnya memang tidak memuat apa pun tentang seseorang — tambahkan ke " +
        "`NO_SUBJECT_DATA` beserta alasannya. " +
        "`TABLES_PREDATING_THE_SUBJECT_RULE` TERTUTUP untuk tabel baru."
    });
  }

  for (const table of input.ledger) {
    if (!tables.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` ada di ledger tetapi tidak ada lagi di \`sql/\`. Hapus entrinya — ` +
          "ledger yang memuat tabel hantu berhenti bisa dipercaya sebagai hitungan utang."
      });
      continue;
    }

    if (described.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` kini punya deskriptor \`subjectData\` DAN masih ada di ledger. ` +
          "Hapus entri ledger-nya di PR yang sama — ledger ini hanya boleh MENYUSUT, " +
          "dan utang yang sudah dibayar tetapi masih tercatat membuat angkanya bohong."
      });
    }
  }

  for (const [table, reason] of refused) {
    if (!tables.has(table)) {
      problems.push({
        table,
        message: `\`${table}\` ada di \`NO_SUBJECT_DATA\` tetapi tidak ada di \`sql/\`.`
      });
    }

    if (reason.trim().length === 0) {
      problems.push({
        table,
        message:
          `\`${table}\` dikecualikan tanpa alasan. Pengecualian tanpa alasan lebih ` +
          "buruk daripada tidak ada gerbang."
      });
    }

    if (ledger.has(table)) {
      problems.push({
        table,
        message:
          `\`${table}\` ada di \`NO_SUBJECT_DATA\` DAN di ledger. ` +
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

export function collectSubjectDescribedTables(): string[] {
  return listModules().flatMap((module) =>
    (module.subjectData ?? []).map((descriptor) => descriptor.tableName)
  );
}

function main(): void {
  const tables = collectTables();
  const described = collectSubjectDescribedTables();
  const problems = findSubjectCoverageProblems({
    tables,
    described,
    noSubjectData: NO_SUBJECT_DATA,
    ledger: TABLES_PREDATING_THE_SUBJECT_RULE
  });

  if (problems.length === 0) {
    console.log(
      `subject-data:coverage:check OK — ${tables.length} tabel: ` +
        `${described.length} berdeskriptor, ${NO_SUBJECT_DATA.length} ditolak ` +
        `beralasan, ${TABLES_PREDATING_THE_SUBJECT_RULE.length} masih berutang.`
    );
    return;
  }

  console.error(
    `subject-data:coverage:check GAGAL — ${problems.length} temuan:`
  );
  for (const problem of problems) {
    console.error(`  - ${problem.message}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
