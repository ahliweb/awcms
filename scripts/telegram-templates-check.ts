#!/usr/bin/env bun
/**
 * `bun run telegram:templates:check` — the registry gate of ADR-0140 section 1.
 *
 * The Telegram adapter carries ONE class, operational and staff alerts. The
 * refusal of payroll, personal data, customer-facing, `security` and marketing
 * traffic is enforced by what a template CAN express (see
 * `telegram-templates.ts`); this gate is the part of that enforcement CI owns,
 * because a registration only runs when something imports the module that makes
 * it, and a runtime check cannot see a module nobody loaded.
 *
 * ## What it checks
 *
 * 1. **A payroll-bearing module does not touch the Telegram port at all.** A
 *    module is payroll-bearing when its descriptor DECLARES it
 *    (`handlesPayrollData`, e.g. `hr_commission`); a directory-name pattern is
 *    kept only as a second belt. Any source file under such a module that
 *    imports or names the Telegram templates, port or enqueue fails, whether or
 *    not it ever calls `registerTelegramTemplate`.
 * 2. **Every registration is found however it is spelled**: a direct call, a
 *    renamed import (`import { registerTelegramTemplate as reg }`), a namespace
 *    import (`T.registerTelegramTemplate(...)`). A reference that is NOT a call
 *    (an assignment, a re-export, a dynamic `import()` of the module) cannot be
 *    followed statically and fails as indirect.
 * 3. **A literal `ownerModuleKey` must be the module the file lives in**, must
 *    not be a payroll-bearing module, and must equal the key's prefix.
 * 4. **No deny-listed variable name** in a literal `name:`, and **no payroll term
 *    in a literal `body:`** (the same predicates registration uses).
 * 5. **The live registry agrees**: every registered template is re-validated.
 *
 * ## What this cannot see, stated rather than hoped
 *
 * THIS GATE IS A HEURISTIC, NOT A PROOF. A static scan is blind to a key, a
 * body or a variable name BUILT AT RUNTIME, to a template registered by a
 * dependency, and to a payroll module that never declared itself. That is why
 * registration itself refuses the same things, why the port takes a template key
 * and allow-listed variables only, and why no variable kind can carry free
 * text: this gate is the second layer, not the only one. A payroll-bearing
 * module that omits `handlesPayrollData` is a review finding.
 *
 * Pure: reads source text and the in-process registries. No database, no network.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { listModules } from "../src/modules";
import {
  deniedWordInVariableName,
  isPayrollOwningKeyPrefix,
  listTelegramTemplates,
  payrollWordInWording,
  templateKeyPrefix,
  type TelegramTemplateDefinition
} from "../src/modules/telegram-delivery/domain/telegram-templates";
import { stripComments } from "./lib/source-text";
import { collectClaims, routeOf } from "./validate-module-routes";

const ROOTS = ["src", "scripts"];
const REGISTER = "registerTelegramTemplate";
const TEMPLATES_MODULE = /telegram-templates["']/;
/** What a payroll-bearing module's source may never name. */
const TELEGRAM_PORT_REFERENCE =
  /telegram-templates|telegram-delivery-port|TelegramDeliveryPort|telegram-enqueue|registerTelegramTemplate|modules\/telegram-delivery\//;

/** `src/modules/<dir>/` for every module whose descriptor declares `handlesPayrollData`. */
export function declaredPayrollModuleDirs(
  modules: readonly { key: string; handlesPayrollData?: true }[] = listModules()
): string[] {
  return modules
    .filter((module) => module.handlesPayrollData === true)
    .map((module) => `src/modules/${module.key.replaceAll("_", "-")}/`);
}

/**
 * A declared module whose derived directory does not exist is a FAILURE, not a
 * module with nothing to scan (audit N5): a key that does not map to its
 * directory name would otherwise leave the gate guarding an empty path while
 * reporting success.
 */
