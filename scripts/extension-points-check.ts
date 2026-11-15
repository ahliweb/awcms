/**
 * extension-points-check.ts — `bun run extension-points:check`.
 *
 * ADR-0164 (Issue #1277). Pure code-registry gate: no database, no network. It
 * keeps the three descriptor-declared extension points of `email` and
 * `whatsapp_delivery` honest, all derived from `listModules()`, `src/`,
 * `scripts/` and `sql/`:
 *
 * 1. Every module's `emailTemplateCategories` and `whatsappTemplates` pass the
 *    shared validator (`_shared/extension-point-declarations.ts`), and the
 *    runtime registries actually LOAD them (a malformed template would throw
 *    where the dispatcher first looks it up).
 * 2. Nothing registers a category or a template by hand. The side-effect
 *    import that did was the defect: it fixes one process and leaves the next
 *    (`email:dispatch`, `whatsapp:dispatch`) rendering an empty variable or
 *    failing a message as `template_unknown`. Only the registries' own files
 *    may call the two register functions; tests are not scanned.
 * 3. The worker allow-list of `awcms_email_messages` is DATA. A category a
 *    descriptor declares `workerInsert` has a seeded row in
 *    `awcms_email_worker_categories`; a seeded row is a base category or a
 *    declared one (no orphan allowance widening the worker silently); and no
 *    migration after sql/410 re-issues `awcms_email_guard_worker_insert`,
 *    which would silently override upstream changes to it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import {
  formatExtensionPointIssue,
  validateEmailCategoryDeclarations,
  validateWhatsappTemplateDeclarations
} from "../src/modules/_shared/extension-point-declarations";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { BASE_EMAIL_TEMPLATE_CATEGORIES } from "../src/modules/email/domain/email-template-categories";
import { listWhatsappTemplates } from "../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import { installExtensionPointSource } from "../src/modules/_shared/extension-point-source";
import { loadMigrations } from "./lib/migrations";
import { stripComments } from "./lib/source-text";

/** The migration that introduced the table and replaced the guard function. */
export const GUARD_FUNCTION_MIGRATION_PREFIX = 410;
export const GUARD_FUNCTION_NAME = "awcms_email_guard_worker_insert";
export const WORKER_CATEGORY_TABLE = "awcms_email_worker_categories";

/** The only files that may call the register functions in code: the registries themselves. */
export const MANUAL_REGISTRATION_ALLOWED_FILES: readonly string[] = [
  "src/modules/email/domain/email-template-categories.ts",
  "src/modules/whatsapp-delivery/domain/whatsapp-templates.ts"
];

