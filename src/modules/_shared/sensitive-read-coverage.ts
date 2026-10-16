import { stripComments } from "../../../scripts/lib/source-text";
import type { ModuleDescriptor } from "./module-contract";
import { isPayrollTable } from "./payroll-data-boundary";
import {
  collectGuardTriples,
  collectStringConstants,
  permissionTripleKey,
  resolveConstantsForSource
} from "./permission-enforcement-coverage";
import {
  NOT_SENSITIVE_READS,
  PAYROLL_READ_FUNCTION_IMPORTS,
  PAYROLL_TABLE_SOURCE_EXEMPTIONS,
  auditCoversPayrollTable,
  findPayrollTableReadMapping,
  type PayrollReadFunctionImport,
  SENSITIVE_READ_MODULE_KEYS,
  SENSITIVE_READ_POLICIES,
  WRITE_SHAPED_ACTIONS,
  findSensitiveReadPolicy,
  validateSensitiveReadPolicies,
  type SensitiveReadPolicy
} from "./sensitive-reads";

/**
 * Sensitive-read coverage (Issue #978, finding PS-18 (a)).
 *
 * The question: can a read of sensitive data exist WITHOUT leaving an audit
 * row? This answers it syntactically, the way
 * `permission-enforcement-coverage.ts` answers "is a declared permission
 * enforced". Five rules:
 *
 * 1. **Call sites.** Every source file that guards a permission a policy covers
 *    must call `recordSensitiveRead` with that permission. A guard is found
 *    however the repo writes it: an inline literal, a `const GUARD = {...}`, or
 *    `authorize: GUARDS.accruals.read` resolved through the guard definitions
 *    (the style of ~160 routes; the first version of this gate read only inline
 *    literals and was blind to it, audit M1).
 * 2. **Classification, default-deny over ALL actions.** A module in
 *    `SENSITIVE_READ_MODULE_KEYS` may not declare a permission whose action is
 *    not on the write-shaped allow-list (`WRITE_SHAPED_ACTIONS`) without a
 *    policy or a reasoned exemption. A new verb (`view`, `print`, `reveal`) is
 *    read-shaped until someone says otherwise.
 * 3. **No computed guard.** A file that mentions a sensitive module and has an
 *    `authorize:` reference that resolves to no static permission, or an
 *    `activityCode` that is not a string literal or resolvable constant, fails:
 *    a guard the gate cannot read is a guard it cannot hold to rule 1.
 * 4. **Table readers, per table.** A source file whose text names a
 *    payroll-boundary table must call `recordSensitiveRead` with a permission
 *    that COVERS THAT TABLE (`PAYROLL_TABLE_READ_PERMISSIONS`), or be listed,
 *    with a reason, in `PAYROLL_TABLE_SOURCE_EXEMPTIONS` (a descriptor-only
 *    `module.ts`, the data-access layer whose callers audit). Attribution is
 *    per table: auditing `compensation.read` does not clear a file that also
 *    reads `payslips` (Issue #1015; the first version cleared every table in a
 *    file that audited anything).
 * 5. **Imports of a data-access file's read functions.** An exempt
 *    data-access file is trusted because its callers audit, so its read
 *    functions may be imported only by `PAYROLL_READ_FUNCTION_IMPORTS`'s
 *    allow-listed files, each of which must audit the permission itself
 *    (Issue #1015). A re-export, a namespace import and a dynamic `import()`
 *    count as importing all of them.
 * 6. **Dead entries.** Once the module exists, a policy or exemption naming a
 *    permission it does not declare is reported.
 *
 * ## What it cannot prove (the known syntactic limit)
 *
 * It proves the call is in the file that guards the permission (or names the
 * table), not that it sits on every code path of the handler or runs before the
 * data is returned. A call in a dead branch, after an early return, or guarded
 * by an always-false condition passes. The helper is proven by
 * `tests/integration/sensitive-read-audit.integration.test.ts`; a route's
 * behaviour by the route-level tests the #957/#961 acceptance wording requires
 * (hr-payroll.md section 13.3).
 *
 * Two more limits, recorded rather than closed (Issue #1015):
 *
 * - **A table name assembled from pieces** (`"awcms_hr_" + suffix`, a template
 *   with an interpolated middle, a name read from the catalog) is not a token
 *   the scan can see, so a file that builds one is invisible to rule 4. The
 *   SQL side of the same evasion IS closed, by reading the migrated catalog
 *   (`payroll:catalog-boundary:check`); the application side is held by review
 *   and by the fact that a payroll table is reachable only through its module's
 *   data-access file, which rule 5 gates.
 * - **Import resolution is by file name**, not by the module graph: a path that
 *   ends in the ledger's file name is the ledger. A copy of the file under
 *   another name is a new data-access file, and rule 4 catches it (it names the
 *   table).
 */
