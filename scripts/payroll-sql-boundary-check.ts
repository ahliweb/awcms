/**
 * payroll-sql-boundary-check.ts - `bun run payroll:sql-boundary:check`.
 *
 * Issue #978 audit M2 and Issue #1015 (M-B); `docs/awcms/hr-payroll.md`
 * section 13.3.
 *
 * The payroll data boundary (`src/modules/_shared/payroll-data-boundary.ts`)
 * stops a REGISTRY from naming a payroll table. It cannot see a copy made in
 * SQL: a view, a materialised view or a `CREATE TABLE ... AS` over payroll is a
 * second relation under a harmless name that any projection, search source or
 * export may then read, and a trigger or function on an ordinary table that
 * reads payroll moves pay data into that table's side effects.
 *
 * ## Two layers, one rule
 *
 * The rule (from the #1015 re-audit): a relation, rule or function that
 * depends on a payroll table must itself be in the payroll family (so every
 * registry gate already refuses it).
 *
 * 1. THIS FILE is the fast static layer in `bun run check`. It reads `sql/`
 *    with a quote-aware statement splitter (`scripts/lib/sql-statements.ts`),
 *    folds `'a' || 'b'`, compares table names case-insensitively, follows a
 *    relation through `ALTER ... RENAME`, follows a function through calls to
 *    other functions, and looks INSIDE `DO` blocks and `EXECUTE '...'`
 *    literals. It fails on:
 *    - a view / materialised view that reads payroll, or `CREATE TABLE ... AS`,
 *      `SELECT ... INTO <table>`, `INSERT INTO <table> SELECT` that copies it,
 *      when the target is not itself payroll-family;
 *    - a `CREATE RULE` on an ordinary table that reads payroll, or on a payroll
 *      table that writes to an ordinary one;
 *    - a function (any language, `SETOF <payroll table>` included) that reads
 *      payroll, calls a function that does, or calls a payroll-family function,
 *      when the function is not itself payroll-family;
 *    - a trigger that crosses the boundary in either direction.
 * 2. `scripts/lib/payroll-catalog-boundary.ts` +
 *    `tests/integration/payroll-catalog-boundary.integration.test.ts` (and
 *    `bun run payroll:catalog-boundary:check`) is the layer text cannot be:
 *    it reads the MIGRATED CATALOG (`pg_rewrite`/`pg_depend`, `pg_proc`,
 *    `pg_trigger`, ACLs), so a name built at run time, a function chain, a
 *    rename or a quoting trick cannot hide from it. It needs a database, so it
 *    runs where one exists (the integration job), mirroring
 *    `db:function-search-path:check`.
 *
 * ## Known limit of this layer (do not widen the claim)
 *
 * A table name assembled at run time from a variable, `format('%I', x)` or a
 * catalog lookup is invisible to any text scan; a one-shot data copy made by a
 * `DO` block through such a name leaves no object in the catalog either. Those
 * are held by review and by the grants layer (only the runtime roles can read
 * payroll tables at all), not by this gate.
 *
 * Pure: reads `sql/`, no database.
 */
import {
  PAYROLL_DO_EXECUTE_ALLOWLIST,
  isPayrollTable
} from "../src/modules/_shared/payroll-data-boundary";
import { loadMigrations } from "./lib/migrations";
import {
  dollarQuotedBodies,
  foldStringConcatenation,
  singleQuotedLiterals,
  splitSqlStatements
} from "./lib/sql-statements";

export type SqlFile = { name: string; sql: string };

const TABLE_TOKEN = /\bawcms_[a-z0-9_]+\b/gi;
const IDENT = String.raw`(?:"[^"]+"|[\w$]+)`;
const NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

function bareName(name: string): string {
  return name.replace(/"/g, "").split(".").pop()!.trim().toLowerCase();
}

function forbiddenTablesIn(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(TABLE_TOKEN)]
        .map((match) => match[0].toLowerCase())
        .filter((table) => isPayrollTable(table))
    )
  ];
}

/** Payroll tables named where data is READ (FROM / JOIN / USING / a list), not in a VALUES literal. */
function readTablesIn(text: string): string[] {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /(?:\b(?:FROM|JOIN|USING)|,)\s*(?:ONLY\s+)?(?:"?\w+"?\s*\.\s*)?"?(awcms_[a-z0-9_]+)"?/gi
        )
      ]
        .map((match) => match[1]!.toLowerCase())
        .filter((table) => isPayrollTable(table))
    )
  ];
}

type Relation = {
  file: string;
  kind: "view" | "copy";
  body: string;
  /** `any` mention counts (a view, CTAS); `positions` only FROM/JOIN/USING (INSERT ... SELECT, whose VALUES may name a table as data). */
  mode: "any" | "positions";
};

