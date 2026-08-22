#!/usr/bin/env bun
/**
 * `bun run subject-data:registry:check` — ADR-0094 wave 2, Issue #557.
 *
 * `subject-data:coverage:check` asks whether every table ANSWERED. This asks
 * whether the answers are TRUE.
 *
 * The distinction is the whole reason this file exists, and this repo has paid
 * for learning it more than once: a coverage gate can be green while every
 * answer under it is wrong. A descriptor naming a column the table does not
 * have produces an export that reads zero rows and reports success. One that
 * forgets `redactedColumns` names a real column produces an export that carries
 * a token hash. One that claims `tenantColumn: null` for a table that does have
 * a `tenant_id` silently removes that table from every per-tenant answer, and
 * the operator reads it as "global, out of scope" instead of "missing".
 *
 * None of those is visible in review — they are all one plausible-looking
 * string — and all of them fail SILENTLY at runtime, in the direction of a
 * report that is signed and incomplete.
 *
 * So this gate resolves every descriptor against `sql/` and refuses anything it
 * cannot prove. Pure: reads `sql/` and the module registry, no database.
 */

import { loadMigrations } from "./lib/migrations";
import { listModules } from "../src/modules";
import type { SubjectDataDescriptor } from "../src/modules/_shared/module-contract";

/**
 * The descriptor `severed_with_subject_row` depends on: anonymising THIS table
 * is what makes ~90 stamp columns stop resolving to a person.
 *
 * Checked rather than assumed, because the dependency runs the wrong way for
 * review to catch. If somebody later changed `identity_access.identities` to
 * `hard_delete` or `retain_under_obligation`, every one of those ninety
 * descriptors would keep saying "already severed" and none of them would be —
 * a whole schema's worth of erasure quietly becoming a no-op, with no edit
 * anywhere near the tables it broke.
 */
const SEVERANCE_ANCHOR_TABLE = "awcms_identities";

/**
 * The single column `runSubjectErasure` writes for a
 * `status_transition_then_purge` descriptor.
 *
 * Named here rather than left implicit in the executor, because the coupling is
 * invisible from both sides: the descriptor says "flip a status" without saying
 * WHICH, and the executor writes one hard-coded column. A future descriptor
 * choosing that mode on a table without this column would fail in the middle of
 * an erasure, after the request had already been claimed.
 */
const STATUS_TRANSITION_COLUMN = "revoked_at";

export type TableColumns = ReadonlyMap<string, ReadonlySet<string>>;

/** `"<table>.<column>"` -> the table its foreign key points at. */
export type ForeignKeyTargets = ReadonlyMap<string, string>;

/** What each `SubjectDataColumn.references` value claims the column points at. */
const REFERENCE_TARGET_TABLE = {
  tenant_user: "awcms_tenant_users",
  identity: "awcms_identities",
  profile: "awcms_profiles",
  principal: "awcms_principals"
} as const;

/**
 * Resolve the declared foreign key of every column, so `references` can be
 * checked against the schema instead of against the author's memory.
 *
 * This is the exact trap ADR-0094 names: `awcms_sessions` reaches the person
 * through `identity_id` while `awcms_audit_events` reaches them through
 * `actor_tenant_user_id`, and a descriptor that swaps them binds a valid uuid
 * to the wrong column — no error, no empty-result signal, just an export that
 * returns nothing and an erasure that erases nothing.
 *
 * Only checkable where a foreign key exists. Most `created_by`-style stamps in
 * this schema are bare `uuid` columns with no FK, and the gate says so rather
 * than pretending to have verified them.
 */
