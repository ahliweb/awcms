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
 * The e-mail categories a BASE module's worker transactions legitimately
 * enqueue. Base categories are not declared by any descriptor (a descriptor may
 * only declare `derived.*`), so the allow-list that gates them is this
 * reviewed list: one reason per entry, and the rule is EXACT in both
 * directions. A seeded row for a base category that is not named here is an
 * allowance nobody owns, however base the category is; an entry here that no
 * migration seeds is a stale reason. Adding an entry is a reviewed change to
 * this file.
 */
export const BASE_WORKER_CATEGORY_ALLOWANCES: Readonly<Record<string, string>> =
  {
    "hr.attendance_correction_applied":
      "hr_workforce tells a correction's requester how it ended, from the worker transaction that resolves it (sql/302, #1044)",
    "hr.attendance_correction_rejected":
      "hr_workforce tells a correction's requester how it ended, from the worker transaction that resolves it (sql/302, #1044)",
    "hr.attendance_correction_cancelled":
      "hr_workforce tells a correction's requester how it ended, from the worker transaction that resolves it (sql/302, #1044)"
  };

// ---------------------------------------------------------------------------
// SQL reading. Fail-closed: every statement that mentions the allow-list table
// or the guard must be one this file understands, or the gate reports it.
// ---------------------------------------------------------------------------

/** Removes `-- line` and `/* block *\/` comments, leaving string literals and dollar-quoted bodies intact. */
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (ch === "'") {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out += sql.slice(start, i);
    } else if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));

      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }

  return out;
}

/** Splits comment-free SQL into statements on `;` outside quotes and dollar-quoted bodies. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;

    if (ch === "'") {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      current += sql.slice(start, i);
    } else if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));

      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        current += sql.slice(i, stop);
        i = stop;
      } else {
        current += ch;
        i++;
      }
    } else if (ch === ";") {
      if (current.trim() !== "") statements.push(current.trim());
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.trim() !== "") statements.push(current.trim());

  return statements;
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
    for (const statement of splitSqlStatements(
      stripSqlComments(migration.sql)
    )) {
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
  > = BASE_WORKER_CATEGORY_ALLOWANCES
): string[] {
  const problems: string[] = [];
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
            ? "a base category with no entry in BASE_WORKER_CATEGORY_ALLOWANCES"
            : "neither claimed by a descriptor (workerInsert: true) nor listed in BASE_WORKER_CATEGORY_ALLOWANCES"
      }. An allowance nobody owns widens the worker silently; declare it workerInsert, give it a reviewed reason in BASE_WORKER_CATEGORY_ALLOWANCES, or drop the row.`
    );
  }

  for (const category of Object.keys(baseAllowances)) {
    if (!base.has(category)) {
      problems.push(
        `BASE_WORKER_CATEGORY_ALLOWANCES names "${category}", which is not a base e-mail category.`
      );
    } else if (!seeded.has(category)) {
      problems.push(
        `BASE_WORKER_CATEGORY_ALLOWANCES names "${category}" but no migration seeds it into ${WORKER_CATEGORY_TABLE}; drop the stale entry.`
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

    for (const statement of splitSqlStatements(
      stripSqlComments(migration.sql)
    )) {
      if (
        (GUARD_IDENTIFIER.test(statement) ||
          TRIGGER_IDENTIFIER.test(statement)) &&
        /^(?:CREATE|ALTER|DROP)\b/i.test(statement)
      ) {
        offenders.add(migration.name);
      }
    }
  }

  return [...offenders];
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
