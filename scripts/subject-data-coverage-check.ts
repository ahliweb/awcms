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
