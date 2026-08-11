#!/usr/bin/env bun
/**
 * `bun run identity:principal-access:check` — ADR-0085, Gelombang 7 PR 7.1 of
 * Issue #423.
 *
 * `awcms_principals` is GLOBAL and has no RLS. This gate is control 2 of the
 * four that stand in its place, and the distinction it draws is the point:
 *
 *   **RLS bounds which ROWS a query may see. This bounds which CALL SITES may
 *   issue one at all.**
 *
 * Two rules, both structural:
 *
 * 1. **Only allow-listed files may name the table.** A credential store with
 *    readers scattered across the codebase has no boundary to reason about, and
 *    "who can read password hashes" stops being answerable by reading one file.
 * 2. **Every query in those files is KEYED.** `id =` or `email_normalized =`,
 *    never an unbounded scan and never `LIKE`. A credential table that can be
 *    scanned is an enumeration endpoint one refactor away — and unlike a tenant
 *    table, no RLS policy is there to cut the result down.
 *
 * ## Why it carries synthetic probes
 *
 * Gelombang 1 recorded the failure this avoids: a checker proven only by "it
 * found nothing" is proven by nothing. The allow-list here is one file and
 * should stay that way for a long time, so the detector would otherwise spend
 * years never firing — and a matcher that silently stopped matching would look
 * identical. The probes below are DEFECTIVE ON PURPOSE and must all be rejected.
 *
 * Pure: reads source text. No database, no network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TABLE = "awcms_principals";

/**
 * The files permitted to name the table.
 *
 * `sql/` is excluded from the scan entirely — migrations are where the table is
 * defined, and a gate that forbade naming it there would forbid its own subject.
 *
 * Adding an entry is a REVIEW DECISION about widening a credential boundary, and
 * it should be argued in the PR that does it. It is not a list to append to
 * because a query was convenient somewhere else: the store module exposes
 * functions, and a new reader calls one.
 */
const ALLOWED_FILES: readonly string[] = [
  "src/modules/identity-access/application/principal-store.ts"
];

/**
 * This gate itself, which necessarily names the table in its own constants and
 * probes. Excluded for the same reason `sql/` is: a check that forbade naming
 * its subject would forbid its own source. Kept as a named constant rather than
 * an inline `!==` so the exemption is visible next to the list it qualifies.
 */
const SELF = "scripts/identity-principal-access-check.ts";

const SOURCE_ROOTS = ["src", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".astro"];

/**
 * A keyed predicate on the principal table. Both forms bind to a single row:
 * the primary key, or the unique normalized address.
 */
const KEYED_PREDICATE = /\b(id|email_normalized)\s*=\s*\$\{/;

/** Shapes that must never appear in a query against this table. */
const FORBIDDEN_SHAPES: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bLIKE\b|\bILIKE\b|~\*|\bSIMILAR\s+TO\b/i,
    why: "a pattern match over a credential table is an enumeration primitive"
  },
  {
    pattern: /\bLIMIT\b/i,
    why: "a LIMIT implies a result set worth truncating, which a keyed read never has"
  },
  {
    pattern: /\bOFFSET\b/i,
    why: "pagination over a credential table is enumeration with extra steps"
  }
];

export type PrincipalAccessFinding = { file: string; problem: string };

/**
 * How SQL actually names a table: after `FROM`, `INTO`, `UPDATE`, or `JOIN`.
 *
 * ## Why this is not span-based, and the bug that settled it
 *
 * The first two versions of this gate tried to isolate query TEXT — first by
 * pairing backticks, then by also pairing quotes. Both are unsound on real
 * source in this repo, and each was caught by running the gate rather than
 * reading it:
 *
 * - quote pairing breaks on English prose, because an apostrophe in "a human's
 *   login" opens a span that runs to the next apostrophe;
 * - backtick pairing breaks on `scripts/security-readiness.ts`, which contains a
 *   backtick INSIDE a regex character class (`["'\`]`). One unmatched backtick
 *   shifts every pair after it, and a span then covers hundreds of lines.
 *
 * Both produced the same false accusation: a file that merely DECLARES the table
 * in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` was reported as querying it.
 *
 * Matching the clause keyword needs no lexing at all. A privilege-map key
 * (`awcms_principals: ["DELETE"]`) and a sentence about the table are not
 * preceded by `FROM`; a query always is.
 */
const TABLE_IN_CLAUSE = new RegExp(
  `\\b(?:FROM|INTO|UPDATE|JOIN)\\s+${TABLE}\\b`,
  "gi"
);

/**
 * Hard bound on how far the statement window may reach in either direction.
 *
 * The window normally stops at the enclosing template literal's delimiter (see
 * `principalQueries`); this is the backstop for source that has none.
 *
 * A window that is merely "±400 characters" is NOT sufficient, and the reason is
 * worth keeping: this file's own store module holds several small queries a few
 * lines apart, so a fixed window around one of them reaches into its neighbours
 * and finds THEIR `WHERE id = ${…}`. The gate then passes an unkeyed scan
 * because the function below it happened to be keyed — green, and wrong. Found
 * by mutating the store and watching the detector stay silent.
 */
const STATEMENT_WINDOW = 400;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Does this file issue a query against the table at all? */
function mentionsTableInSql(source: string): boolean {
  TABLE_IN_CLAUSE.lastIndex = 0;
  return TABLE_IN_CLAUSE.test(stripComments(source));
}