/**
 * `source` with the CONTENT of every string and template literal blanked out
 * (the quotes stay, every character keeps its offset). A call that appears only
 * inside a literal is text, not a call: `"await recordSensitiveRead(tx, ...)"`
 * in a log message or a fixture must not stand for an audit (Issue #1015, M7).
 * Offsets are preserved so arguments can still be read from the unmasked text.
 */
export function maskLiterals(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const quote = source[index]!;

    if (quote === '"' || quote === "'" || quote === "`") {
      let end = index + 1;

      while (end < source.length && source[end] !== quote) {
        end += source[end] === "\\" ? 2 : 1;
      }

      end = Math.min(end, source.length);
      out +=
        quote +
        " ".repeat(Math.max(0, end - index - 1)) +
        (end < source.length ? quote : "");
      index = end + 1;
      continue;
    }

    out += quote;
    index += 1;
  }

  return out;
}

/**
 * True for a file that only DESCRIBES a module: `src/modules/<key>/module.ts`
 * and not under `src/pages`, with no route-handler export. A `module.ts` that
 * exports `GET`/`POST`/... is a route that happens to share the name, and the
 * exemption for descriptors does not cover it (Issue #1015, M7).
 */
export function isModuleDescriptorFile(name: string, source: string): boolean {
  return (
    /^src\/modules\/[^/]+\/module\.ts$/.test(name) &&
    !/\bexport\s+(?:async\s+)?(?:const|function)\s+(?:GET|POST|PUT|PATCH|DELETE|ALL|OPTIONS|HEAD)\b/.test(
      source
    ) &&
    !/\bexport\s*\{[^}]*\b(?:GET|POST|PUT|PATCH|DELETE|ALL)\b/.test(source)
  );
}

/**
 * Fail-closed shape of the audit call (Issue #1014 L6).
 *
 * `recordSensitiveRead` aborts the caller's transaction when it throws; a
 * route that wraps it in `try { } catch { }` (or `.catch(() => {})`, or does
 * not await it) turns that into "read succeeded, audit lost" and nothing else
 * in the gate can see it. This is the syntactic half: every call must be
 * `await`ed or `return`ed (or be an arrow's concise body), must not be chained
 * with `.catch`/`.then`, and must not sit inside a `try` whose `catch` has no
 * `throw`. The behavioural half is the route test that injects a failing audit
 * insert and asserts no data comes back (`tests/sensitive-read-fail-closed-
 * contract.test.ts` holds the reusable assertion).
 */
