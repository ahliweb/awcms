#!/usr/bin/env bun
/**
 * `bun run identity:principal-access:check` — ADR-0085 (Gelombang 7 PR 7.1) and
 * ADR-0087 (PR 7.3) of Issue #423.
 *
 * The principal tables are GLOBAL and have no RLS. This gate is control 2 of the
 * four that stand in their place, and the distinction it draws is the point:
 *
 *   **RLS bounds which ROWS a query may see. This bounds which CALL SITES may
 *   issue one at all.**
 *
 * Two rules, both structural:
 *
 * 1. **Only allow-listed files may name a guarded table.** A credential store
 *    with readers scattered across the codebase has no boundary to reason about,
 *    and "who can read password hashes" stops being answerable by reading one
 *    file.
 * 2. **Every query in those files is KEYED** — never an unbounded scan and never
 *    `LIKE`. A table that can be scanned is an enumeration endpoint one refactor
 *    away, and unlike a tenant table no RLS policy is there to cut the result
 *    down. For `awcms_principals` that means the credential itself; for the MFA
 *    tables it means a targeting list of who does and does not hold a second
 *    factor.
 *
 * ## One gate, three tables, SEPARATE allow-lists
 *
 * ADR-0087 widened this from one table to three, and deliberately did NOT widen
 * it into one shared permission. Each table names the files that may touch it,
 * so `principal-mfa-store.ts` is not thereby allowed to read `password_hash`
 * and `principal-store.ts` is not allowed to reach into factors. A single fused
 * list would have made "the identity-access module" the boundary, which is not a
 * boundary at all.
 *
 * ## Why it carries synthetic probes
 *
 * Gelombang 1 recorded the failure this avoids: a checker proven only by "it
 * found nothing" is proven by nothing. The allow-lists here are one file each and
 * should stay that way for a long time, so the detector would otherwise spend
 * years never firing — and a matcher that silently stopped matching would look
 * identical. The probes below are DEFECTIVE ON PURPOSE and must all be rejected.
 *
 * Pure: reads source text. No database, no network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type GuardedTable = {
  readonly table: string;
  /**
   * The files permitted to name this table.
   *
   * `sql/` is excluded from the scan entirely — migrations are where the tables
   * are defined, and a gate that forbade naming them there would forbid its own
   * subject.
   *
   * Adding an entry is a REVIEW DECISION about widening a credential boundary,
   * and it should be argued in the PR that does it. It is not a list to append
   * to because a query was convenient somewhere else: the store modules expose
   * functions, and a new reader calls one.
   */
  readonly allowedFiles: readonly string[];
  /** A predicate binding the statement to a single row. */
  readonly keyedPredicate: RegExp;
  /** Rendered into the failure message so the fix is stated, not guessed. */
  readonly keyDescription: string;
};

