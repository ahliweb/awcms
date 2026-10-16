/**
 * db-function-search-path-check.ts — `bun run db:function-search-path:check`
 * (Issue #1046).
 *
 * Every trigger function (`RETURNS trigger`) and every `SECURITY DEFINER`
 * function declared across `sql/` must END with `search_path` pinned, and the
 * pin must name `pg_temp` as its LAST element. Pure: parses migration text,
 * never touches a database.
 *
 * ## Why this is a gate and not a code-review habit
 *
 * `awcms_app` and `awcms_worker` hold `TEMP`. PostgreSQL resolves an
 * unqualified RELATION name through the session's temp schema (`pg_temp_N`)
 * BEFORE `public` — implicitly, unless `pg_temp` is written into the path at a
 * later position. So a body that says `SELECT … FROM awcms_workflow_decisions`
 * and does not pin `search_path` reads whatever table the calling role
 * `CREATE TEMP TABLE awcms_workflow_decisions (…)`-ed first. A guard trigger
 * therefore sees rows its caller invented, which is exactly how #1032's
 * triggers were bypassed (an instance approved with zero real decisions).
 *
 * Note the consequence: `SET search_path = public` is NOT enough — the temp
 * schema is still searched first. Only an explicit `pg_temp` in last position
 * demotes it, which is why the rule asks for that token and not merely for
 * "some search_path".
 *
 * ## The cumulative trap
 *
 * Only the LAST definition of a function is the one that runs, and there are
 * two ways a later statement changes the pin:
 *
 * - `CREATE OR REPLACE FUNCTION` replaces the WHOLE definition, `SET` clauses
 *   included. A function pinned in `sql/184` and re-created without the clause
 *   in `sql/204` is unpinned again (this repo re-creates guards routinely —
 *   `awcms_booking_guard_allocation_insert` has three definitions).
 * - `ALTER FUNCTION … SET search_path …` / `RESET search_path` edit the pin of
 *   an existing function without touching its body.
 *
 * So every file is folded in migration order and the final state is judged,
 * the same way `db-fk-index-check.ts` unions indexes across files.
 *
 * ## What the parser deliberately does not understand
 *
 * Function identity is `name/arity` (IN, INOUT and VARIADIC arguments), not the
 * full type list. Splitting `p_zone text` from a bare `timestamp with time zone`
 * argument needs a type grammar this gate does not own, and two overloads of
 * one name with the same arity do not exist here. If one ever does, the gate
 * judges them as one function and the DB-backed test
 * (`tests/integration/function-search-path.integration.test.ts`) — which reads
 * `pg_proc.proconfig` and cross-checks this parser's verdicts — is the backstop.
 *
 * `CREATE FUNCTION` / `ALTER FUNCTION` hidden inside a `DO` block or an
 * `EXECUTE` string cannot be tracked statically, so the gate FAILS on them
 * rather than skipping: a blind spot that reports green is the failure mode
 * this repo keeps recording.
 */
import { loadMigrations } from "./lib/migrations";

export type FunctionState = {
  /** Bare function name, `public.` prefix removed, lower-cased. */
  name: string;
  /** Count of IN / INOUT / VARIADIC arguments (OUT arguments are not identity). */
  arity: number;
  /** The migration that last defined or altered it. */
  file: string;
  returnsTrigger: boolean;
  securityDefiner: boolean;
  /** Elements of the pinned search_path; `null` when none is set. */
  searchPath: string[] | null;
};

const STR = "'([^']|'')*'";
const IDENT = `(?:"[^"]*"|[A-Za-z_][\\w$]*)`;
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

/**
 * Reduce SQL to statements the regexes below can trust:
 *
 * - comments removed;
 * - dollar-quoted bodies replaced by `$$ $$` (their text is returned
 *   separately, so `DO` blocks can be audited);
 * - `;` `(` `)` inside single-quoted strings neutralised so statement and
 *   argument splitting cannot be fooled by them.
 */