export function findSwallowedSensitiveReads(source: string): string[] {
  const clean = maskLiterals(stripComments(source));
  const problems: string[] = [];

  for (const call of clean.matchAll(/\brecordSensitiveRead\s*\(/g)) {
    const start = call.index!;
    const before = clean.slice(0, start).trimEnd();

    if (/\bfunction\s*$/.test(before) || /\bimport\s*\{[^}]*$/.test(before)) {
      continue;
    }
    if (/^\s*(?:,|\})/.test(clean.slice(start + call[0].length))) continue;

    const where = `near offset ${start}`;

    if (!/(?:\bawait|\breturn|=>)$/.test(before)) {
      problems.push(
        `recordSensitiveRead (${where}) is not awaited or returned, so a failed audit would not stop the read`
      );
    }

    const open = start + call[0].length - 1;
    let depth = 0;
    let close = clean.length;

    for (let index = open; index < clean.length; index += 1) {
      if (clean[index] === "(") depth += 1;
      if (clean[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }

    if (/^\s*\.(?:catch|then|finally)\s*\(/.test(clean.slice(close + 1))) {
      problems.push(
        `recordSensitiveRead (${where}) is chained with .catch/.then/.finally, which can swallow its failure`
      );
    }

    // Walk outward through the enclosing blocks; any `try` whose `catch` has
    // no `throw` swallows the audit failure.
    let level = 0;

    for (let index = start - 1; index >= 0; index -= 1) {
      const char = clean[index];

      if (char === "}") level += 1;
      else if (char === "{") {
        if (level > 0) {
          level -= 1;
          continue;
        }
        if (!/\btry\s*$/.test(clean.slice(0, index))) continue;

        let blockDepth = 0;
        let blockEnd = -1;

        for (let k = index; k < clean.length; k += 1) {
          if (clean[k] === "{") blockDepth += 1;
          if (clean[k] === "}") {
            blockDepth -= 1;
            if (blockDepth === 0) {
              blockEnd = k;
              break;
            }
          }
        }

        const rest = clean.slice(blockEnd + 1);
        const catchMatch = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(rest);

        if (!catchMatch) continue;

        const catchOpen = blockEnd + 1 + catchMatch[0].length - 1;
        let catchDepth = 0;
        let catchEnd = clean.length;

        for (let k = catchOpen; k < clean.length; k += 1) {
          if (clean[k] === "{") catchDepth += 1;
          if (clean[k] === "}") {
            catchDepth -= 1;
            if (catchDepth === 0) {
              catchEnd = k;
              break;
            }
          }
        }

        if (!/\bthrow\b/.test(clean.slice(catchOpen, catchEnd))) {
          problems.push(
            `recordSensitiveRead (${where}) sits inside a try whose catch never rethrows, so a failed audit would still return the data`
          );
        }
      }
    }
  }

  return problems;
}

export type UnauditedRoute = {
  permission: string;
  source: string;
};

export type SensitiveReadCoverageResult = {
  valid: boolean;
  policyProblems: string[];
  /** Guards for a covered permission whose file never calls `recordSensitiveRead` for it. */
  unauditedRoutes: UnauditedRoute[];
  /** Permissions of a sensitive module with no policy, no exemption and a non-write-shaped action. */
  unclassified: string[];
  /** Policies or exemptions naming a permission the (existing) module does not declare. */
  deadEntries: string[];
  /** Exemptions for a permission that a policy also covers. */
  conflictingExemptions: string[];
  /** Guards in a sensitive-module file that resolve to no static permission. */
  computedGuards: string[];
  /** Files naming a payroll-boundary table that neither audit nor are exempt. */
  unauditedTableReaders: { source: string; tables: string[] }[];
  /** Files that audit, but not with a permission that covers a payroll table they name (Issue #1015). */
  uncoveredTableReaders: {
    source: string;
    tables: string[];
    needs: Record<string, string[]>;
  }[];
  /** Files importing a guarded data-access read function without being allowed, or without auditing. */
  forbiddenReadImports: {
    source: string;
    functions: string[];
    problem: string;
  }[];
  /** Allow-listed importers that no longer import the function. */
  staleImportAllowances: string[];
  /** Exemptions for a file that no longer exists or no longer names such a table. */
  staleSourceExemptions: string[];
  /** Calls of `recordSensitiveRead` that could swallow their own failure (Issue #1014 L6). */
  swallowedAudits: { source: string; problem: string }[];
  coveredGuardCount: number;
};

export type SensitiveReadCoverageOptions = {
  policies?: readonly SensitiveReadPolicy[];
  notSensitive?: Readonly<Record<string, string>>;
  sensitiveModuleKeys?: readonly string[];
  tableSourceExemptions?: Readonly<Record<string, string>>;
  readFunctionImports?: readonly PayrollReadFunctionImport[];
};

/** The text of a call's argument list, from just after `(` to its matching `)`. */
function callArguments(source: string, openParen: number): string {
  let depth = 0;

  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") depth += 1;

    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, index);
    }
  }

  return source.slice(openParen + 1);
}

/**
 * Every permission key a source passes to `recordSensitiveRead`, read from the
 * `permission:` field of the call's argument. A string literal or a
 * `const NAME = "key"` resolves; anything else is not counted (a computed
 * permission cannot be verified statically, and an unverifiable audit is not
 * evidence of one).
 */
