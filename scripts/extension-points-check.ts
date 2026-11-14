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

/** Category names seeded into the allow-list table by any migration's `INSERT ... VALUES`. */
export function collectSeededWorkerCategories(
  migrations: readonly { name: string; sql: string }[]
): Set<string> {
  const seeded = new Set<string>();
  const insert = new RegExp(
    `INSERT\\s+INTO\\s+${WORKER_CATEGORY_TABLE}\\s*\\([^)]*\\)\\s*VALUES\\s*([\\s\\S]*?)(?:ON\\s+CONFLICT|;)`,
    "gi"
  );

  for (const migration of migrations) {
    const sql = migration.sql.replace(/^\s*--.*$/gm, "");

    for (const match of sql.matchAll(insert)) {
      for (const literal of (match[1] ?? "").matchAll(/'([^']+)'/g)) {
        seeded.add(literal[1]!);
      }
    }
  }

  return seeded;
}

export function findWorkerCategoryProblems(
  modules: readonly ModuleDescriptor[],
  seeded: ReadonlySet<string>
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
    if (!base.has(category) && !declaredWorker.has(category)) {
      problems.push(
        `${WORKER_CATEGORY_TABLE} seeds "${category}", which is ${
          declaredAny.has(category)
            ? "declared by a module without workerInsert: true"
            : "neither a base category nor declared by any module"
        }. An allowance nobody owns widens the worker silently; declare it workerInsert, or drop the row.`
      );
    }
  }

  return problems;
}

/** Migrations after the guard's own that re-issue the function. */
export function findGuardFunctionReissues(
  migrations: readonly { name: string; sql: string }[]
): string[] {
  const pattern = new RegExp(
    `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+${GUARD_FUNCTION_NAME}\\b`,
    "i"
  );

  return migrations
    .filter((migration) => {
      const prefix = Number.parseInt(migration.name.slice(0, 4), 10);

      return (
        prefix > GUARD_FUNCTION_MIGRATION_PREFIX &&
        pattern.test(migration.sql.replace(/^\s*--.*$/gm, ""))
      );
    })
    .map((migration) => migration.name);
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

  for (const problem of findWorkerCategoryProblems(
    modules,
    collectSeededWorkerCategories(migrations)
  )) {
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