export function parseForeignKeyTargets(
  files: readonly { name: string; sql: string }[]
): Map<string, string> {
  const targets = new Map<string, string>();

  for (const file of files) {
    for (const match of file.sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(awcms_[a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi
    )) {
      const table = match[1]!.toLowerCase();
      const body = match[2]!;

      for (const inline of body.matchAll(
        /^\s+([a-z_][a-z0-9_]*)\s+[a-z][a-z0-9 ()]*?\s*(?:NOT NULL\s+)?REFERENCES\s+(awcms_[a-z0-9_]+)/gim
      )) {
        targets.set(
          `${table}.${inline[1]!.toLowerCase()}`,
          inline[2]!.toLowerCase()
        );
      }

      // Composite FKs carry `tenant_id` as their leading column (the pattern
      // office/media rows use for cross-tenant safety); it is the OTHER column
      // that names the subject.
      for (const composite of body.matchAll(
        /FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s+(awcms_[a-z0-9_]+)/gi
      )) {
        for (const raw of composite[1]!.split(",")) {
          const column = raw.trim().toLowerCase();

          if (column && column !== "tenant_id") {
            targets.set(`${table}.${column}`, composite[2]!.toLowerCase());
          }
        }
      }
    }
  }

  return targets;
}

/**
 * Column names per table, accumulated across `CREATE TABLE` and later
 * `ALTER TABLE ... ADD COLUMN`.
 *
 * A column added by a migration after the table was created is still a column,
 * and a parser that only read `CREATE TABLE` would reject perfectly good
 * descriptors for the newest fields — pushing authors to drop the field from
 * the descriptor rather than fix the parser, which is the failure mode that
 * matters.
 */
export function parseTableColumns(
  files: readonly { name: string; sql: string }[]
): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>();

  const add = (table: string, column: string): void => {
    const set = columns.get(table) ?? new Set<string>();
    set.add(column);
    columns.set(table, set);
  };

  for (const file of files) {
    for (const match of file.sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(awcms_[a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi
    )) {
      const table = match[1]!.toLowerCase();
      // Ensure the table is known even if every line fails the column shape.
      if (!columns.has(table)) {
        columns.set(table, new Set<string>());
      }

      for (const line of match[2]!.split("\n")) {
        const declaration = /^\s{2,}([a-z_][a-z0-9_]*)\s+[a-z]/.exec(line);

        if (
          declaration &&
          !/^(primary|unique|constraint|check|foreign|exclude|like)$/i.test(
            declaration[1]!
          )
        ) {
          add(table, declaration[1]!.toLowerCase());
        }
      }
    }

    for (const match of file.sql.matchAll(
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(awcms_[a-z0-9_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi
    )) {
      add(match[1]!.toLowerCase(), match[2]!.toLowerCase());
    }
  }

  return columns;
}

/** The runtime role every erasure statement executes as. */
const APP_ROLE = "awcms_app";

/** What each erasure mode needs `awcms_app` to be allowed to do. */
const ERASURE_REQUIRES: Readonly<Record<string, string | null>> = {
  hard_delete: "DELETE",
  anonymize: "UPDATE",
  status_transition_then_purge: "UPDATE",
  // Neither writes anything, so neither needs a privilege.
  severed_with_subject_row: null,
  retain_under_obligation: null
};

/**
 * Replay every `GRANT`/`REVOKE` naming `awcms_app`, in migration order, to
 * learn what the runtime role may actually do to each table.
 *
 * ## Why this is worth a parser
 *
 * Found by RUNNING the erasure, not by reading it. Two descriptors declared
 * `hard_delete` on `awcms_identity_mfa_factors` and its recovery-code sibling —
 * tables ADR-0087 (`sql/114`) deliberately retired to read-only history,
 * revoking INSERT/UPDATE/DELETE from `awcms_app` and asserting it "in BOTH
 * directions". The descriptors looked perfectly reasonable, every pure gate was
 * green, and the failure would have been a `42501` in production, mid-erasure,
 * AFTER the request was claimed and its status already moved.
 *
 * The tempting fix — grant the privilege back — would have quietly undone the
 * control ADR-0087 exists to impose. So the schema is right and the descriptor
 * has to yield, which is only obvious once the two are compared. This compares
 * them.
 */
export function parseAppRolePrivileges(
  files: readonly { name: string; sql: string }[]
): Map<string, Set<string>> {
  const privileges = new Map<string, Set<string>>();
  const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE"];

  const expand = (list: string): string[] => {
    const upper = list.toUpperCase();
    return /\bALL\b/.test(upper)
      ? ALL
      : ALL.filter((privilege) => upper.includes(privilege));
  };

  // Every table STARTS from the blanket grant, and that is the whole subtlety.
  // `sql/019` hands `awcms_app` all four privileges over the entire schema —
  // once via `ON ALL TABLES`, and thereafter via `ALTER DEFAULT PRIVILEGES` —
  // so a per-table `GRANT` that merely omits `DELETE` withholds NOTHING; it
  // re-grants what the table already had while reading like a control. Only an
  // explicit `REVOKE` takes a privilege away. Starting from the empty set would
  // model the opposite and make this gate answer backwards for every table.
  const effective = (table: string): Set<string> => {
    const existing = privileges.get(table);

    if (existing) {
      return existing;
    }

    const fresh = new Set(ALL);
    privileges.set(table, fresh);
    return fresh;
  };

  for (const file of files) {
    // `GRANT <privs> ON <table> TO <role>` / `REVOKE <privs> ON <table> FROM
    // <role>`. Only single-table statements naming the app role; anything else
    // (schema grants, other roles) is not this gate's business.
    for (const match of file.sql.matchAll(
      /\b(GRANT|REVOKE)\s+([A-Za-z, \n\r]+?)\s+ON\s+(awcms_[a-z0-9_]+)\s+(?:TO|FROM)\s+([a-z_][a-z0-9_]*)/gi
    )) {
      const [, verb, list, table, role] = match;

      if (role!.toLowerCase() !== APP_ROLE) {
        continue;
      }

      const key = table!.toLowerCase();
      const current = effective(key);

      for (const privilege of expand(list!)) {
        if (verb!.toUpperCase() === "GRANT") {
          current.add(privilege);
        } else {
          current.delete(privilege);
        }
      }

      privileges.set(key, current);
    }
  }

  return privileges;
}

export type SubjectRegistryProblem = { key: string; message: string };

export type SubjectRegistryInput = {
  /** Each module's own key paired with the descriptors it declares. */
  modules: readonly {
    key: string;
    subjectData: readonly SubjectDataDescriptor[];
  }[];
  columns: TableColumns;
  foreignKeys: ForeignKeyTargets;
  /** Net `awcms_app` privileges per table — see `parseAppRolePrivileges`. */
  appRolePrivileges: ReadonlyMap<string, ReadonlySet<string>>;
};

/** The whole check, as a function, so a test can run it against planted input. */
export function findSubjectRegistryProblems(
  input: SubjectRegistryInput
): SubjectRegistryProblem[] {
  const problems: SubjectRegistryProblem[] = [];
  const seenKeys = new Map<string, string>();
  const seenTables = new Map<string, string>();

  const all = input.modules.flatMap((module) =>
    module.subjectData.map((descriptor) => ({
      declaringModuleKey: module.key,
      descriptor
    }))
  );

  const severanceAnchor = all.find(
    (entry) => entry.descriptor.tableName === SEVERANCE_ANCHOR_TABLE
  );
  const severanceHolds =
    severanceAnchor?.descriptor.erasure === "anonymize" &&
    severanceAnchor.descriptor.tenantColumn !== null;

  for (const { declaringModuleKey, descriptor } of all) {
    const key = descriptor.key;
    const report = (message: string): void => {
      problems.push({ key, message });
    };

    const duplicateKeyOwner = seenKeys.get(key);
    if (duplicateKeyOwner) {
      report(
        `\`${key}\` dideklarasikan dua kali (\`${duplicateKeyOwner}\` dan \`${declaringModuleKey}\`). ` +
          "Kunci deskriptor harus unik di seluruh registry."
      );
    }
    seenKeys.set(key, declaringModuleKey);

    // ADR-0013 §6: one table, one owner. Two descriptors for one table is two
    // answers to a question whose whole design is that each table gives one.
    const duplicateTableOwner = seenTables.get(descriptor.tableName);
    if (duplicateTableOwner) {
      report(
        `\`${descriptor.tableName}\` punya deskriptor subjek dari DUA modul ` +
          `(\`${duplicateTableOwner}\` dan \`${declaringModuleKey}\`). Satu tabel menjawab sekali.`
      );
    }
    seenTables.set(descriptor.tableName, declaringModuleKey);

    if (descriptor.ownerModuleKey !== declaringModuleKey) {
      report(
        `\`${key}\` menyatakan \`ownerModuleKey: "${descriptor.ownerModuleKey}"\` tetapi ` +
          `dideklarasikan oleh modul \`${declaringModuleKey}\`.`
      );
    }

    if (!key.startsWith(`${descriptor.ownerModuleKey}.`)) {
      report(
        `\`${key}\` harus diawali \`${descriptor.ownerModuleKey}.\` — kunci deskriptor ` +
          "adalah `<ownerModuleKey>.<table_shortname>`."
      );
    }

    if (!/^awcms_[a-z0-9_]+$/.test(descriptor.tableName)) {
      report(
        `\`${key}\` menamai tabel \`${descriptor.tableName}\` yang bukan snake_case ber-awalan \`awcms_\`.`
      );
    }

    if (descriptor.rationale.trim().length < 40) {
      report(
        `\`${key}\` tidak beralasan sungguhan. \`rationale\` wajib di setiap arah — ` +
          "tabel yang tidak mengekspor apa pun butuh alasan sebanyak yang mengekspor semuanya."
      );
    }

    const columns = input.columns.get(descriptor.tableName);

    if (!columns) {
      report(
        `\`${key}\` menamai tabel \`${descriptor.tableName}\` yang tidak ada di \`sql/\`.`
      );
      continue;
    }

    // The pair is enforced in BOTH directions. One way round, an author who
    // could not find a subject column empties the array and the table goes
    // quiet with nothing recording it. The other way round, the flag becomes a
    // way to opt a perfectly reachable table out of every export.
    if (
      descriptor.subjectColumns.length === 0 &&
      descriptor.unreachableBySubject !== true
    ) {
      report(
        `\`${key}\` tidak menamai satu pun kolom subjek. Deskriptor tanpa kolom subjek ` +
          "tidak terhubung ke siapa pun — perencana menjatuhkannya, jadi tabel ini akan " +
          "diam di setiap ekspor dan setiap penghapusan. Bila tabelnya memang memuat data " +
          "orang tetapi tak punya kolom yang bisa dicocokkan, tulis `unreachableBySubject: true` " +
          "dengan sengaja; bila ia tidak memuat apa pun tentang seseorang, tempatnya " +
          "`NO_SUBJECT_DATA`."
      );
    }

    if (
      descriptor.unreachableBySubject === true &&
      descriptor.subjectColumns.length > 0
    ) {
      report(
        `\`${key}\` menandai dirinya \`unreachableBySubject\` TAPI menamai ` +
          `${descriptor.subjectColumns.length} kolom subjek. Keduanya tidak bisa benar — ` +
          "kolom yang disebut membuktikan tabelnya terjangkau."
      );
    }

    if (
      descriptor.unreachableBySubject === true &&
      (descriptor.exportable ||
        descriptor.erasure !== "retain_under_obligation")
    ) {
      report(
        `\`${key}\` tak terjangkau subjek TAPI menjanjikan \`exportable: ${descriptor.exportable}\` ` +
          `/ \`erasure: "${descriptor.erasure}"\`. Tabel yang barisnya tak bisa ditemukan tidak ` +
          "bisa menepati janji apa pun — wajib `exportable: false` dan `retain_under_obligation`."
      );
    }

    for (const subjectColumn of descriptor.subjectColumns) {
      if (!columns.has(subjectColumn.column)) {
        report(
          `\`${key}\` menamai kolom subjek \`${subjectColumn.column}\` yang tidak ada di ` +
            `\`${descriptor.tableName}\`. Ini gagal DIAM-DIAM saat runtime: kuerinya membaca ` +
            "nol baris dan laporannya melapor sukses."
        );
        continue;
      }

      // ADR-0094 Decision 1, enforced rather than trusted: the global principal
      // may only be named by a table that is itself global. On a tenant-scoped
      // table it would be a subject the planner has no id for, and a plan that
      // reached for one would be the cross-tenant read FORCE RLS refuses.
      if (
        subjectColumn.references === "principal" &&
        descriptor.tenantColumn !== null
      ) {
        report(
          `\`${key}\` menamai kolom principal \`${subjectColumn.column}\` pada tabel ` +
            "ber-tenant. `principal` hanya boleh pada deskriptor global " +
            "(`tenantColumn: null`) — ADR-0094 Keputusan 1 menjawab subjek PER TENANT."
        );
      }

      const declaredTarget = REFERENCE_TARGET_TABLE[subjectColumn.references];
      const actualTarget = input.foreignKeys.get(
        `${descriptor.tableName}.${subjectColumn.column}`
      );

      // Only where an FK exists. Absence is not a finding — most stamp columns
      // in this schema are bare uuids — but a PRESENT FK that disagrees is.
      if (actualTarget && actualTarget !== declaredTarget) {
        report(
          `\`${key}\` menyatakan \`${subjectColumn.column}\` merujuk ` +
            `\`${subjectColumn.references}\` (\`${declaredTarget}\`), padahal foreign key-nya ` +
            `menunjuk \`${actualTarget}\`. Ini persis jebakan yang ADR-0094 namai: nilainya ` +
            "uuid yang sah, jadi tidak ada error — kuerinya hanya mengembalikan nol baris selamanya."
        );
      }
    }

    for (const redacted of descriptor.redactedColumns ?? []) {
      if (!columns.has(redacted)) {
        report(
          `\`${key}\` meredaksi kolom \`${redacted}\` yang tidak ada di ` +
            `\`${descriptor.tableName}\`. Redaksi yang salah nama TIDAK meredaksi apa pun, ` +
            "dan tampak persis seperti redaksi yang bekerja."
        );
      }
    }

    // The three-way `tenantColumn` contract, each branch proved against `sql/`
    // rather than taken on trust — see `SubjectDataDescriptor.tenantColumn`.
    if (descriptor.tenantColumn === null) {
      if (columns.has("tenant_id")) {
        report(
          `\`${key}\` menyatakan tabelnya GLOBAL (\`tenantColumn: null\`) padahal ` +
            `\`${descriptor.tableName}\` punya kolom \`tenant_id\`. Klaim global mengeluarkan ` +
            "tabel dari SETIAP jawaban per-tenant, dan operator membacanya sebagai " +
            '"di luar cakupan" alih-alih "hilang".'
        );
      }
    } else if (descriptor.tenantColumn === undefined) {
      if (!columns.has("tenant_id")) {
        report(
          `\`${key}\` memakai \`tenant_id\` bawaan tetapi \`${descriptor.tableName}\` tidak ` +
            "punya kolom itu. Bila tabelnya memang global, tulis `tenantColumn: null` dengan sengaja."
        );
      }
    } else if (!columns.has(descriptor.tenantColumn)) {
      report(
        `\`${key}\` menamai kolom tenant \`${descriptor.tenantColumn}\` yang tidak ada di ` +
          `\`${descriptor.tableName}\`.`
      );
    }

    // A global table cannot be answered per tenant, so promising to export or
    // erase it is a promise the executor structurally cannot keep.
    if (descriptor.tenantColumn === null && descriptor.exportable) {
      report(
        `\`${key}\` global TAPI \`exportable: true\`. Permintaan per-tenant tidak punya ` +
          "kedudukan untuk membacanya (ADR-0094 Keputusan 1) — janji yang tak bisa ditepati eksekutor."
      );
    }

    if (
      descriptor.tenantColumn === null &&
      descriptor.erasure !== "retain_under_obligation"
    ) {
      report(
        `\`${key}\` global TAPI menjanjikan \`erasure: "${descriptor.erasure}"\`. ` +
          "Satu tenant tidak boleh menghancurkan baris yang direntang tenant lain."
      );
    }

    // `status_transition_then_purge` is not free-form: the executor writes
    // exactly one column, `revoked_at`. Today one descriptor uses it
    // (`identity_access.machine_credentials`) and that table has the column, so
    // nothing is broken — but the coupling is invisible from either side, and
    // the next descriptor to pick this mode on a table without `revoked_at`
    // would fail at runtime, mid-erasure, with the request already claimed.
    // Checked here so that becomes a CI failure instead.
    if (
      descriptor.erasure === "status_transition_then_purge" &&
      !columns.has(STATUS_TRANSITION_COLUMN)
    ) {
      report(
        `\`${key}\` menjawab \`status_transition_then_purge\` tetapi ` +
          `\`${descriptor.tableName}\` tidak punya kolom \`${STATUS_TRANSITION_COLUMN}\`. ` +
          "Eksekutor penghapusan menulis TEPAT kolom itu, jadi deskriptor ini akan " +
          "gagal saat runtime di tengah penghapusan — setelah permintaannya diklaim."
      );
    }

    // The erasure mode must be within what the RUNTIME ROLE may do. Compared
    // against the migrations rather than trusted, because the failure is a
    // `42501` in production, mid-erasure, after the request has been claimed —
    // and because the tempting fix (grant the privilege) can silently undo a
    // control an ADR imposed on purpose.
    const required = ERASURE_REQUIRES[descriptor.erasure];
    // Absent means "no migration ever said anything about this table", which
    // under `sql/019`'s blanket grant means it has everything — NOT that the
    // check should be skipped.
    const granted =
      input.appRolePrivileges.get(descriptor.tableName) ??
      new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);

    if (required && !granted.has(required)) {
      report(
        `\`${key}\` menjawab \`erasure: "${descriptor.erasure}"\`, yang menuntut ` +
          `${required} pada \`${descriptor.tableName}\` — tetapi migrasi MENCABUTNYA dari ` +
          `\`${APP_ROLE}\` (sisa: ${[...granted].sort().join(", ") || "tak ada"}). ` +
          "Penghapusan akan gagal 42501 di TENGAH transaksi, setelah permintaannya " +
          "diklaim. Perhatikan: memberikan kembali privilege-nya mungkin membatalkan " +
          "kontrol yang sengaja dipasang sebuah ADR — periksa migrasinya dulu, dan " +
          "biasanya deskriptor inilah yang harus mengalah."
      );
    }

    if (descriptor.erasure === "severed_with_subject_row" && !severanceHolds) {
      report(
        `\`${key}\` menjawab \`severed_with_subject_row\`, tetapi tidak ada deskriptor ` +
          `per-tenant yang meng-\`anonymize\` \`${SEVERANCE_ANCHOR_TABLE}\`. Rantai yang ` +
          "dirujuknya putus, jadi jawaban ini kini berarti tidak melakukan apa-apa."
      );
    }
  }

  return problems;
}

export function readMigrations(): { name: string; sql: string }[] {
  return loadMigrations();
}

function main(): void {
  const modules = listModules().map((module) => ({
    key: module.key,
    subjectData: module.subjectData ?? []
  }));
  const migrations = readMigrations();
  const problems = findSubjectRegistryProblems({
    modules,
    columns: parseTableColumns(migrations),
    foreignKeys: parseForeignKeyTargets(migrations),
    appRolePrivileges: parseAppRolePrivileges(migrations)
  });
  const total = modules.reduce(
    (sum, module) => sum + module.subjectData.length,
    0
  );

  if (problems.length === 0) {
    console.log(
      `subject-data:registry:check OK — ${total} deskriptor tervalidasi terhadap sql/.`
    );
    return;
  }

  console.error(
    `subject-data:registry:check GAGAL — ${problems.length} temuan:`
  );
  for (const problem of problems) {
    console.error(`  - ${problem.message}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