const MANUAL_REGISTRATION_CALL =
  /\b(registerDerivedEmailTemplateCategory|registerWhatsappTemplate)\s*\(/;

export function findManualRegistrations(
  files: readonly { path: string; text: string }[]
): string[] {
  const offenders = new Set<string>();

  for (const file of files) {
    if (MANUAL_REGISTRATION_ALLOWED_FILES.includes(file.path)) {
      continue;
    }

    if (MANUAL_REGISTRATION_CALL.test(stripComments(file.text))) {
      offenders.add(file.path);
    }
  }

  return [...offenders].sort();
}

/**
 * The BASE e-mail categories a module's worker transactions enqueue, with the
 * reason each module gave in `workerEmailCategories` on its own descriptor.
 * Base categories are not `emailTemplateCategories` (a descriptor may only
 * declare `derived.*`), so ownership of a seeded base row is this descriptor
 * field: a seeded row no descriptor claims is an allowance nobody owns, and a
 * claim no migration seeds is a stale one. The rule is EXACT in both
 * directions, and two modules cannot claim the same category.
 */
export function collectBaseWorkerAllowances(
  modules: readonly ModuleDescriptor[]
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const module of modules) {
    for (const entry of module.workerEmailCategories ?? []) {
      out[entry.category] = `${module.key}: ${entry.reason}`;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// SQL reading. Fail-closed: every statement that mentions the allow-list table
// or the guard must be one this file understands, or the gate reports it.
// ---------------------------------------------------------------------------

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
/** A dollar-quote tag as Postgres lexes it: `$$` or `$name$`, where `name` starts with a letter, underscore or non-ASCII character and continues with digits too. */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/**
 * What may sit between two string segments that Postgres joins: whitespace
 * (` \t\f\r\n`) and `--` comments running to the next `\r`/`\n` or the end.
 * A single forward pass, not a regex: `(?:ws|--[^\r\n]*)*` backtracks
 * exponentially on a run of `--` (CodeQL js/redos).
 */
export function isContinuationGap(gap: string): boolean {
  let i = 0;

  while (i < gap.length) {
    const ch = gap[i]!;

    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\f" ||
      ch === "\r" ||
      ch === "\n"
    ) {
      i++;
    } else if (ch === "-" && gap[i + 1] === "-") {
      i += 2;
      while (i < gap.length && gap[i] !== "\r" && gap[i] !== "\n") i++;
    } else {
      return false;
    }
  }

  return true;
}

export type SqlScan = {
  /** Statements split on `;` outside every quoted construct, comments replaced by a space. */
  statements: string[];
  /** Set when the text ends inside a string, identifier, comment or dollar quote: the reader lost sync and cannot vouch for anything. */
  error?: string;
};

/**
 * One scanner for both jobs (strip comments, split statements), so the two can
 * never disagree about where a literal ends. It follows the Postgres lexer:
 * `--` line comments; NESTED `/* *\/` block comments; `'...'` strings with `''`
 * and, for an `E'...'` string, backslash escapes; `"..."` identifiers with
 * `""`; and dollar quotes `$tag$ ... $tag$` whose tag may contain digits
 * (`$fn1$`) and whose body is opaque, so a different dollar tag inside it is
 * plain text. A `$` that continues an identifier (`a$b$`) or starts a
 * parameter (`$1`) is not a tag. Anything left open at the end of the text is
 * reported in `error` (fail closed).
 */
export function scanSqlStatements(sql: string): SqlScan {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let error: string | undefined;
  /** End offset of the last string literal when it processed escapes (an E-string segment), else -1. */
  let eStringEnd = -1;

  const push = () => {
    if (current.trim() !== "") statements.push(current.trim());
    current = "";
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (
      (ch === "U" || ch === "u") &&
      next === "&" &&
      (sql[i + 2] === '"' || sql[i + 2] === "'") &&
      !(i > 0 && IDENT_CHAR.test(sql[i - 1]!))
    ) {
      // A Unicode-escaped identifier or string spells a name this reader cannot
      // match (U&"awcms\005femail..."); refuse rather than guess.
      error ??= "a Unicode-escape literal (U&\"...\" or U&'...')";
    }

    if (ch === "-" && next === "-") {
      // A line comment ends at `\n` OR `\r` (scan.l: newline = [\n\r]).
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      current += " ";
    } else if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;

      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }

      if (depth > 0) error ??= "an unterminated block comment";
      current += " ";
    } else if (ch === "'") {
      const prev = sql[i - 1];
      // Postgres continues a string across whitespace that holds a newline, and
      // the continuation segment keeps the escape rules of an E-string (state xe).
      const gap = eStringEnd >= 0 ? sql.slice(eStringEnd, i) : "";
      const continuesEString =
        gap !== "" && isContinuationGap(gap) && /[\r\n]/.test(gap);
      const escapes =
        continuesEString ||
        ((prev === "e" || prev === "E") &&
          !(i >= 2 && IDENT_CHAR.test(sql[i - 2]!)));
      const start = i++;
      let closed = false;

      while (i < sql.length) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          closed = true;
          break;
        } else i++;
      }

      if (!closed) error ??= "an unterminated string literal";
      eStringEnd = escapes ? i : -1;
      current += sql.slice(start, Math.min(i, sql.length));
    } else if (ch === '"') {
      const start = i++;
      let closed = false;

      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          closed = true;
          break;
        } else i++;
      }

      if (!closed) error ??= "an unterminated quoted identifier";
      current += sql.slice(start, Math.min(i, sql.length));
    } else if (ch === "$") {
      const tag =
        i > 0 && IDENT_CHAR.test(sql[i - 1]!)
          ? null
          : DOLLAR_TAG.exec(sql.slice(i, i + 256));

      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);

        if (end === -1) error ??= `an unterminated dollar quote ${tag[0]}`;

        const stop = end === -1 ? sql.length : end + tag[0].length;
        current += sql.slice(i, stop);
        i = stop;
      } else {
        current += ch;
        i++;
      }
    } else if (ch === ";") {
      push();
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  push();

  return error === undefined ? { statements } : { statements, error };
}

/** The migrations whose text this scanner cannot tokenize to the end: every applied migration must. */
export function findSqlScanErrors(
  migrations: readonly { name: string; sql: string }[]
): string[] {
  const out: string[] = [];

  for (const migration of migrations) {
    const { error } = scanSqlStatements(migration.sql);

    if (error !== undefined) out.push(`${migration.name}: ${error}`);
  }

  return out;
}