/** One bounded window per clause-keyword hit, with the verb governing it. */
function principalQueries(source: string): { sql: string; verb: string }[] {
  const code = stripComments(source);
  const blocks: { sql: string; verb: string }[] = [];

  for (const match of code.matchAll(TABLE_IN_CLAUSE)) {
    const at = match.index!;

    // Stop at the enclosing template literal's delimiters. Within ONE statement
    // that is exact, and it is what keeps a neighbouring query's WHERE clause
    // out of this one's window.
    const lowerBound = Math.max(0, at - STATEMENT_WINDOW);
    const upperBound = Math.min(code.length, at + STATEMENT_WINDOW);

    const openAt = code.lastIndexOf("`", at);
    const closeAt = code.indexOf("`", at);

    const from = openAt >= lowerBound ? openAt + 1 : lowerBound;
    const to = closeAt !== -1 && closeAt <= upperBound ? closeAt : upperBound;

    const window = code.slice(from, to);

    // The verb governing THIS occurrence is the nearest one before it, within
    // the same statement.
    const verbs = [
      ...code.slice(from, at).matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)
    ];
    const verb = verbs.at(-1)?.[1]?.toUpperCase() ?? "SELECT";

    blocks.push({ sql: window, verb });
  }

  return blocks;
}

/** The detector, over source TEXT so the probes can feed it strings. */
export function findPrincipalAccessViolations(
  file: string,
  source: string,
  allowed: readonly string[] = ALLOWED_FILES
): PrincipalAccessFinding[] {
  const findings: PrincipalAccessFinding[] = [];

  if (file === SELF) return findings;
  if (!source.includes(TABLE)) return findings;
  if (!allowed.includes(file) && !mentionsTableInSql(source)) return findings;

  if (!allowed.includes(file)) {
    findings.push({
      file,
      problem:
        `names \`${TABLE}\` but is not in ALLOWED_FILES. The credential store is ` +
        "GLOBAL and RLS-free; the only thing bounding who may read it is this " +
        "list. Call a function in `principal-store.ts` instead, or argue the " +
        "widening in the PR that adds the entry."
    });

    return findings;
  }

  const queries = principalQueries(source);

  if (queries.length === 0) {
    findings.push({
      file,
      problem:
        `is allow-listed for \`${TABLE}\` but contains no query against it. ` +
        "Either the reads moved and the entry is stale, or this detector stopped " +
        "recognising them — both are failures, and they are indistinguishable " +
        "from here."
    });

    return findings;
  }

  for (const { sql: query, verb } of queries) {
    const oneLine = query.replace(/\s+/g, " ").trim();

    // INSERT is exempt from the keyed rule and cannot meaningfully satisfy it:
    // it has no WHERE, and it writes exactly the row it names. The unique index
    // on `email_normalized` is what bounds it. Every other verb reads or
    // rewrites rows it SELECTED, and those must bind to one.
    if (verb !== "INSERT" && !KEYED_PREDICATE.test(query)) {
      findings.push({
        file,
        problem:
          `issues an UNKEYED query against \`${TABLE}\`: "${oneLine.slice(0, 120)}". ` +
          "Every read must bind to one row via `id = ${…}` or " +
          "`email_normalized = ${…}` — RLS is not there to cut the result down."
      });
    }

    for (const shape of FORBIDDEN_SHAPES) {
      if (shape.pattern.test(query)) {
        findings.push({
          file,
          problem: `uses a forbidden shape against \`${TABLE}\` — ${shape.why}: "${oneLine.slice(0, 120)}".`
        });
      }
    }
  }

  return findings;
}

const PROBES: readonly { name: string; file: string; source: string }[] = [
  {
    name: "an unlisted file reading the table",
    file: "src/pages/api/v1/whatever.ts",
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE id = ${x}`;"
  },
  {
    name: "an unbounded scan inside the store",
    file: ALLOWED_FILES[0]!,
    source:
      "const rows = await tx`SELECT id, email_normalized FROM awcms_principals ORDER BY created_at`;"
  },
  {
    name: "a LIKE search inside the store",
    file: ALLOWED_FILES[0]!,
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE email_normalized LIKE ${q} AND id = ${x}`;"
  },
  {
    name: "a paginated read inside the store",
    file: ALLOWED_FILES[0]!,
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE id = ${x} LIMIT 50`;"
  },
  {
    name: "an allow-listed file that no longer queries the table at all",
    file: ALLOWED_FILES[0]!,
    source: "// awcms_principals is described here but never queried"
  }
];

function collectSourceFiles(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, into);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      into.push(full);
    }
  }
}

function main(): void {
  const failures: string[] = [];

  for (const probe of PROBES) {
    if (findPrincipalAccessViolations(probe.file, probe.source).length === 0) {
      failures.push(
        `  SELF-TEST FAILED — the detector accepted a source it must reject: ${probe.name}. This gate is no longer checking anything.`
      );
    }
  }

  const files: string[] = [];
  for (const root of SOURCE_ROOTS) collectSourceFiles(root, files);

  let allowedSeen = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    if (ALLOWED_FILES.includes(file)) allowedSeen += 1;

    for (const finding of findPrincipalAccessViolations(file, source)) {
      failures.push(`  ${finding.file} — ${finding.problem}`);
    }
  }

  if (allowedSeen !== ALLOWED_FILES.length) {
    failures.push(
      `  ALLOWED_FILES names ${ALLOWED_FILES.length} file(s) but ${allowedSeen} were found on disk. A dead entry is itself a failure: it means the gate is guarding a file nobody has.`
    );
  }

  if (failures.length > 0) {
    console.error("identity:principal-access:check FAILED\n");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log(
    `identity:principal-access:check OK — ${files.length} source file(s) scanned; ` +
      `only ${ALLOWED_FILES.length} may name \`${TABLE}\`, every query there is keyed, ` +
      `${PROBES.length} synthetic probe(s) still rejected.`
  );
}

if (import.meta.main) {
  main();
}