export function collectAuditedPermissions(
  source: string,
  constants: ReadonlyMap<string, string | null> = new Map()
): Set<string> {
  const clean = stripComments(source);
  const audited = new Set<string>();

  // Calls are found outside literals; their arguments are read from the real text.
  for (const call of maskLiterals(clean).matchAll(
    /\brecordSensitiveRead\s*\(/g
  )) {
    const open = call.index! + call[0].length - 1;
    const args = callArguments(clean, open);
    const field =
      /\bpermission\s*:\s*(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))/.exec(args);

    if (!field) continue;

    const key = field[1] ?? constants.get(field[2]!) ?? null;

    if (key) audited.add(key);
  }

  return audited;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;

  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** The body with every nested `{...}` blanked, so a field is read only when it is this object's own. */
function ownFields(body: string): string {
  let depth = 0;
  let masked = "";

  for (const character of body) {
    if (character === "{") {
      depth += 1;
      masked += " ";
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      masked += " ";
      continue;
    }

    masked += depth > 0 ? " " : character;
  }

  return masked;
}

function literalField(fields: string, name: string): string | null {
  return new RegExp(`\\b${name}\\s*:\\s*"([^"]+)"`).exec(fields)?.[1] ?? null;
}

/**
 * Guard definitions in one source: every nested object under a `const NAME =
 * {...}` that carries `moduleKey`, `activityCode` and `action` as string
 * literals, keyed by its dotted path (`HR_COMMISSION_GUARDS.accruals.read`).
 */
export function collectGuardDefinitions(source: string): Map<string, string> {
  const clean = stripComments(source);
  const definitions = new Map<string, string>();

  const walk = (body: string, path: string): void => {
    const own = ownFields(body);
    const moduleKey = literalField(own, "moduleKey");
    const activityCode = literalField(own, "activityCode");
    const action = literalField(own, "action");

    if (moduleKey && activityCode && action) {
      definitions.set(
        path,
        permissionTripleKey({ moduleKey, activityCode, action })
      );
    }

    for (const property of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{/g)) {
      const open = property.index! + property[0].length - 1;
      const before = body.slice(0, property.index);
      const depth =
        (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);

      if (depth !== 0) continue;

      const close = matchingBrace(body, open);

      if (close === -1) continue;

      walk(body.slice(open + 1, close), `${path}.${property[1]}`);
    }
  };

  for (const declaration of clean.matchAll(
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\{/g
  )) {
    const open = declaration.index! + declaration[0].length - 1;
    const close = matchingBrace(clean, open);

    if (close === -1) continue;

    walk(clean.slice(open + 1, close), declaration[1]!);
  }

  return definitions;
}

/** Definitions across all sources; a path defined twice with different keys resolves to null. */
function collectAllGuardDefinitions(
  sources: readonly string[]
): Map<string, string | null> {
  const all = new Map<string, string | null>();

  for (const source of sources) {
    for (const [path, key] of collectGuardDefinitions(source)) {
      all.set(path, all.has(path) && all.get(path) !== key ? null : key);
    }
  }

  return all;
}

/**
 * Every `authorize` property in a route, as the text it was given: a path
 * (`GUARDS.accruals.read`), or anything else (a ternary, a parenthesised
 * expression, a bracket access, a call, an empty value, or the shorthand
 * `{ authorize }`). The caller resolves the paths and REPORTS the rest: a guard
 * written in a shape the gate cannot parse must not be silently skipped (#978
 * re-audit M-A).
 */
function collectAuthorizeRefs(source: string): string[] {
  const clean = stripComments(source);
  const refs: string[] = [];

  for (const found of clean.matchAll(/\bauthorize\b(?!\s*[(=.])(\s*:)?/g)) {
    const after = clean.slice(found.index! + found[0].length);

    if (found[1]) {
      const value = (after.match(/^[^\n]*/)?.[0] ?? "").trim();

      // An inline object literal is read as a guard by `collectGuardTriples`.
      if (value.startsWith("{")) continue;

      // The ANY-of array form (`authorize: [A, B]`, possibly multi-line): each
      // identifier element is a reference of its own (Issue #1083). Before this
      // the whole `[` was one unresolvable reference, so a route with two
      // alternative permissions could not be held to the audit rule at all.
      if (value.startsWith("[")) {
        const open = after.indexOf("[");
        const close = after.indexOf("]", open);
        const raw = close === -1 ? "" : after.slice(open + 1, close);
        // Skip `{ ... }` spans first (an inline guard object is read by
        // `collectGuardTriples`; splitting on its inner commas would fragment
        // it into bogus references): Issue #1083 L-5.
        let body = "";
        let depth = 0;

        for (const char of raw) {
          if (char === "{") depth += 1;
          else if (char === "}") depth = Math.max(0, depth - 1);
          else if (depth === 0) body += char;
        }

        for (const element of body.split(",")) {
          const reference = element.trim();

          if (reference && !reference.startsWith("{")) refs.push(reference);
        }

        continue;
      }

      refs.push(value.replace(/,$/, "").trim());
      continue;
    }

    // Shorthand: `authorize` followed by `,` or `}` is the property itself.
    if (/^\s*[,}]/.test(after)) refs.push("(shorthand authorize)");
  }

  return refs;
}

/** The file-name stem of a module specifier or repo path: `../x/ledger.ts` -> `ledger`. */
function moduleStem(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;

  return last.replace(/\.(?:ts|tsx|js|mjs|astro)$/, "");
}

/** Original names in a `{ a, b as c, type d }` list. */
function namedImports(list: string): string[] {
  const names: string[] = [];

  for (const item of list.split(",")) {
    const entry = item.trim();

    if (!entry || /^type\s/.test(entry)) continue;

    names.push(entry.split(/\s+as\s+/)[0]!.trim());
  }

  return names;
}

/**
 * The names `source` imports from a module whose file name is `stem`: a list of
 * original names, or `"*"` when it takes the whole module (namespace import,
 * default import, `export * from`, dynamic `import()`, `require`). Type-only
 * imports are skipped: a type cannot read a row.
 */
export function importedNamesFrom(source: string, stem: string): string[] {
  const clean = stripComments(source);
  const names = new Set<string>();
  const matches = (specifier: string): boolean =>
    moduleStem(specifier) === stem;

  for (const found of clean.matchAll(
    /\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g
  )) {
    if (!matches(found[3]!) || found[1]) continue;

    const clause = found[2]!.trim();
    const named = /\{([^}]*)\}/.exec(clause);
    const outside = clause
      .replace(/\{[^}]*\}/, "")
      .replace(/,/g, " ")
      .trim();

    if (outside) names.add("*");

    for (const name of namedImports(named?.[1] ?? "")) names.add(name);
  }

  for (const found of clean.matchAll(
    /\bexport\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g
  )) {
    if (!matches(found[3]!) || found[1]) continue;

    if (found[2]!.startsWith("*")) {
      names.add("*");
      continue;
    }

    for (const name of namedImports(found[2]!.slice(1, -1))) names.add(name);
  }

  for (const found of clean.matchAll(/\b(?:import|require)\s*\(([^)]*)\)/g)) {
    const argument = found[1]!.trim();
    const plain = /^(["'])([^"']*)\1$/.exec(argument);

    if (plain) {
      if (matches(plain[2]!)) names.add("*");
      continue;
    }

    // A template literal or a computed expression: the specifier is not known
    // until run time. If its visible pieces name the file (a prefix, a concat of
    // fragments of the stem), it is importing everything. A bare identifier
    // with no such piece is invisible to a text scan (documented limit).
    const fragments = stem.split("-").filter((part) => part.length >= 6);

    if (
      argument.includes(stem) ||
      fragments.some((fragment) => argument.includes(fragment))
    ) {
      names.add("*");
    }
  }

  return [...names];
}

/**
 * Rule 5 (Issue #1015): imports of a guarded data-access file's read
 * functions. Returns the violations and the allow-listed importers that no
 * longer import anything.
 */
export function findForbiddenReadImports(
  sources: readonly string[],
  sourceNames: readonly string[],
  registry: readonly PayrollReadFunctionImport[],
  constantsFor: (source: string) => ReadonlyMap<string, string | null>
): {
  forbidden: { source: string; functions: string[]; problem: string }[];
  stale: string[];
} {
  const forbidden: { source: string; functions: string[]; problem: string }[] =
    [];
  const stale: string[] = [];
  const scanned = new Set(sourceNames);

  for (const entry of registry) {
    const stem = moduleStem(entry.source);
    const importers = new Set<string>();

    for (const [index, source] of sources.entries()) {
      const name = sourceNames[index];

      if (!name || name === entry.source) continue;

      const imported = importedNamesFrom(source, stem);
      const reads = imported.includes("*")
        ? [...entry.functions]
        : entry.functions.filter((fn) => imported.includes(fn));

      if (reads.length === 0) continue;

      importers.add(name);

      if (!entry.allowedImporters.includes(name)) {
        forbidden.push({
          source: name,
          functions: reads,
          problem: `imports ${reads.join(", ")} from ${entry.source} but is not in PAYROLL_READ_FUNCTION_IMPORTS allowedImporters. Those functions return payroll-boundary rows; a new caller is a new read path and must be added there together with its audit`
        });
      } else if (
        !(
          Object.hasOwn(entry.auditExemptImporters ?? {}, name) &&
          reads.every((fn) => entry.writePathFunctions?.includes(fn))
        ) &&
        !collectAuditedPermissions(source, constantsFor(source)).has(
          entry.permission
        )
      ) {
        forbidden.push({
          source: name,
          functions: reads,
          problem: `imports ${reads.join(", ")} from ${entry.source} but never calls recordSensitiveRead({ permission: "${entry.permission}", ... })`
        });
      }
    }

    for (const allowed of entry.allowedImporters) {
      if (scanned.has(allowed) && !importers.has(allowed)) stale.push(allowed);
    }
  }

  return { forbidden, stale };
}

const SENSITIVE_MENTION = (keys: readonly string[]): RegExp =>
  new RegExp(`(?:${keys.map((key) => key.replace(/_/g, "[_-]")).join("|")})`);

export function evaluateSensitiveReadCoverage(
  modules: readonly ModuleDescriptor[],
  sources: readonly string[],
  sourceNames: readonly string[] = [],
  options: SensitiveReadCoverageOptions = {}
): SensitiveReadCoverageResult {
  const policies = options.policies ?? SENSITIVE_READ_POLICIES;
  const notSensitive = options.notSensitive ?? NOT_SENSITIVE_READS;
  const sensitiveModules =
    options.sensitiveModuleKeys ?? SENSITIVE_READ_MODULE_KEYS;
  const tableExemptions =
    options.tableSourceExemptions ?? PAYROLL_TABLE_SOURCE_EXEMPTIONS;
  const mention = SENSITIVE_MENTION(sensitiveModules);

  const policyProblems = validateSensitiveReadPolicies(policies);
  const crossFileConstants = collectStringConstants(sources);
  const guardDefinitions = collectAllGuardDefinitions(sources);
  const unauditedRoutes: UnauditedRoute[] = [];
  const computedGuards: string[] = [];
  const unauditedTableReaders: { source: string; tables: string[] }[] = [];
  const uncoveredTableReaders: SensitiveReadCoverageResult["uncoveredTableReaders"] =
    [];
  const swallowedAudits: { source: string; problem: string }[] = [];
  const usedTableExemptions = new Set<string>();
  let coveredGuardCount = 0;

  for (const [index, source] of sources.entries()) {
    const name = sourceNames[index] ?? `source #${index}`;
    const constants = resolveConstantsForSource(source, crossFileConstants);
    const clean = stripComments(source);
    const audited = collectAuditedPermissions(source, constants);

    // Rules 1 and 3: guards, however they are written. A file that only
    // DEFINES guard objects (a `*-permissions.ts`) enforces nothing.
    const usesGuards =
      /\bauthorizeInTransaction\b|\bdefineTenantRoute\b|\bauthorize\s*:/.test(
        clean
      );
    const guarded = new Set(
      usesGuards
        ? collectGuardTriples(source, constants).map(permissionTripleKey)
        : []
    );

    // The gate's own implementation files describe guards in prose and regexes.
    const internals = name.startsWith("src/modules/_shared/");

    if (!internals) {
      for (const problem of findSwallowedSensitiveReads(source)) {
        swallowedAudits.push({ source: name, problem });
      }
    }

    for (const ref of internals ? [] : collectAuthorizeRefs(source)) {
      const resolved = guardDefinitions.get(ref);

      if (resolved) {
        guarded.add(resolved);
        continue;
      }

      // An inline `authorize: {` object never reaches here (the regex wants an
      // identifier); a reference we cannot resolve is only a finding in a file
      // that has to do with a sensitive module.
      if (mention.test(source)) {
        computedGuards.push(
          `${name}: authorize: ${ref} resolves to no static permission`
        );
      }
    }

    if (!internals && mention.test(clean)) {
      for (const found of clean.matchAll(/\bactivityCode\s*:\s*([^,}\n]+)/g)) {
        const value = found[1]!.trim();

        if (value.startsWith('"')) continue;
        if (constants.get(value)) continue;

        computedGuards.push(
          `${name}: activityCode is ${value}, not a string literal or resolvable constant`
        );
      }
    }

    for (const permission of guarded) {
      if (!findSensitiveReadPolicy(permission, policies)) continue;

      coveredGuardCount += 1;

      if (!audited.has(permission)) {
        unauditedRoutes.push({ permission, source: name });
      }
    }

    // Rule 4: a source that names a payroll-boundary table.
    const tables = [
      ...new Set(
        [...clean.matchAll(/\bawcms_[a-z0-9_]+\b/gi)]
          .map((match) => match[0])
          .filter((table) => isPayrollTable(table))
      )
    ];

    if (tables.length > 0) {
      const exempt =
        Object.hasOwn(tableExemptions, name) ||
        isModuleDescriptorFile(name, clean) ||
        sourceNames.length === 0;

      if (audited.size === 0) {
        if (Object.hasOwn(tableExemptions, name)) usedTableExemptions.add(name);

        if (!exempt) {
          unauditedTableReaders.push({ source: name, tables });
        }
      } else if (!exempt) {
        // It audits something. Per table: does that audit stand for THIS table?
        const uncovered = tables.filter(
          (table) => !auditCoversPayrollTable(table, audited)
        );

        if (uncovered.length > 0) {
          uncoveredTableReaders.push({
            source: name,
            tables: uncovered,
            needs: Object.fromEntries(
              uncovered.map((table) => [
                table,
                [...(findPayrollTableReadMapping(table)?.permissions ?? [])]
              ])
            )
          });
        }
      }
    }
  }

  const importCheck = findForbiddenReadImports(
    sources,
    sourceNames,
    options.readFunctionImports ?? PAYROLL_READ_FUNCTION_IMPORTS,
    (source) => resolveConstantsForSource(source, crossFileConstants)
  );

  // An exemption for a file that IS scanned but no longer names a payroll
  // table. (An exemption for a file that no longer exists is the script's check:
  // this function sees only the sources it was handed.)
  const scanned = new Set(sourceNames);
  const staleSourceExemptions = Object.keys(tableExemptions).filter(
    (path) => scanned.has(path) && !usedTableExemptions.has(path)
  );

  const declared = new Map<string, string>();
  const presentModules = new Set(modules.map((module) => module.key));

  for (const module of modules) {
    for (const permission of module.permissions ?? []) {
      declared.set(
        permissionTripleKey({
          moduleKey: module.key,
          activityCode: permission.activityCode,
          action: permission.action
        }),
        permission.action
      );
    }
  }

  const unclassified: string[] = [];

  for (const [key, action] of declared) {
    const moduleKey = key.split(".")[0]!;

    if (!sensitiveModules.includes(moduleKey)) continue;
    if (WRITE_SHAPED_ACTIONS.includes(action)) continue;
    if (findSensitiveReadPolicy(key, policies)) continue;
    if (Object.hasOwn(notSensitive, key)) continue;

    unclassified.push(key);
  }

  const deadEntries: string[] = [];

  for (const policy of policies) {
    if (policy.permission.includes("*")) continue;

    const moduleKey = policy.permission.split(".")[0]!;

    if (presentModules.has(moduleKey) && !declared.has(policy.permission)) {
      deadEntries.push(
        `${policy.permission} (policy: ${policy.kind}) - module "${moduleKey}" does not declare it`
      );
    }
  }

  const conflictingExemptions: string[] = [];

  for (const key of Object.keys(notSensitive)) {
    const moduleKey = key.split(".")[0]!;

    if (presentModules.has(moduleKey) && !declared.has(key)) {
      deadEntries.push(
        `${key} (exemption) - module "${moduleKey}" does not declare it`
      );
    }

    if (findSensitiveReadPolicy(key, policies)) {
      conflictingExemptions.push(key);
    }
  }

  return {
    valid:
      policyProblems.length === 0 &&
      unauditedRoutes.length === 0 &&
      unclassified.length === 0 &&
      deadEntries.length === 0 &&
      conflictingExemptions.length === 0 &&
      computedGuards.length === 0 &&
      unauditedTableReaders.length === 0 &&
      uncoveredTableReaders.length === 0 &&
      importCheck.forbidden.length === 0 &&
      importCheck.stale.length === 0 &&
      staleSourceExemptions.length === 0 &&
      swallowedAudits.length === 0,
    policyProblems,
    unauditedRoutes,
    unclassified,
    deadEntries,
    conflictingExemptions,
    computedGuards,
    unauditedTableReaders,
    uncoveredTableReaders,
    forbiddenReadImports: importCheck.forbidden,
    staleImportAllowances: importCheck.stale,
    staleSourceExemptions,
    swallowedAudits,
    coveredGuardCount
  };
}