export function payrollDirProblems(
  dirs: readonly string[],
  exists: (dir: string) => boolean = existsSync
): string[] {
  return dirs
    .filter((dir) => !exists(dir))
    .map(
      (dir) =>
        `${dir} does not exist, but a module declares handlesPayrollData. Its directory is derived from its key (underscores to hyphens); fix the mapping so the gate scans the real directory.`
    );
}

/** `src/modules/hr-commission/` -> `hr-commission` and `hr_commission`. */
function dirTokens(dir: string): { kebab: string; snake: string } {
  const kebab = dir.replace(/^src\/modules\//, "").replace(/\/$/, "");

  return { kebab, snake: kebab.replaceAll("-", "_") };
}

/**
 * True for a file a payroll-bearing module OWNS, wherever it lives (audit N1):
 *
 * - its module directory;
 * - an API route under a prefix the route-ownership registry
 *   (`modules:routes:check`'s `api.routes`) assigns to it;
 * - an admin page at or under one of its `navigation` paths;
 * - any file under `src/pages/` or `scripts/` whose path carries the module's
 *   directory name as a segment or a file-name prefix (a second belt for a route
 *   the registry does not claim yet).
 *
 * A directory-name pattern stays as a last belt for a module that never declared.
 */
export function isPayrollOwningPath(
  relativePath: string,
  declaredDirs: readonly string[] = declaredPayrollModuleDirs(),
  modules: readonly {
    key: string;
    handlesPayrollData?: true;
    api?: { basePath: string; routes?: string[]; openApiPath?: string };
    navigation?: { path: string }[];
  }[] = listModules()
): boolean {
  if (declaredDirs.some((dir) => relativePath.startsWith(dir))) {
    return true;
  }

  const match = /^src\/modules\/([^/]+)\//.exec(relativePath);

  if (match) {
    return /payroll|payslip|commission/.test(match[1]!);
  }

  const flagged = declaredDirs.map(dirTokens);
  const flaggedKeys = new Set(flagged.map((token) => token.snake));

  if (relativePath.startsWith("src/pages/")) {
    const route = routeOf(relativePath);

    if (route.startsWith("/admin")) {
      for (const module of modules) {
        if (
          flaggedKeys.has(module.key) &&
          (module.navigation ?? []).some(
            (entry) =>
              route === entry.path || route.startsWith(`${entry.path}/`)
          )
        ) {
          return true;
        }
      }
    } else {
      const { claims } = collectClaims(modules);
      // Claims are longest-first. A prefix matches only on a path BOUNDARY: a
      // bare `startsWith` would let `/api/v1/hr-commissioner` belong to
      // `/api/v1/hr-commission` (and, the other way, miss nothing it should).
      const owner =
        claims.find(
          (claim) =>
            route === claim.prefix ||
            route.startsWith(
              claim.prefix.endsWith("/") ? claim.prefix : `${claim.prefix}/`
            )
        )?.moduleKey ?? null;

      if (owner !== null && flaggedKeys.has(owner)) {
        return true;
      }
    }
  }

  // Anywhere else under src/ or scripts/ (src/lib, src/components, scripts):
  // the module's directory name, kebab or snake case, as a path segment or as the
  // start of a file name.
  const segments = relativePath.split("/");
  const base = segments[segments.length - 1]!;

  return flagged.some(({ kebab, snake }) =>
    [kebab, snake].some(
      (token) =>
        segments.slice(0, -1).includes(token) ||
        base === token ||
        (/^[.\-_]/.test(base.slice(token.length)) && base.startsWith(token))
    )
  );
}

export type RegistrationSite = {
  file: string;
  keys: string[];
  owners: string[];
  bodies: string[];
  variableNames: string[];
  /** A reference to `registerTelegramTemplate` that is not a call, or a dynamic import of its module. */
  indirect: boolean;
};

/** The names `registerTelegramTemplate` is bound to in this file: itself, plus every `as` alias. */
function registrationNames(code: string): string[] {
  const names = new Set<string>([REGISTER]);

  for (const match of code.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["'][^"']*telegram-templates["']/g
  )) {
    for (const specifier of match[1]!.split(",")) {
      const alias = new RegExp(`${REGISTER}\\s+as\\s+([A-Za-z_$][\\w$]*)`).exec(
        specifier
      );

      if (alias) {
        names.add(alias[1]!);
      }
    }
  }

  return [...names];
}