/** Whether the raw text names the table, the guard function or its trigger, in any spelling. */
function mentionsGuardObjects(sql: string): boolean {
  // A U&"..." spelling can name any of them without the plain text appearing.
  if (/(?<![A-Za-z0-9_$])U&["']/i.test(sql)) return true;

  return /awcms_email_worker_categories|awcms_email_guard_worker_insert|awcms_email_messages_worker_guard/i.test(
    sql
  );
}

/** An identifier as SQL may spell it: bare or quoted, optionally schema-qualified, any spacing around the dot. */
function identifierPattern(name: string): string {
  return `(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\\s*\\.\\s*)?"?${name}"?(?![A-Za-z0-9_$])`;
}

const TABLE_IDENTIFIER = new RegExp(
  `(?<![A-Za-z0-9_$"])${identifierPattern(WORKER_CATEGORY_TABLE)}`,
  "i"
);
const GUARD_IDENTIFIER = new RegExp(
  `(?<![A-Za-z0-9_$"])${identifierPattern(GUARD_FUNCTION_NAME)}`,
  "i"
);
export const GUARD_TRIGGER_NAME = "awcms_email_messages_worker_guard";
const TRIGGER_IDENTIFIER = new RegExp(
  `(?<![A-Za-z0-9_$"])${identifierPattern(GUARD_TRIGGER_NAME)}`,
  "i"
);

const MESSAGES_TABLE_IDENTIFIER = new RegExp(
  `(?<![A-Za-z0-9_$"])${identifierPattern("awcms_email_messages")}`,
  "i"
);

/** Statements that only DESCRIBE the table (shape, comment, privileges) or read it from a function body. */
const TABLE_NON_SEEDING_STATEMENT =
  /^(?:CREATE\s+TABLE|COMMENT\s+ON\s+TABLE|REVOKE|GRANT|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION)\b/i;

export type SeededWorkerCategories = {
  seeded: Set<string>;
  /** Statements that touch the table and that this reader does not understand. Each is a gate failure. */
  unparseable: string[];
};

/**
 * Category names seeded into the allow-list table by any migration's `INSERT`,
 * and every statement touching the table that it could not account for
 * (UPDATE, DELETE, TRUNCATE, ALTER, COPY, INSERT ... SELECT, an INSERT of an
 * expression or a second column, ...). Schema-qualified and quoted spellings,
 * any whitespace, and multi-row `VALUES` are understood.
 */
export function collectSeededWorkerCategories(
  migrations: readonly { name: string; sql: string }[]
): SeededWorkerCategories {
  const seeded = new Set<string>();
  const unparseable: string[] = [];
  const insertHead = new RegExp(
    `^INSERT\\s+INTO\\s+${identifierPattern(WORKER_CATEGORY_TABLE)}\\s*\\(\\s*"?category"?\\s*\\)\\s*VALUES\\s*`,
    "i"
  );

  for (const migration of migrations) {
    const scan = scanSqlStatements(migration.sql);

    if (scan.error !== undefined && mentionsGuardObjects(migration.sql)) {
      unparseable.push(
        `${migration.name}: the SQL reader lost sync (${scan.error}) in a migration that names the worker allow-list`
      );
    }

    for (const statement of scan.statements) {
      if (!TABLE_IDENTIFIER.test(statement)) continue;
      const writesTable = new RegExp(
        `(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?(?:\\s+ONLY)?)\\s+${identifierPattern(WORKER_CATEGORY_TABLE)}`,
        "i"
      );

      // A function body may READ the table (the guard does); one that writes it is a seed this gate cannot vouch for.
      if (
        TABLE_NON_SEEDING_STATEMENT.test(statement) &&
        !(
          /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(statement) &&
          writesTable.test(statement)
        )
      ) {
        continue;
      }

      const reject = (why: string) =>
        unparseable.push(
          `${migration.name}: ${why}: ${statement.replace(/\s+/g, " ").slice(0, 120)}`
        );
      const head = insertHead.exec(statement);

      if (!head) {
        reject("a statement touching the table that this gate cannot read");
        continue;
      }

      // `VALUES ('a'), ('b') [ON CONFLICT ...]`: every tuple is ONE string literal.
      const rest = statement.slice(head[0].length);
      const tail = /\s+ON\s+CONFLICT\b[\s\S]*$/i.exec(rest);
      const values = tail ? rest.slice(0, tail.index) : rest;
      const tuple = /^\(\s*'((?:[^']|'')*)'\s*\)\s*(?:,\s*|$)/;
      let remaining = values.trim();
      const found: string[] = [];

      while (remaining !== "") {
        const m = tuple.exec(remaining);

        if (!m) break;

        found.push(m[1]!.replace(/''/g, "'"));
        remaining = remaining.slice(m[0].length).trim();
      }

      if (remaining !== "" || found.length === 0) {
        reject(
          "an INSERT whose VALUES are not one plain string literal per row"
        );
        continue;
      }

      for (const category of found) seeded.add(category);
    }
  }

  return { seeded, unparseable };
}