export function splitStatements(sql: string): {
  statements: string[];
  bodies: string[];
} {
  const statements: string[] = [];
  const bodies: string[] = [];
  let current = "";
  let index = 0;

  const flush = (): void => {
    if (current.trim() !== "") {
      statements.push(current);
    }

    current = "";
  };

  while (index < sql.length) {
    const rest = sql.slice(index);
    const char = sql[index]!;

    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index);

      index = end === -1 ? sql.length : end;
      current += " ";
      continue;
    }

    if (rest.startsWith("/*")) {
      // PostgreSQL block comments nest.
      let depth = 0;
      let cursor = index;

      do {
        if (sql.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sql.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      } while (depth > 0 && cursor < sql.length);

      index = cursor;
      current += " ";
      continue;
    }

    if (char === "'") {
      const escaped = /(?:^|[^\w$])[eE]$/.test(current);
      let cursor = index + 1;
      let literal = "";

      while (cursor < sql.length) {
        if (escaped && sql[cursor] === "\\") {
          literal += sql.slice(cursor, cursor + 2);
          cursor += 2;
          continue;
        }

        if (sql[cursor] === "'") {
          if (sql[cursor + 1] === "'") {
            literal += "''";
            cursor += 2;
            continue;
          }

          break;
        }

        literal += sql[cursor];
        cursor += 1;
      }

      current += `'${literal
        .replace(/;/g, "\u0001")
        .replace(/\(/g, "\u0002")
        .replace(/\)/g, "\u0003")}'`;
      index = cursor + 1;
      continue;
    }

    if (char === '"') {
      const end = sql.indexOf('"', index + 1);
      const stop = end === -1 ? sql.length : end + 1;

      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (char === "$") {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(rest);

      if (tag && !/[\w$]$/.test(current)) {
        const close = sql.indexOf(tag[0], index + tag[0].length);
        const stop = close === -1 ? sql.length : close;

        bodies.push(sql.slice(index + tag[0].length, stop));
        current += "$$ $$";
        index = close === -1 ? sql.length : close + tag[0].length;
        continue;
      }
    }

    if (char === ";") {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flush();

  return { statements, bodies };
}

function bareName(qualified: string): string {
  const parts = qualified
    .split(".")
    .map((part) => part.trim().replace(/^"|"$/g, "").toLowerCase());
  const name = parts[parts.length - 1]!;

  return parts.length > 1 && parts[0] !== "public"
    ? `${parts[0]}.${name}`
    : name;
}

/** The text between a statement's first `(` after `from` and its matching `)`. */
function readParenthesised(
  text: string,
  from: number
): { inner: string; end: number } | null {
  const open = text.indexOf("(", from);

  if (open === -1) {
    return null;
  }

  let depth = 0;

  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;

      if (depth === 0) {
        return { inner: text.slice(open + 1, i), end: i + 1 };
      }
    }
  }

  return null;
}

/** IN / INOUT / VARIADIC argument count; OUT arguments are not part of identity. */
export function countIdentityArguments(argumentList: string): number {
  if (argumentList.trim() === "") {
    return 0;
  }

  let depth = 0;
  let count = 0;
  let piece = "";
  const pieces: string[] = [];

  let quoted = false;

  for (const char of argumentList) {
    if (char === "'") {
      quoted = !quoted;
    }

    if (quoted) {
      piece += char;
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }

    if (char === "," && depth === 0) {
      pieces.push(piece);
      piece = "";
    } else {
      piece += char;
    }
  }

  pieces.push(piece);

  for (const entry of pieces) {
    if (!/^\s*OUT\b/i.test(entry)) {
      count += 1;
    }
  }

  return count;
}