/** The text of each balanced `name( ... )` call in a comment-stripped source, for each of `names`. */
export function extractRegistrationCalls(
  code: string,
  names: readonly string[] = [REGISTER]
): string[] {
  const calls: string[] = [];

  for (const name of names) {
    const needle = `${name}(`;
    let from = 0;

    for (;;) {
      const start = code.indexOf(needle, from);

      if (start === -1) {
        break;
      }

      // `name(` inside a longer identifier (`xregister(`) is not this call.
      const before = start === 0 ? "" : code[start - 1]!;

      if (/[\w$]/.test(before)) {
        from = start + needle.length;
        continue;
      }

      let depth = 0;
      let end = start + needle.length - 1;

      for (; end < code.length; end += 1) {
        const character = code[end];

        if (character === "(") depth += 1;
        if (character === ")") {
          depth -= 1;

          if (depth === 0) break;
        }
      }

      calls.push(code.slice(start, end + 1));
      from = end + 1;
    }
  }

  return calls;
}

const STRING_LITERAL = (property: string) =>
  new RegExp(`\\b${property}:\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`, "g");

export function scanRegistrationSite(
  file: string,
  source: string
): RegistrationSite | null {
  const code = stripComments(source);
  const names = registrationNames(code);
  const calls = extractRegistrationCalls(code, names);
  const importsModule = TEMPLATES_MODULE.test(code);

  // Count references that are NOT a call and NOT an import specifier.
  const withoutImports = code.replace(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*["']/g,
    ""
  );
  let references = 0;

  for (const name of names) {
    references += (
      withoutImports.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g")) ??
      []
    ).length;
  }

  const callCount = calls.length;
  const dynamicImport = /import\(\s*["'][^"']*telegram-templates["']\s*\)/.test(
    code
  );
  const requireCall = /require\(\s*["'][^"']*telegram-templates["']\s*\)/.test(
    code
  );
  const indirect = references > callCount || dynamicImport || requireCall;

  if (callCount === 0 && !indirect && !(importsModule && references > 0)) {
    return null;
  }

  const keys: string[] = [];
  const owners: string[] = [];
  const bodies: string[] = [];
  const variableNames: string[] = [];

  for (const call of calls) {
    for (const match of call.matchAll(/\bkey:\s*"([^"]+)"/g)) {
      keys.push(match[1]!);
    }

    for (const match of call.matchAll(/\bownerModuleKey:\s*"([^"]+)"/g)) {
      owners.push(match[1]!);
    }

    for (const match of call.matchAll(STRING_LITERAL("body"))) {
      bodies.push(match[1] ?? match[2] ?? match[3] ?? "");
    }

    for (const match of call.matchAll(/\bname:\s*"([^"]+)"/g)) {
      variableNames.push(match[1]!);
    }
  }

  return { file, keys, owners, bodies, variableNames, indirect };
}

/** A payroll-bearing module's file that names the Telegram port, templates or enqueue at all. */
export function scanPayrollModuleTouch(
  file: string,
  source: string,
  declaredDirs: readonly string[] = declaredPayrollModuleDirs()
): string | null {
  if (!isPayrollOwningPath(file, declaredDirs)) {
    return null;
  }

  const code = stripComments(source);

  return TELEGRAM_PORT_REFERENCE.test(code)
    ? `${file}: a file owned by a payroll-bearing module names the Telegram port, templates or enqueue. Payroll notices never go to Telegram (ADR-0140 section 1); remove the reference.`
    : null;
}