export function findWorkerCategoryProblems(
  modules: readonly ModuleDescriptor[],
  seeded: ReadonlySet<string>,
  baseAllowances: Readonly<
    Record<string, string>
  > = collectBaseWorkerAllowances(modules)
): string[] {
  const problems: string[] = [];
  const claimedBy = new Map<string, string>();

  for (const module of modules) {
    for (const entry of module.workerEmailCategories ?? []) {
      const other = claimedBy.get(entry.category);

      if (other !== undefined) {
        problems.push(
          `modules "${other}" and "${module.key}" both claim "${entry.category}" in workerEmailCategories.`
        );
      } else {
        claimedBy.set(entry.category, module.key);
      }

      if (entry.reason.trim() === "") {
        problems.push(
          `module "${module.key}" claims "${entry.category}" in workerEmailCategories without a reason.`
        );
      }
    }
  }

  const declaredWorker = new Set<string>();
  const declaredAny = new Set<string>();

  for (const module of modules) {
    for (const entry of module.emailTemplateCategories ?? []) {
      declaredAny.add(entry.category);

      if (entry.workerInsert === true) {
        declaredWorker.add(entry.category);

        if (!seeded.has(entry.category)) {
          problems.push(
            `module "${module.key}" declares "${entry.category}" workerInsert but no migration seeds it into ${WORKER_CATEGORY_TABLE}; the database would refuse every worker insert in it. Add INSERT INTO ${WORKER_CATEGORY_TABLE} (category) VALUES ('${entry.category}') ON CONFLICT DO NOTHING to the module's migration.`
          );
        }
      }
    }
  }

  const base = new Set<string>(BASE_EMAIL_TEMPLATE_CATEGORIES);

  for (const category of seeded) {
    if (declaredWorker.has(category) || category in baseAllowances) continue;

    problems.push(
      `${WORKER_CATEGORY_TABLE} seeds "${category}", which is ${
        declaredAny.has(category)
          ? "declared by a module without workerInsert: true"
          : base.has(category)
            ? "a base category no module claims in workerEmailCategories"
            : "neither claimed by a descriptor (workerInsert: true) nor listed in workerEmailCategories"
      }. An allowance nobody owns widens the worker silently; declare it workerInsert, claim it with a reason in the module descriptor workerEmailCategories, or drop the row.`
    );
  }

  for (const category of Object.keys(baseAllowances)) {
    if (!base.has(category)) {
      problems.push(
        `workerEmailCategories names "${category}", which is not a base e-mail category.`
      );
    } else if (!seeded.has(category)) {
      problems.push(
        `workerEmailCategories names "${category}" but no migration seeds it into ${WORKER_CATEGORY_TABLE}; drop the stale entry.`
      );
    }
  }

  return problems;
}

/**
 * Migrations after the guard's own that CREATE, ALTER or DROP the guard
 * function or its trigger, in any spelling (schema-qualified, quoted, any
 * whitespace or case). Any such statement is reported: replacing the function
 * overrides upstream changes to it, and dropping or re-creating the trigger can
 * detach it.
 */
export function findGuardFunctionReissues(
  migrations: readonly { name: string; sql: string }[]
): string[] {
  const offenders = new Set<string>();

  for (const migration of migrations) {
    const prefix = Number.parseInt(migration.name.slice(0, 4), 10);

    if (!(prefix > GUARD_FUNCTION_MIGRATION_PREFIX)) continue;

    const scan = scanSqlStatements(migration.sql);

    if (scan.error !== undefined && mentionsGuardObjects(migration.sql)) {
      offenders.add(migration.name);
    }

    for (const statement of scan.statements) {
      if (
        (GUARD_IDENTIFIER.test(statement) ||
          TRIGGER_IDENTIFIER.test(statement)) &&
        // A DO block, EXECUTE or CALL can re-create the guard inside its body,
        // so those count alongside CREATE / ALTER / DROP.
        /^(?:CREATE|ALTER|DROP|DO|EXECUTE|PREPARE|CALL)\b/i.test(statement)
      ) {
        offenders.add(migration.name);
      }

      // Disabling every user trigger of the table silences the guard without
      // naming it.
      if (
        /^ALTER\s+TABLE\b/i.test(statement) &&
        MESSAGES_TABLE_IDENTIFIER.test(statement) &&
        /\bDISABLE\s+TRIGGER\s+(?:USER|ALL)\b/i.test(statement)
      ) {
        offenders.add(migration.name);
      }
    }
  }

  return [...offenders];
}