type FunctionDef = { file: string; text: string };

type Context = {
  relations: Map<string, Relation>;
  inserts: (Relation & { target: string })[];
  functions: Map<string, FunctionDef>;
  triggers: { file: string; name: string; table: string; fn: string }[];
  immediate: string[];
};

function newContext(): Context {
  return {
    relations: new Map(),
    inserts: [],
    functions: new Map(),
    triggers: [],
    immediate: []
  };
}

/** Every RegExp metacharacter in `value` escaped, so a name is matched literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Names called in `text`: `name(` as a whole word. */
function callsOf(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])"?${escapeRegExp(name)}"?\\s*\\(`, "i").test(
    text
  );
}

function analyseStatement(
  raw: string,
  file: string,
  ctx: Context,
  inPlpgsql: boolean,
  depth = 0
): void {
  const text = foldStringConcatenation(raw);
  // A top-level statement starts with its keyword; inside a plpgsql body it can
  // follow `BEGIN`, `THEN`, a label or a declaration.
  const start = inPlpgsql ? String.raw`\b` : String.raw`^\s*`;

  // DO block: the work is in its body, and in every literal it EXECUTEs.
  if (/^\s*DO\b/i.test(text) && depth < 3) {
    const bodies = dollarQuotedBodies(text);
    const sources = bodies.length > 0 ? bodies : singleQuotedLiterals(text);

    // Dynamic SQL in a migration is a relation name built at run time: a name
    // no text scan can hold to the boundary. It is named in the allow-list, with
    // a reason, or it fails (Issue #1015). The catalog layer still sees whatever
    // object the block leaves behind.
    if (
      depth === 0 &&
      !Object.hasOwn(PAYROLL_DO_EXECUTE_ALLOWLIST, file) &&
      sources.some((body) =>
        /(?<![\w$])EXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/i.test(body)
      )
    ) {
      ctx.immediate.push(
        `${file}: a DO block runs dynamic SQL (EXECUTE). A relation name built at run time cannot be held to the payroll boundary by a text scan; write the statement out, or name this migration in PAYROLL_DO_EXECUTE_ALLOWLIST (src/modules/_shared/payroll-data-boundary.ts) with the reason.`
      );
    }

    for (const body of sources) {
      for (const inner of splitSqlStatements(body)) {
        analyseStatement(inner, file, ctx, true, depth + 1);

        for (const literal of singleQuotedLiterals(inner)) {
          for (const nested of splitSqlStatements(literal)) {
            analyseStatement(nested, file, ctx, false, depth + 1);
          }
        }
      }
    }

    return;
  }

  const view = new RegExp(
    String.raw`${start}CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NAME})([\s\S]*)$`,
    "i"
  ).exec(text);

  if (view) {
    ctx.relations.set(bareName(view[1]!), {
      file,
      kind: "view",
      body: view[2]!,
      mode: "any"
    });
    return;
  }

  const created = new RegExp(
    String.raw`${start}CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NAME})([\s\S]*)$`,
    "i"
  ).exec(text);

  if (created) {
    if (/\bAS\s*\(?\s*(?:SELECT|WITH|TABLE|VALUES)\b/i.test(created[2]!)) {
      ctx.relations.set(bareName(created[1]!), {
        file,
        kind: "copy",
        body: created[2]!,
        mode: "any"
      });
    }

    return;
  }

  // A leading WITH hides the data-modifying statement behind its CTEs:
  // `WITH c AS (SELECT * FROM payroll) INSERT INTO t SELECT * FROM c`. The CTEs
  // are part of the reading, so the whole statement is the body.
  const withLead = /^\s*WITH\b/i.test(text);
  const dml = withLead ? String.raw`\b` : start;

  const insert = new RegExp(
    String.raw`${dml}INSERT\s+INTO\s+(${NAME})([\s\S]*)$`,
    "i"
  ).exec(text);

  if (insert) {
    const target = bareName(insert[1]!);

    if (
      /\b(?:SELECT|WITH|TABLE)\b/i.test(insert[2]!) &&
      !isPayrollTable(target)
    ) {
      // Resolved with the other copies at the end, so a call to a function
      // that reads payroll counts too.
      ctx.inserts.push({
        file,
        kind: "copy",
        body: withLead ? text : insert[2]!,
        mode: "positions",
        target
      });
    }

    return;
  }

  // `SELECT ... INTO x` makes a table only as plain SQL; in plpgsql it fills a
  // variable.
  const selectInto = new RegExp(
    String.raw`${dml}SELECT\b[\s\S]*?\bINTO\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?(?:TABLE\s+)?(${NAME})\s+FROM\b([\s\S]*)$`,
    "i"
  ).exec(text);

  if (selectInto && !inPlpgsql) {
    ctx.relations.set(bareName(selectInto[1]!), {
      file,
      kind: "copy",
      body: withLead ? text : selectInto[2]!,
      mode: "any"
    });
    return;
  }

  const rule = new RegExp(
    String.raw`${start}CREATE\s+(?:OR\s+REPLACE\s+)?RULE\s+(${NAME})\s+AS\s+ON\s+\w+\s+TO\s+(${NAME})([\s\S]*)$`,
    "i"
  ).exec(text);

  if (rule) {
    const ruleName = bareName(rule[1]!);
    const table = bareName(rule[2]!);
    const body = rule[3]!;

    if (!isPayrollTable(table)) {
      const read = forbiddenTablesIn(body);

      if (read.length > 0) {
        ctx.immediate.push(
          `${file}: rule ${ruleName} on ${table} reads ${read.join(", ")} but ${table} is not itself a payroll relation.`
        );
      }
    } else {
      for (const written of body.matchAll(
        new RegExp(
          String.raw`\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(${NAME})`,
          "gi"
        )
      )) {
        const target = bareName(written[1]!);

        if (!isPayrollTable(target) && target !== "nothing") {
          ctx.immediate.push(
            `${file}: rule ${ruleName} on payroll table ${table} writes to ${target}, which is not itself a payroll relation. A payroll table's side effects stay in the payroll family.`
          );
        }
      }
    }

    return;
  }

  const fn = new RegExp(
    String.raw`${start}CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(${NAME})\s*\(`,
    "i"
  ).exec(text);

  if (fn) {
    ctx.functions.set(bareName(fn[1]!), { file, text });
    return;
  }

  const trigger = new RegExp(
    String.raw`${start}CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(${IDENT})[\s\S]*?\bON\s+(${NAME})[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(${NAME})\s*\(`,
    "i"
  ).exec(text);

  if (trigger) {
    ctx.triggers.push({
      file,
      name: bareName(trigger[1]!),
      table: bareName(trigger[2]!),
      fn: bareName(trigger[3]!)
    });
    return;
  }

  const rename = new RegExp(
    String.raw`^\s*ALTER\s+(?:MATERIALIZED\s+)?(?:VIEW|TABLE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})\s+RENAME\s+TO\s+(${NAME})`,
    "i"
  ).exec(text);

  if (rename) {
    const from = bareName(rename[1]!);
    const to = bareName(rename[2]!);
    const entry = ctx.relations.get(from);

    if (entry) {
      ctx.relations.delete(from);
      ctx.relations.set(to, entry);
    }
    return;
  }

  const renameFn = new RegExp(
    String.raw`^\s*ALTER\s+(?:FUNCTION|PROCEDURE)\s+(${NAME})\s*(?:\([^)]*\))?\s+RENAME\s+TO\s+(${NAME})`,
    "i"
  ).exec(text);

  if (renameFn) {
    const from = bareName(renameFn[1]!);
    const entry = ctx.functions.get(from);

    if (entry) {
      ctx.functions.delete(from);
      ctx.functions.set(bareName(renameFn[2]!), entry);
    }
    return;
  }

  const drop = new RegExp(
    String.raw`^\s*DROP\s+(?:MATERIALIZED\s+)?(VIEW|TABLE|FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?(${NAME}(?:\s*(?:\([^)]*\))?\s*,\s*${NAME})*)`,
    "i"
  ).exec(text);

  if (drop) {
    const store = /^(?:FUNCTION|PROCEDURE)$/i.test(drop[1]!)
      ? ctx.functions
      : ctx.relations;

    for (const name of drop[2]!.split(",")) {
      store.delete(bareName(name.replace(/\([^)]*\)/g, "")));
    }
  }
}