const GUARDED_TABLES: readonly GuardedTable[] = [
  {
    table: "awcms_principals",
    allowedFiles: [
      "src/modules/identity-access/application/principal-store.ts"
    ],
    // `selection_token_hash` joined the list in ADR-0088, and it is a KEY in
    // the same sense the other two are: `awcms_principals_selection_token_key`
    // is unique, so the predicate binds to exactly one row. Widening this list
    // is a review decision — it is written in that ADR, not slipped in.
    keyedPredicate: /\b(id|email_normalized|selection_token_hash)\s*=\s*\$\{/,
    keyDescription:
      "`id = ${…}`, `email_normalized = ${…}`, or `selection_token_hash = ${…}`"
  },
  {
    table: "awcms_principal_mfa_factors",
    allowedFiles: [
      "src/modules/identity-access/application/principal-mfa-store.ts"
    ],
    keyedPredicate: /\b(id|principal_id)\s*=\s*\$\{/,
    keyDescription: "`id = ${…}` or `principal_id = ${…}`"
  },
  {
    table: "awcms_principal_mfa_recovery_codes",
    allowedFiles: [
      "src/modules/identity-access/application/principal-mfa-store.ts"
    ],
    // `factor_id =` binds to one factor's code set, which is the natural unit
    // for delete-on-regenerate. It is still a key: it cannot address rows
    // belonging to a factor the caller did not already resolve.
    keyedPredicate: /\b(id|principal_id|factor_id)\s*=\s*\$\{/,
    keyDescription: "`id = ${…}`, `principal_id = ${…}`, or `factor_id = ${…}`"
  }
];

/**
 * This gate itself, which necessarily names the tables in its own constants and
 * probes. Excluded for the same reason `sql/` is: a check that forbade naming
 * its subject would forbid its own source. Kept as a named constant rather than
 * an inline `!==` so the exemption is visible next to the lists it qualifies.
 */
const SELF = "scripts/identity-principal-access-check.ts";

const SOURCE_ROOTS = ["src", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".astro"];

/** Shapes that must never appear in a query against a guarded table. */
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
 *
 * Built per call rather than hoisted: a `g`-flagged regex carries `lastIndex`,
 * and three tables sharing one object is how a scan silently skips a hit.
 */
function tableInClause(table: string): RegExp {
  return new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, "gi");
}

/**
 * Hard bound on how far the statement window may reach in either direction.
 *
 * The window normally stops at the enclosing template literal's delimiter (see
 * `tableQueries`); this is the backstop for source that has none.
 *
 * A window that is merely "±400 characters" is NOT sufficient, and the reason is
 * worth keeping: the store modules hold several small queries a few lines apart,
 * so a fixed window around one of them reaches into its neighbours and finds
 * THEIR `WHERE id = ${…}`. The gate then passes an unkeyed scan because the
 * function below it happened to be keyed — green, and wrong. Found by mutating
 * the store and watching the detector stay silent.
 */
const STATEMENT_WINDOW = 400;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Does this file issue a query against the table at all? */
function mentionsTableInSql(source: string, table: string): boolean {
  return tableInClause(table).test(stripComments(source));
}

/** One bounded window per clause-keyword hit, with the verb governing it. */
function tableQueries(
  source: string,
  table: string
): { sql: string; verb: string }[] {
  const code = stripComments(source);
  const blocks: { sql: string; verb: string }[] = [];

  for (const match of code.matchAll(tableInClause(table))) {
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
  tables: readonly GuardedTable[] = GUARDED_TABLES
): PrincipalAccessFinding[] {
  const findings: PrincipalAccessFinding[] = [];

  if (file === SELF) return findings;

  for (const guarded of tables) {
    const { table, allowedFiles, keyedPredicate, keyDescription } = guarded;

    // Substring containment is safe across these three names because no guarded
    // table name is a prefix of another followed by a word character
    // (`awcms_principals` vs `awcms_principal_mfa_*` diverge at the `s`).
    if (!source.includes(table)) continue;

    const isAllowed = allowedFiles.includes(file);

    if (!isAllowed) {
      if (!mentionsTableInSql(source, table)) continue;

      findings.push({
        file,
        problem:
          `names \`${table}\` but is not in its allow-list. The principal tables ` +
          "are GLOBAL and RLS-free; the only thing bounding who may read them is " +
          "that list. Call a function in the owning store module instead, or " +
          "argue the widening in the PR that adds the entry."
      });

      continue;
    }

    const queries = tableQueries(source, table);

    if (queries.length === 0) {
      findings.push({
        file,
        problem:
          `is allow-listed for \`${table}\` but contains no query against it. ` +
          "Either the reads moved and the entry is stale, or this detector stopped " +
          "recognising them — both are failures, and they are indistinguishable " +
          "from here."
      });

      continue;
    }

    for (const { sql: query, verb } of queries) {
      const oneLine = query.replace(/\s+/g, " ").trim();

      // INSERT is exempt from the keyed rule and cannot meaningfully satisfy it:
      // it has no WHERE, and it writes exactly the row it names. The unique
      // indexes are what bound it. Every other verb reads or rewrites rows it
      // SELECTED, and those must bind.
      if (verb !== "INSERT" && !keyedPredicate.test(query)) {
        findings.push({
          file,
          problem:
            `issues an UNKEYED query against \`${table}\`: "${oneLine.slice(0, 120)}". ` +
            `Every read must bind via ${keyDescription} — RLS is not there to cut ` +
            "the result down."
        });
      }

      for (const shape of FORBIDDEN_SHAPES) {
        if (shape.pattern.test(query)) {
          findings.push({
            file,
            problem: `uses a forbidden shape against \`${table}\` — ${shape.why}: "${oneLine.slice(0, 120)}".`
          });
        }
      }
    }
  }

  return findings;
}

const CREDENTIAL_STORE = GUARDED_TABLES[0]!.allowedFiles[0]!;
const MFA_STORE = GUARDED_TABLES[1]!.allowedFiles[0]!;

const PROBES: readonly { name: string; file: string; source: string }[] = [
  {
    name: "an unlisted file reading the credential table",
    file: "src/pages/api/v1/whatever.ts",
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE id = ${x}`;"
  },
  {
    name: "an unbounded scan inside the credential store",
    file: CREDENTIAL_STORE,
    source:
      "const rows = await tx`SELECT id, email_normalized FROM awcms_principals ORDER BY created_at`;"
  },
  {
    name: "a LIKE search inside the credential store",
    file: CREDENTIAL_STORE,
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE email_normalized LIKE ${q} AND id = ${x}`;"
  },
  {
    name: "a paginated read inside the credential store",
    file: CREDENTIAL_STORE,
    source:
      "const rows = await tx`SELECT id FROM awcms_principals WHERE id = ${x} LIMIT 50`;"
  },
  {
    name: "an allow-listed file that no longer queries its table at all",
    file: CREDENTIAL_STORE,
    source: "// awcms_principals is described here but never queried"
  },
  {
    name: "an unlisted file reading the MFA factor table",
    file: "src/pages/api/v1/auth/mfa/whatever.ts",
    source:
      "const rows = await tx`SELECT id FROM awcms_principal_mfa_factors WHERE principal_id = ${p}`;"
  },
  {
    name: "an unbounded scan of MFA factors inside the MFA store",
    file: MFA_STORE,
    source:
      "const rows = await tx`SELECT id FROM awcms_principal_mfa_factors WHERE status = 'active'`;"
  },
  {
    name: "an unbounded scan of recovery codes inside the MFA store",
    file: MFA_STORE,
    source:
      "const rows = await tx`SELECT code_hash FROM awcms_principal_mfa_recovery_codes WHERE used_at IS NULL`;"
  },
  {
    // The boundary ADR-0087 refused to fuse: the MFA store is not thereby
    // allowed to read credentials.
    name: "the MFA store reaching into the credential table",
    file: MFA_STORE,
    source:
      "const rows = await tx`SELECT password_hash FROM awcms_principals WHERE id = ${x}`;"
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

  const seenPerTable = new Map<string, number>();

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const guarded of GUARDED_TABLES) {
      if (guarded.allowedFiles.includes(file)) {
        seenPerTable.set(
          guarded.table,
          (seenPerTable.get(guarded.table) ?? 0) + 1
        );
      }
    }

    for (const finding of findPrincipalAccessViolations(file, source)) {
      failures.push(`  ${finding.file} — ${finding.problem}`);
    }
  }

  for (const guarded of GUARDED_TABLES) {
    const seen = seenPerTable.get(guarded.table) ?? 0;

    if (seen !== guarded.allowedFiles.length) {
      failures.push(
        `  \`${guarded.table}\` allow-lists ${guarded.allowedFiles.length} file(s) but ${seen} were found on disk. A dead entry is itself a failure: it means the gate is guarding a file nobody has.`
      );
    }
  }

  if (failures.length > 0) {
    console.error("identity:principal-access:check FAILED\n");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  const tableCount = GUARDED_TABLES.length;
  const allowedCount = GUARDED_TABLES.reduce(
    (total, guarded) => total + guarded.allowedFiles.length,
    0
  );

  console.log(
    `identity:principal-access:check OK — ${files.length} source file(s) scanned; ` +
      `${tableCount} GLOBAL principal table(s) guarded by ${allowedCount} allow-listed ` +
      `file(s), every query keyed, ${PROBES.length} synthetic probe(s) still rejected.`
  );
}

if (import.meta.main) {
  main();
}