export type PriorGuardCategories = {
  /** Migration that holds the LAST definition of the guard before sql/410, and the categories its body allows. */
  migration: string | null;
  categories: Set<string>;
  /** Why the body could not be read; fail closed, never an empty set. */
  error?: string;
};

/**
 * The categories the guard function allowed immediately before sql/410
 * replaced it: the literal list of the LATEST pre-410 `CREATE [OR REPLACE]
 * FUNCTION awcms_email_guard_worker_insert` (latest wins, sql/371 today, not
 * sql/302). sql/410 must seed a superset of it, or the migration silently
 * narrows what the worker may send. A body this reader cannot read is an
 * error, never an empty list.
 */
export function findPriorGuardCategories(
  migrations: readonly { name: string; sql: string }[]
): PriorGuardCategories {
  const categories = new Set<string>();
  let migrationName: string | null = null;
  let body: string | null = null;
  let error: string | undefined;

  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of ordered) {
    const prefix = Number.parseInt(migration.name.slice(0, 4), 10);

    if (!(prefix < GUARD_FUNCTION_MIGRATION_PREFIX)) continue;

    const scan = scanSqlStatements(migration.sql);

    if (scan.error !== undefined && mentionsGuardObjects(migration.sql)) {
      error = `${migration.name}: the SQL reader lost sync (${scan.error})`;
    }

    for (const statement of scan.statements) {
      if (
        /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(statement) &&
        GUARD_IDENTIFIER.test(statement)
      ) {
        migrationName = migration.name;
        body = statement;
      }
    }
  }

  if (body === null) {
    return {
      migration: null,
      categories,
      error: error ?? "no definition of the guard function found before sql/410"
    };
  }

  const list = /\bNEW\.category\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(body);

  if (!list) {
    return {
      migration: migrationName,
      categories,
      error: `${migrationName}: the guard body has no literal "NEW.category NOT IN (...)" list this gate can read`
    };
  }

  for (const part of list[1]!.split(",")) {
    const m = /^\s*'((?:[^']|'')*)'\s*$/.exec(part);

    if (!m) {
      return {
        migration: migrationName,
        categories,
        error: `${migrationName}: the category list holds something other than string literals`
      };
    }

    categories.add(m[1]!.replace(/''/g, "'"));
  }

  return error === undefined
    ? { migration: migrationName, categories }
    : { migration: migrationName, categories, error };
}

/** Problems when the seed of sql/410 (plus anything seeded later) does not cover the prior guard's allow-list. */
export function findNarrowedWorkerCategories(
  prior: PriorGuardCategories,
  seeded: ReadonlySet<string>
): string[] {
  const problems: string[] = [];

  if (prior.error !== undefined) {
    problems.push(
      `cannot read the pre-sql/410 guard allow-list: ${prior.error}`
    );
  }

  for (const category of prior.categories) {
    if (!seeded.has(category)) {
      problems.push(
        `the guard allowed "${category}" for the worker before sql/${GUARD_FUNCTION_MIGRATION_PREFIX} (${prior.migration}) but no migration seeds it into ${WORKER_CATEGORY_TABLE}; sql/${GUARD_FUNCTION_MIGRATION_PREFIX} would silently refuse it.`
      );
    }
  }

  return problems;
}

/** Composition roots that must install the descriptor source (ADR-0164), and the file that proves it. */
export const COMPOSITION_ROOTS: readonly string[] = [
  "src/middleware.ts",
  "scripts/email-dispatch.ts",
  "scripts/whatsapp-dispatch.ts",
  "scripts/whatsapp-meta-preflight.ts",
  "scripts/booking-reminders-dispatch.ts"
];

