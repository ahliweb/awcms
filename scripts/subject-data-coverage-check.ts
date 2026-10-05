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
 *   error rather than a tolerated duplicate. **It is now EMPTY** (Issue #557):
 *   the 139 tables it carried have each answered, so there is no table left in
 *   this schema whose answer is "it was here first".
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
 * The ledger carried no per-entry reason, for the same reason its sibling
 * carries none: one reason covered all of them — they predated the rule — and
 * inventing 139 individual justifications would have manufactured exactly the
 * fiction this file exists to avoid. Its length was a debt counter, printed on
 * every run, and Issue #557 paid it down to nothing.
 *
 * ## What an empty ledger changes
 *
 * It is deliberately kept as an empty array rather than deleted, because the
 * gate's shape is what makes the guarantee hold: with nothing in it, EVERY
 * table must produce a descriptor or a reasoned refusal, and re-adding a line
 * is an edit somebody has to make on purpose in a file whose only content is
 * work not done. Deleting the export would remove the place where that
 * regression would have to be written down.
 *
 * Zero is also the precondition Issue #557's export endpoint needed. A
 * subject-access report assembled while 139 tables had never answered would
 * have been complete-looking and wrong — signed, which is worse than absent.
 * Completeness is now a property the schema enforces rather than one a PR
 * claims.
 *
 * Pure — reads `sql/` and the module registry, no database.
 */

import { listModules } from "../src/modules";
import { loadMigrations } from "./lib/migrations";
import { deriveTableRlsStates } from "./lib/table-rls-states";

/**
 * Tables that hold nothing about a person. **Reasoned refusals**, not a
 * convenience list: saying a catalogue of permission names is not personal data
 * is cheap; saying it about a table that turns out to carry an email address is
 * the failure this gate exists to make loud.
 */
export const NO_SUBJECT_DATA: readonly { table: string; reason: string }[] = [
  {
    table: "awcms_site_profile",
    reason:
      "ADR-0102. One row per TENANT holding the PUBLISHER's own published identity — masthead tagline, footer copyright, editorial address, and the contact channels the newsroom prints on its own contact page. It records nothing the tenant holds ABOUT a third party, which is what a subject-access request asks for; a reader exercising their rights against this site is not asking for the site's own address. The honest edge case, stated rather than skipped: a small newsroom may type a person's address into `contact_email` or `whatsapp_number`. That value is still the publisher's own, published deliberately by the person who typed it, and erasing it is editing the field on `/admin/site-profile` — not a subject-rights workflow, which would have no way to distinguish it from the masthead it sits beside. It is also why the audit row for a change records WHICH FIELDS are set and never their values: the values do not need a second copy in a store more people read."
  },
  {
    table: "awcms_inventory_balances",
    reason:
      "ADR-0126 / Issue #887. A derived read model of stock quantities: tenant, location, an OPAQUE consumer item reference, a unit, a decimal and a threshold. No column can be traced to a person — there is no actor stamp on the row at all (the actor is on the immutable movement that changed it, which is answered by its own descriptor). The one residual risk is the consumer's choice of `item_ref`: ADR-0126 §8 requires it to be an opaque catalogue key, never a person's name or an identifier of one, and the validators bound its alphabet but cannot read its meaning."
  },
  {
    table: "awcms_inventory_low_stock_signals",
    reason:
      "ADR-0126 / Issue #887. An append-only log of a balance crossing its low-stock line: tenant, location, opaque item reference, a kind and two decimals. No actor, no free text, nothing about a person — it records what happened to goods. Immutable by trigger, so there is also nothing an erasure could rewrite."
  },
  {
    table: "awcms_procurement_settings",
    reason:
      "ADR-0128 / Issue #888. One row per tenant holding the document approval threshold — a decimal. The only person-shaped column is the `updated_by` stamp on a configuration row, which is the tenant's own setting, not data it holds about someone."
  },
  {
    table: "awcms_procurement_supplier_labels",
    reason:
      "ADR-0128 / Issue #888. A supplier's category and tag labels: tenant, supplier id, a kind and a lower-case label of at most 64 characters. No actor, no free text, nothing that can name a person; it classifies a vendor."
  },
  {
    table: "awcms_procurement_document_lines",
    reason:
      "ADR-0128 / Issue #888. Line snapshots of a purchase or stock-movement document: opaque item reference, SKU, item name, unit and exact quantity/cost. No actor stamp and no person column — the actor is on the parent document, which has its own descriptor. Immutable once the document leaves draft, so there is nothing an erasure could rewrite."
  },
  {
    table: "awcms_procurement_document_movements",
    reason:
      "ADR-0128 / Issue #888. Append-only links from a document line to inventory ledger movement ids: tenant, document id, line number, an operation and a movement id. No actor and no free text; the person who posted is on the ledger movement and the document, each with its own descriptor."
  },
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
    table: "awcms_omes_repository_progress_config",
    reason:
      'Issue ahliweb/omes#249, ADR-0030. Holds only a tenant-chosen GitHub repository identifier (owner/name, both public GitHub org/repo slugs the tenant selected) and an OPTIONAL `secret_ref` INDIRECTION ({"store":"env","key":"OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN"}, never a raw token — sql/166\'s CHECK constraint enforces the one supported literal shape). Nothing here identifies a person; it identifies a repository.'
  },
  {
    table: "awcms_omes_repository_progress",
    reason:
      "Issue ahliweb/omes#249, ADR-0030. A GitHub milestone/issue PROGRESS BOARD projection — number, title, state, label names, derived kind, html_url, updated_at. Deliberately excludes issue bodies, comments, and assignee/author identity by construction (domain/repository-progress.ts's mapping functions never read those GitHub API fields, and every stored payload is validated against the vendored, additionalProperties:false repository-progress-view schema before it is stored) — see ADR-0030's own PII boundary. A GitHub issue TITLE could theoretically mention a person's name as free text, the same residual risk any commit-message-shaped or ticket-title-shaped field carries across this codebase; it is not treated as subject data any more than an audit log's own free-text message field is."
  },
  {
    table: "awcms_schema_migrations",
    reason:
      "The migration ledger. It records which SQL file ran and when, which is a fact about the deployment and about nobody."
  },
  {
    table: "awcms_plan_entitlements",
    reason:
      "ADR-0084. The join between a plan and the entitlements it carries — two catalogue keys per row, both authored by an operator rather than observed about anyone."
  },
  {
    table: "awcms_edge_cache_purges",
    reason:
      "ADR-0042. A queue of surrogate keys the edge cache must invalidate. A surrogate key names a CONTENT surface, never a visitor, and the rows are written by infrastructure in `src/lib/` that no module owns."
  },
  {
    table: "awcms_idempotency_keys",
    reason:
      "The replay guard for high-risk mutations: a scope, a key, a request hash and the response that was returned. It holds no column linking a row to a person — the key is chosen by the CALLER and the tenant is the only identity on it — so no subject request can find its rows. The cached `response_body` can echo personal data from the mutation it replays, which is why this table carries a short retention of its own rather than a subject answer it cannot honour."
  },
  {
    table: "awcms_omes_servers",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). One row per enrolled OMES host server machine. Records hardware specs, OS version, kernel, and machine public key. Holds no personal data about natural persons or visitors."
  },
  {
    table: "awcms_omes_enrollments",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Host enrollment tokens and machine public key verification hashes. Machine cryptographic credentials, not personal data."
  },
  {
    table: "awcms_omes_deployments",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Per-server desired vs observed deployment state specs and drift status. Operational infrastructure configuration, not personal data."
  },
  {
    table: "awcms_omes_operation_requests",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Server operation requests (apply, reconcile, rollback, restart). Holds allowlisted operational parameters and machine IDs, not personal data."
  },
  {
    table: "awcms_omes_jobs",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Worker dispatch queue for OMES pull workers. Contains operation payloads, execution leases, and host status, not personal data."
  },
  {
    table: "awcms_omes_health_snapshots",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Periodic host health metrics (CPU, memory, disk, service status). Pure infrastructure telemetry, not personal data."
  },
  {
    table: "awcms_omes_backup_snapshots",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Server backup manifest metadata and SHA-256 verification checksums for disaster recovery, not personal data."
  },
  {
    table: "awcms_omes_audit_projections",
    reason:
      "ADR-0122 (Issue ahliweb/omes#196). Projected audit evidence of host-level mutations and system actions performed by OMES pull workers, not visitor or subscriber personal data."
  },
  {
    table: "awcms_omes_worker_nonces",
    reason:
      "ADR-0122 (Issue ahliweb/omes#199). Replay-protection nonces consumed by the OMES host pull worker's poll/result/heartbeat requests — a machine identity, tenant, server, and a random nonce string. Holds no personal data about a natural person."
  },
  {
    table: "awcms_omes_worker_results",
    reason:
      "ADR-0122 (Issue ahliweb/omes#199). Worker-reported job execution results (operation, state, evidence) from the OMES pull worker. Operational infrastructure evidence about a host/job, not personal data — evidence is additionally passed through redactSensitiveAttributes before persistence."
  },
  {
    table: "awcms_omes_ai_privacy_posture",
    reason:
      "ADR-0122, OMES ADR-0029 (Issue ahliweb/omes#232). One row per (tenant, server, deployment) AI privacy posture projection — classification mode, destination class, status, and reason codes describing a HOST's AI egress posture. Bounded infrastructure/governance metadata only; structurally excludes prompt/transcript/credential content (additionalProperties:false in the vendored schema). Holds no personal data about a natural person."
  },
  {
    table: "awcms_omes_ai_egress_approvals",
    reason:
      "ADR-0122, OMES ADR-0029 (Issue ahliweb/omes#232). AI egress owner-approval requests — classification/destination/reason_code and a short operator justification note, keyed by server. `requested_by_tenant_user_id` is the same shape `awcms_omes_operation_requests.requested_by`/`approved_by` already carries (operator attribution, not a subject of the data), covered by the same reasoning above."
  },
  {
    table: "awcms_omes_hermes_orchestration_trees",
    reason:
      "ADR-0028, ADR-0017 (Issue ahliweb/omes#246, OMES issue #183). One current row per (tenant, server, session) live Hermes delegated-task/subagent tree snapshot — subagent ids, roles, bounded goal/summary strings, states, and timings describing a HOST's Hermes orchestration run. Every identifier is opaque machine correlation state, not a natural person; `nodes` is validated against the vendored `hermes-orchestration-tree` schema (`additionalProperties:false`), which structurally excludes prompt/transcript/tool-argument content. Holds no personal data about a natural person."
  },
  {
    table: "awcms_omes_hermes_orchestration_events",
    reason:
      "ADR-0028, ADR-0017 (Issue ahliweb/omes#246, OMES issue #183). Append-only Hermes subagent lifecycle activity log — same bounded metadata shape (and same schema-enforced exclusion of prompt/transcript/tool-argument content) as the tree snapshot above, one row per reported lifecycle event. Holds no personal data about a natural person."
  }
];

/**
 * Tables that existed before the rule. One-way: it may shrink and never grow,
 * and its length is printed on every run so the debt stays visible instead of
 * becoming the background.
 */
export const TABLES_PREDATING_THE_SUBJECT_RULE: readonly string[] = [];

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
  return deriveTableRlsStates(loadMigrations()).map((state) => state.table);
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