/** `SET search_path = a, b` elements, or `"FROM CURRENT"`; `undefined` if absent. */
export function readSearchPath(clauses: string): string[] | undefined {
  if (/\bSET\s+search_path\s+FROM\s+CURRENT\b/i.test(clauses)) {
    return ["<from current>"];
  }

  const element = `(?:${STR}|"[^"]*"|[\\w$]+)`;
  const match = new RegExp(
    `\\bSET\\s+search_path\\s*(?:=|\\bTO\\b)\\s*(${element}(?:\\s*,\\s*${element})*)`,
    "i"
  ).exec(clauses);

  if (!match) {
    return undefined;
  }

  return [...match[1]!.matchAll(new RegExp(`${STR}|"[^"]*"|[\\w$]+`, "g"))].map(
    (part) =>
      part[0]
        .replace(/^['"]|['"]$/g, "")
        .trim()
        .toLowerCase()
  );
}

/** A pin that actually defeats the temp schema: `pg_temp` named, and last. */
export function isSafePin(searchPath: readonly string[] | null): boolean {
  return (
    searchPath !== null &&
    searchPath.length > 0 &&
    searchPath[searchPath.length - 1] === "pg_temp"
  );
}

export function isInScope(state: FunctionState): boolean {
  return state.returnsTrigger || state.securityDefiner;
}

const key = (name: string, arity: number): string => `${name}/${arity}`;

/** Fold one file into the running function table, in statement order. */
export function applyMigration(
  functions: Map<string, FunctionState>,
  file: string,
  sql: string,
  problems: string[] = []
): void {
  const { statements, bodies } = splitStatements(sql);

  for (const body of bodies) {
    if (
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|ALTER\s+(?:FUNCTION|ROUTINE|PROCEDURE)|DROP\s+(?:FUNCTION|ROUTINE|PROCEDURE))\b/i.test(
        body
      )
    ) {
      // A body quoting function DDL is either a `DO` block that creates
      // functions dynamically or a function that does. Neither can be followed
      // statically.
      problems.push(
        `${file}: a dollar-quoted body contains function DDL (CREATE/ALTER/DROP FUNCTION). ` +
          "Dynamic function DDL cannot be tracked statically — issue it as a plain top-level statement."
      );
    }
  }

  for (const statement of statements) {
    const text = statement.trim();

    const create = new RegExp(
      `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(FUNCTION|PROCEDURE)\\s+(${QNAME})\\s*\\(`,
      "i"
    ).exec(text);

    if (create) {
      const args = readParenthesised(text, create[0].length - 1);

      if (!args) {
        problems.push(`${file}: cannot read argument list of ${create[2]}`);
        continue;
      }

      const name = bareName(create[2]!);
      const arity = countIdentityArguments(args.inner);
      const clauses = text.slice(args.end);
      const searchPath = readSearchPath(clauses);

      functions.set(key(name, arity), {
        name,
        arity,
        file,
        returnsTrigger: /\bRETURNS\s+(?:trigger|event_trigger)\b/i.test(
          clauses
        ),
        securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(clauses),
        searchPath: searchPath ?? null
      });
      continue;
    }

    const alter = new RegExp(
      `^ALTER\\s+(?:FUNCTION|ROUTINE|PROCEDURE)\\s+(${QNAME})\\s*(\\(|(?=\\S))`,
      "i"
    ).exec(text);

    if (alter) {
      const name = bareName(alter[1]!);
      const hasArgs = alter[2] === "(";
      const args = hasArgs
        ? readParenthesised(text, alter[0].length - 1)
        : null;
      const clauses = args ? text.slice(args.end) : text.slice(alter[0].length);
      const targets = hasArgs
        ? [key(name, countIdentityArguments(args?.inner ?? ""))]
        : [...functions.keys()].filter((entry) => entry.startsWith(`${name}/`));

      for (const target of targets) {
        const state = functions.get(target);

        if (!state) {
          continue;
        }

        const next: FunctionState = { ...state, file };
        const pinned = readSearchPath(clauses);

        if (pinned !== undefined) {
          next.searchPath = pinned;
        }

        if (/\bRESET\s+(?:search_path|ALL)\b/i.test(clauses)) {
          next.searchPath = null;
        }

        if (/\bSECURITY\s+DEFINER\b/i.test(clauses)) {
          next.securityDefiner = true;
        } else if (/\bSECURITY\s+INVOKER\b/i.test(clauses)) {
          next.securityDefiner = false;
        }

        const rename = new RegExp(`\\bRENAME\\s+TO\\s+(${IDENT})`, "i").exec(
          clauses
        );

        functions.set(target, next);

        if (rename) {
          functions.delete(target);
          next.name = bareName(rename[1]!);
          functions.set(key(next.name, next.arity), next);
        }
      }

      continue;
    }

    const drop = new RegExp(
      `^DROP\\s+(?:FUNCTION|ROUTINE|PROCEDURE)\\s+(?:IF\\s+EXISTS\\s+)?(${QNAME})\\s*(\\()?`,
      "i"
    ).exec(text);

    if (drop) {
      const name = bareName(drop[1]!);
      const args = drop[2] ? readParenthesised(text, drop[0].length - 1) : null;

      if (args) {
        functions.delete(key(name, countIdentityArguments(args.inner)));
      } else {
        for (const entry of [...functions.keys()]) {
          if (entry.startsWith(`${name}/`)) {
            functions.delete(entry);
          }
        }
      }
    }
  }
}

export function foldFunctions(
  migrations: readonly { name: string; sql: string }[]
): { functions: Map<string, FunctionState>; problems: string[] } {
  const functions = new Map<string, FunctionState>();
  const problems: string[] = [];

  for (const migration of migrations) {
    applyMigration(functions, migration.name, migration.sql, problems);
  }

  return { functions, problems };
}

/** The functions the rule judges and finds wanting, sorted for stable output. */
export function findUnpinnedFunctions(
  functions: ReadonlyMap<string, FunctionState>
): FunctionState[] {
  return [...functions.values()]
    .filter((state) => isInScope(state) && !isSafePin(state.searchPath))
    .sort((a, b) => a.name.localeCompare(b.name) || a.arity - b.arity);
}

function main(): void {
  const { functions, problems } = foldFunctions(loadMigrations());
  const unpinned = findUnpinnedFunctions(functions);
  const inScope = [...functions.values()].filter(isInScope).length;

  if (unpinned.length > 0 || problems.length > 0) {
    console.error("db:function-search-path:check FAILED");

    for (const state of unpinned) {
      const kind = [
        state.returnsTrigger ? "trigger function" : null,
        state.securityDefiner ? "SECURITY DEFINER" : null
      ]
        .filter(Boolean)
        .join(" + ");
      const found =
        state.searchPath === null
          ? "no search_path set"
          : `search_path = ${state.searchPath.join(", ")} (pg_temp is not last)`;

      console.error(
        `  - ${state.name}/${state.arity} (${kind}, last defined in ${state.file}): ${found}. ` +
          "A role holding TEMP can CREATE TEMP TABLE a same-named shadow that this function then reads. " +
          "Add `SET search_path = pg_catalog, public, pg_temp` to its CREATE (and keep it on every " +
          "CREATE OR REPLACE), or `ALTER FUNCTION … SET search_path = pg_catalog, public, pg_temp` in a new migration."
      );
    }

    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `db:function-search-path:check OK — ${inScope} trigger/SECURITY DEFINER functions, ` +
      "every one ending with a search_path that names pg_temp last."
  );
}

if (import.meta.main) {
  main();
}