/** Roots that do not install the source (a typo would otherwise pass silently), and registry files that import the module list. */
export function findCompositionProblems(
  files: readonly { path: string; text: string }[]
): string[] {
  const problems: string[] = [];
  const byPath = new Map(files.map((file) => [file.path, file.text]));

  for (const root of COMPOSITION_ROOTS) {
    const text = byPath.get(root);

    if (
      text === undefined ||
      !/\binstallExtensionPointSource\s*\(\s*listModules\s*\)/.test(
        stripComments(text)
      )
    ) {
      problems.push(
        `${root} is a composition root of the descriptor-declared extension points but does not call installExtensionPointSource(listModules); the process would throw at its first declared category or template.`
      );
    }
  }

  for (const registry of MANUAL_REGISTRATION_ALLOWED_FILES) {
    const text = byPath.get(registry);

    if (
      text !== undefined &&
      /from\s+["'][^"']*\/modules\/index["']|from\s+["']\.\.\/\.\.\/index["']/.test(
        stripComments(text)
      )
    ) {
      problems.push(
        `${registry} imports the module list. Registries read descriptors through _shared/extension-point-source.ts so that no job's import closure grows to every module and loses its least-privilege withholding (ADR-0164).`
      );
    }
  }

  return problems;
}

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const info = statSync(full);

    if (info.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (/\.(ts|astro)$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

function main(): void {
  const failures: string[] = [];
  const modules = listModules();

  // This gate is itself a process that loads the registries.
  installExtensionPointSource(listModules);

  for (const issue of [
    ...validateEmailCategoryDeclarations(
      modules,
      BASE_EMAIL_TEMPLATE_CATEGORIES
    ),
    ...validateWhatsappTemplateDeclarations(modules)
  ]) {
    failures.push(formatExtensionPointIssue(issue));
  }

  if (failures.length === 0) {
    try {
      listWhatsappTemplates();
    } catch (error) {
      failures.push(
        `the WhatsApp template registry failed to load the declarations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const files = [...listSourceFiles("src"), ...listSourceFiles("scripts")].map(
    (file) => ({
      path: file.split(path.sep).join("/"),
      text: readFileSync(file, "utf8")
    })
  );

  for (const file of findManualRegistrations(files)) {
    failures.push(
      `${file} registers an e-mail category or a WhatsApp template by hand. Declare it in the owning module's descriptor (emailTemplateCategories / whatsappTemplates, ADR-0164): a manual registration lives in one process and leaves email:dispatch / whatsapp:dispatch without it.`
    );
  }

  const migrations = loadMigrations();

  const seededRows = collectSeededWorkerCategories(migrations);

  for (const statement of seededRows.unparseable) {
    failures.push(
      `${statement}. The worker allow-list is read by this gate; a statement it cannot read is a statement it cannot vouch for. Seed rows with INSERT INTO ${WORKER_CATEGORY_TABLE} (category) VALUES ('x') [, ('y')] ON CONFLICT DO NOTHING.`
    );
  }

  for (const problem of findWorkerCategoryProblems(
    modules,
    seededRows.seeded
  )) {
    failures.push(problem);
  }

  for (const error of findSqlScanErrors(migrations)) {
    failures.push(
      `${error}. Every applied migration must tokenize to its end; a reader that lost sync cannot vouch for the allow-list.`
    );
  }

  for (const problem of findNarrowedWorkerCategories(
    findPriorGuardCategories(migrations),
    seededRows.seeded
  )) {
    failures.push(problem);
  }

  for (const problem of findCompositionProblems(files)) {
    failures.push(problem);
  }

  for (const name of findGuardFunctionReissues(migrations)) {
    failures.push(
      `sql/${name} re-issues ${GUARD_FUNCTION_NAME}. The worker category allow-list is rows of ${WORKER_CATEGORY_TABLE} since sql/${GUARD_FUNCTION_MIGRATION_PREFIX}; INSERT a row instead of replacing the function, which would silently override upstream changes to it.`
    );
  }

  if (failures.length > 0) {
    console.error(
      `extension-points:check FAILED — ${failures.length} problem(s):`
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  const categories = modules.flatMap(
    (module) => module.emailTemplateCategories ?? []
  ).length;
  const templates = modules.flatMap(
    (module) => module.whatsappTemplates ?? []
  ).length;

  console.log(
    `extension-points:check OK — ${categories} descriptor-declared e-mail categor${categories === 1 ? "y" : "ies"} and ${templates} WhatsApp template(s) are valid and loaded generically; no manual registration; the worker allow-list is data.`
  );
}

if (import.meta.main) {
  main();
}