export function findPayrollSqlLeaks(files: readonly SqlFile[]): string[] {
  const ctx = newContext();

  for (const file of files) {
    for (const statement of splitSqlStatements(file.sql)) {
      analyseStatement(statement, file.name, ctx, false);
    }
  }

  const failures = [...ctx.immediate];

  // Function -> the payroll it reaches, directly or through other functions.
  const familyFunctions = [...ctx.functions.keys()].filter((name) =>
    isPayrollTable(name)
  );
  const reaches = new Map<string, string[]>();

  for (const [name, def] of ctx.functions) {
    if (isPayrollTable(name)) continue;

    const direct = forbiddenTablesIn(foldStringConcatenation(def.text));
    const viaFamily = familyFunctions.filter(
      (family) => family !== name && callsOf(def.text, family)
    );

    if (direct.length + viaFamily.length > 0) {
      reaches.set(name, [...direct, ...viaFamily.map((f) => `${f}()`)]);
    }
  }

  for (let changed = true; changed;) {
    changed = false;

    for (const [name, def] of ctx.functions) {
      if (isPayrollTable(name) || reaches.has(name)) continue;

      const through = [...reaches.keys()].filter(
        (callee) => callee !== name && callsOf(def.text, callee)
      );

      if (through.length > 0) {
        reaches.set(
          name,
          through.flatMap((callee) => reaches.get(callee)!)
        );
        changed = true;
      }
    }
  }

  const reachedBy = (body: string, onlyReads: boolean): string[] => [
    ...new Set([
      ...(onlyReads ? readTablesIn(body) : forbiddenTablesIn(body)),
      ...[...reaches.entries()]
        .filter(([callee]) => callsOf(body, callee))
        .flatMap(([, read]) => read)
    ])
  ];

  for (const [name, read] of reaches) {
    const def = ctx.functions.get(name)!;

    failures.push(
      `${def.file}: function ${name} reads ${read.join(", ")} but is not itself a payroll relation. Name it in the payroll family (so the registry gates refuse it) or do not create it.`
    );
  }

  for (const [name, def] of ctx.functions) {
    if (
      !isPayrollTable(name) &&
      /\bLANGUAGE\s+'?plpgsql'?/i.test(def.text) &&
      /(?<![\w$])EXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/i.test(def.text) &&
      /\bawcms_(?:hr|payroll|compensation|payslip)/i.test(
        foldStringConcatenation(def.text)
      )
    ) {
      failures.push(
        `${def.file}: function ${name} runs dynamic SQL (EXECUTE) next to a payroll-family name. A name the gate cannot resolve is a name it cannot hold to the rule; keep payroll access in a payroll-family function.`
      );
    }
  }

  const copies = [
    ...[...ctx.relations].map(([target, entry]) => ({ ...entry, target })),
    ...ctx.inserts
  ];

  for (const entry of copies) {
    const target = entry.target;
    const read = reachedBy(entry.body, entry.mode === "positions");

    if (read.length === 0 || isPayrollTable(target)) continue;

    if (entry.kind === "view") {
      failures.push(
        `${entry.file}: view ${target} reads ${read.join(", ")} but is not itself a payroll relation. Name it in the payroll family (so the registry gates refuse it) or do not create it.`
      );
    } else {
      failures.push(
        `${entry.file}: CREATE TABLE ${target} AS (or SELECT INTO / INSERT INTO ... SELECT) copies ${read.join(", ")} into a table that is not itself a payroll relation.`
      );
    }
  }

  for (const trigger of ctx.triggers) {
    const tableIsPayroll = isPayrollTable(trigger.table);
    const fnIsPayroll = isPayrollTable(trigger.fn);
    const read = reaches.get(trigger.fn);

    if (!tableIsPayroll && read) {
      failures.push(
        `${trigger.file}: trigger ${trigger.name} on ${trigger.table} runs ${trigger.fn}, whose body reads ${read.join(", ")}. A table that is not itself payroll must not carry payroll reads in its side effects.`
      );
    } else if (!tableIsPayroll && fnIsPayroll) {
      failures.push(
        `${trigger.file}: trigger ${trigger.name} on ${trigger.table} runs payroll-family function ${trigger.fn}. A table that is not itself payroll must not carry payroll side effects.`
      );
    } else if (tableIsPayroll && !fnIsPayroll) {
      failures.push(
        `${trigger.file}: trigger ${trigger.name} on payroll table ${trigger.table} runs ${trigger.fn}, which is not itself a payroll relation. A payroll table's side effects stay in the payroll family: its function can see NEW and OLD, so it never needs to name the table to copy it.`
      );
    }
  }

  return [...new Set(failures)];
}

function main(): void {
  const files = loadMigrations().map((migration) => ({
    name: migration.name,
    sql: migration.sql
  }));
  const failures = findPayrollSqlLeaks(files);

  if (failures.length > 0) {
    console.error("payroll:sql-boundary:check FAILED -");

    for (const failure of failures) console.error(`  - ${failure}`);

    process.exitCode = 1;
    return;
  }

  console.log(
    `payroll:sql-boundary:check OK - ${files.length} migration(s): no view, rule, function, copy or foreign trigger reaches a payroll-boundary table (static layer; the catalog layer is payroll:catalog-boundary:check).`
  );
}

if (import.meta.main) {
  main();
}