/**
 * No file outside `telegram_delivery` may be able to enqueue a `system.*` key
 * (audit N1/M1). `enqueueTelegramMessage` refuses one at runtime and offers no
 * way to lift that; this is the CI half: a file elsewhere that names a literal
 * `system.*` key beside the enqueue path, or names the module-internal
 * `enqueueActivationNotice`, fails.
 */
export function scanSystemKeyCaller(
  file: string,
  source: string
): string | null {
  if (
    file.startsWith("src/modules/telegram-delivery/") ||
    // The module's own routes (`/api/v1/telegram/**`, owned by it in the
    // route-ownership registry): the confirm route queues the activation notice.
    file.startsWith("src/pages/api/v1/telegram/") ||
    file === "scripts/telegram-templates-check.ts"
  ) {
    return null;
  }

  const code = stripComments(source);
  const touchesEnqueue =
    /telegram-enqueue|enqueueTelegramMessage|TelegramDeliveryPort|telegram-delivery-port|telegramDeliveryPortAdapter/.test(
      code
    );
  const namesSystemKey = /["'`]system\.[a-z_][a-z0-9_]*["'`]/.test(code);

  if (touchesEnqueue && namesSystemKey) {
    return `${file}: names a system.* template key beside the Telegram enqueue path. Only telegram_delivery sends system.* templates.`;
  }

  if (/enqueueActivationNotice|allowSystemTemplates/.test(code)) {
    return `${file}: references a telegram_delivery-internal sender (enqueueActivationNotice / allowSystemTemplates).`;
  }

  return null;
}

/** `src/modules/<dir>/...` -> the module key `<dir>` with underscores, or `null` outside a module. */
function moduleKeyOfPath(file: string): string | null {
  const match = /^src\/modules\/([^/]+)\//.exec(file);

  return match ? match[1]!.replaceAll("-", "_") : null;
}

export function evaluateRegistrationSites(
  sites: readonly RegistrationSite[],
  declaredDirs: readonly string[] = declaredPayrollModuleDirs()
): string[] {
  const problems: string[] = [];
  const declaredKeys = new Set(
    declaredDirs.map((dir) =>
      dir
        .replace(/^src\/modules\//, "")
        .replace(/\/$/, "")
        .replaceAll("-", "_")
    )
  );

  for (const site of sites) {
    if (isPayrollOwningPath(site.file, declaredDirs)) {
      problems.push(
        `${site.file}: registers a Telegram template from a payroll-owning module. Payroll notices never go to Telegram (ADR-0140 section 1).`
      );
    }

    if (site.indirect) {
      problems.push(
        `${site.file}: references registerTelegramTemplate other than by a direct call (alias assignment, re-export, dynamic import). A static gate cannot follow it; call it directly.`
      );
    }

    const fileModule = moduleKeyOfPath(site.file);

    for (const owner of site.owners) {
      if (declaredKeys.has(owner)) {
        problems.push(
          `${site.file}: ownerModuleKey "${owner}" is a payroll-bearing module.`
        );
      }

      if (
        fileModule !== null &&
        owner !== fileModule &&
        !site.file.includes("/telegram-delivery/")
      ) {
        problems.push(
          `${site.file}: ownerModuleKey "${owner}" is not the module this file belongs to ("${fileModule}"). A template is registered by its own module.`
        );
      }
    }

    for (const key of site.keys) {
      const prefix = templateKeyPrefix(key);

      if (isPayrollOwningKeyPrefix(prefix) || declaredKeys.has(prefix)) {
        problems.push(
          `${site.file}: template "${key}" is under the payroll-owning module prefix "${prefix}".`
        );
      }

      if (
        site.owners.length > 0 &&
        !site.owners.includes(prefix) &&
        !(prefix === "system" && site.owners.includes("telegram_delivery"))
      ) {
        problems.push(
          `${site.file}: template "${key}" is not prefixed with its ownerModuleKey (${site.owners.join(", ")}).`
        );
      }
    }

    for (const body of site.bodies) {
      const term = payrollWordInWording(body.replace(/\{\{[^}]*\}\}/g, " "));

      if (term !== null) {
        problems.push(
          `${site.file}: template wording contains the payroll term "${term}".`
        );
      }
    }

    for (const name of site.variableNames) {
      const denied = deniedWordInVariableName(name);

      if (denied !== null) {
        problems.push(
          `${site.file}: variable "${name}" reads as "${denied}", a kind of data Telegram never carries (ADR-0140 section 1).`
        );
      }
    }
  }

  return problems;
}

export function evaluateLiveRegistry(
  templates: readonly TelegramTemplateDefinition[],
  declaredDirs: readonly string[] = declaredPayrollModuleDirs()
): string[] {
  const problems: string[] = [];
  const declaredKeys = new Set(
    declaredDirs.map((dir) =>
      dir
        .replace(/^src\/modules\//, "")
        .replace(/\/$/, "")
        .replaceAll("-", "_")
    )
  );

  for (const template of templates) {
    const prefix = templateKeyPrefix(template.key);

    if (template.purpose !== "staff_ops") {
      problems.push(`${template.key}: purpose is not "staff_ops".`);
    }

    if (
      isPayrollOwningKeyPrefix(prefix) ||
      declaredKeys.has(template.ownerModuleKey)
    ) {
      problems.push(
        `${template.key}: registered under a payroll-owning module.`
      );
    }

    const term = payrollWordInWording(
      template.body.replace(/\{\{[^}]*\}\}/g, " ")
    );

    if (term !== null) {
      problems.push(
        `${template.key}: wording contains the payroll term "${term}".`
      );
    }

    for (const variable of template.variables) {
      const denied = deniedWordInVariableName(variable.name);

      if (denied !== null) {
        problems.push(
          `${template.key}: variable "${variable.name}" reads as "${denied}".`
        );
      }
    }
  }

  return problems;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".astro")) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  // Importing the registry module registers its built-ins; `listModules()` loads
  // every module descriptor. Both are the live state this gate re-validates.
  const declared = declaredPayrollModuleDirs();
  const missing = payrollDirProblems(declared);

  if (missing.length > 0) {
    console.error("telegram:templates:check FAILED:");

    for (const problem of missing) {
      console.error(`  - ${problem}`);
    }

    process.exit(1);
  }

  if (declared.length === 0) {
    console.error(
      "telegram:templates:check FAILED: no module declares handlesPayrollData, but hr_commission must. The declaration was removed or the registry is not loading."
    );
    process.exit(1);
  }

  const sites: RegistrationSite[] = [];
  const touches: string[] = [];

  for (const root of ROOTS) {
    if (!existsSync(root)) {
      continue;
    }

    for await (const file of walk(root)) {
      await scan(file);
    }
  }

  async function scan(file: string): Promise<void> {
    const relative = file.split(path.sep).join("/");
    const source = await readFile(file, "utf8");
    const touch = scanPayrollModuleTouch(relative, source, declared);

    if (touch) {
      touches.push(touch);
    }

    const systemCaller = scanSystemKeyCaller(relative, source);

    if (systemCaller) {
      touches.push(systemCaller);
    }

    const site = scanRegistrationSite(relative, source);

    if (
      site &&
      !relative.endsWith("telegram-templates.ts") &&
      relative !== "scripts/telegram-templates-check.ts"
    ) {
      sites.push(site);
    }
  }

  const problems = [
    ...touches,
    ...evaluateRegistrationSites(sites, declared),
    ...evaluateLiveRegistry(listTelegramTemplates(), declared)
  ];

  if (problems.length > 0) {
    console.error("telegram:templates:check FAILED:");

    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }

    process.exit(1);
  }

  console.log(
    `telegram:templates:check OK — ${listTelegramTemplates().length} registered template(s), ${sites.length} registration site(s) scanned, ${declared.length} payroll-bearing module(s) kept clear of the port. (A heuristic gate, not a proof: registration enforces the same rules at runtime.)`
  );
}

if (import.meta.main) {
  await main();
}
