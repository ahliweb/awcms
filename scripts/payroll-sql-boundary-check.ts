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
 * Issue #1077 added: `ALTER ... RENAME TO` / `SET SCHEMA` that takes a payroll
 * relation or function out of the family; a table with a payroll module's prefix
 * (`awcms_hr_commission_`, `awcms_hr_payroll_`) whose name is not a family name
 * and is not in `PAYROLL_OWNED_NON_PAYROLL_TABLES`; `findPayrollOwnershipGaps`
 * (every table a payroll-owner module writes or declares is a family name or a
 * reasoned exception); `COPY <payroll> TO` and `COPY (SELECT ... payroll) TO`;
 * a non-family SECURITY DEFINER function using a helper that reads a relation by
 * string or OID (`PAYROLL_INDIRECT_READ_PATTERN`); a `U&"..."` identifier.
 *
 * ## Known limit of this layer (do not widen the claim)
 *
 * A table name assembled at run time from a variable, `format('%I', x)` or a
 * catalog lookup is invisible to a text scan, and a one-shot data copy through
 * such a name leaves no object in the catalog. For a MIGRATION that limit is
 * NARROWED, not closed (Issue #1077, M5, and its audit): a `DO` block with
 * `EXECUTE`, EVERY function judged where it is created (body statements run
 * through these analysers, so create-call-drop is caught), `UPDATE`/`MERGE`
 * that read payroll, and the helpers of `PAYROLL_QUERY_TEXT_HELPER_PATTERN`
 * (quoted or not) are refused, each unless the migration is named in
 * `PAYROLL_DO_EXECUTE_ALLOWLIST` with a reason (two entries, neither
 * payroll-adjacent). The helper list is finite: a helper that runs a query text
 * and is not on it is a hole until it is added. A plain `SELECT`/`INSERT` in a
 * migration names its table in the text. What remains is APPLICATION code that
 * builds a table name at run time: held by review, by the grants layer (only the
 * runtime roles can read payroll tables at all) and by the sensitive-read
 * import gate, not by this one.
 *
 * ## The model, stated honestly (Issue #1077 audits)
 *
 * This scan and the catalog check are defence in depth against ACCIDENTAL and
 * OBVIOUS leaks. A text scanner can always be evaded by a determined author of a
 * reviewed migration; REVIEW of every `sql/` change that touches payroll
 * (CODEOWNERS and the security review AGENTS.md requires for sensitive modules)
 * remains the primary control. Escaped literals as DO/function bodies,
 * `session_replication_role`, direct catalog writes and a trigger renamed on a
 * payroll table are refused outright because they cannot be read, not because
 * they are always wrong.
 *
 * Pure: reads `sql/` and the module registry, no database.
 */
import {
  PAYROLL_DO_EXECUTE_ALLOWLIST,
  PAYROLL_INDIRECT_READ_PATTERN,
  PAYROLL_OWNED_NON_PAYROLL_TABLES,
  PAYROLL_OWNER_CHANGE_ALLOWLIST,
  PAYROLL_QUERY_TEXT_HELPER_PATTERN,
  PAYROLL_REQUIRED_TRIGGERS,
  PAYROLL_OWNER_MODULE_KEYS,
  isPayrollTable
} from "../src/modules/_shared/payroll-data-boundary";
import { listModules } from "../src/modules";
import { loadMigrations } from "./lib/migrations";
import {
  dollarQuotedBodies,
  foldStringConcatenation,
  singleQuotedLiterals,
  splitSqlStatements
} from "./lib/sql-statements";

import { collectTableWrites } from "./table-write-ownership-check";

export type SqlFile = { name: string; sql: string };

/** True when `raw` names the same object as its lower-cased, unquoted form. */
function isExactIdentifier(raw: string): boolean {
  const last = raw
    .trim()
    .split(/\s*\.\s*/)
    .pop()!;

  if (!last.startsWith('"')) return true;

  const inner = last.slice(1, -1);

  return inner === inner.toLowerCase() && !/\s/.test(inner);
}

/** Tables a payroll-owner module names with its own prefix (Issue #1077, M1). */
const PAYROLL_MODULE_TABLE_PREFIX = /^awcms_hr_(?:commission|payroll)(?:_|$)/;

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

type FunctionDef = { file: string; text: string; securityDefiner: boolean };

type Context = {
  relations: Map<string, Relation>;
  inserts: (Relation & { target: string })[];
  /** `COPY (SELECT ...) TO`: the query text, resolved with the other reads at the end. */
  copyQueries: { file: string; body: string }[];
  /** `DISABLE TRIGGER` on a payroll table not yet re-enabled in its migration. */
  disabledTriggers: Map<string, string>;
  /** The last `COMMENT ON TABLE` of each payroll-family table (Issue #1077 audit, H1). */
  tableComments: Map<string, { file: string; marked: boolean }>;
  /** Non-family plpgsql functions that run `EXECUTE`, judged at creation. */
  dynamicFunctions: { file: string; name: string }[];
  functions: Map<string, FunctionDef>;
  triggers: { file: string; name: string; table: string; fn: string }[];
  immediate: string[];
};

function newContext(): Context {
  return {
    relations: new Map(),
    inserts: [],
    copyQueries: [],
    tableComments: new Map(),
    disabledTriggers: new Map(),
    dynamicFunctions: [],
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

  // A Unicode-escaped identifier (`U&"\0061wcms_..."`) spells an object name
  // the token scan cannot read (Issue #1077, M2). Nothing here needs one.
  if (depth === 0 && /\bU&\s*"/i.test(text)) {
    ctx.immediate.push(
      `${file}: a Unicode-escaped identifier (U&"...") spells an object name the payroll gate cannot read. Write the identifier out.`
    );
  }

  // The helpers that run a QUERY TEXT (or read a relation by name) are a way for
  // a migration to read a table whose name is built at run time (Issue #1077,
  // M5). Nothing in `sql/` uses one.
  if (depth === 0 && PAYROLL_QUERY_TEXT_HELPER_PATTERN.test(text)) {
    ctx.immediate.push(
      `${file}: a helper that runs a query text (query_to_xml, schema_to_xml, table_to_xml, database_to_xml, cursor_to_xml, ts_stat, ts_rewrite, crosstab, connectby, dblink, lo_from_bytea, lo_import, lo_export, lo_put, pg_read_file, pg_read_binary_file; quoted or not) cannot be held to the payroll boundary by a text scan. Write the statement out.`
    );
  }

  // HIGH-1: an escaped literal (E'\x63...', U&'\0063...') used as a DO or
  // function body hides a payroll name from every text scan, because the scan
  // reads the literal, not the string PostgreSQL decodes from it. Nothing in
  // `sql/` needs one: write the body as a dollar-quoted block.
  if (
    depth === 0 &&
    (/^\s*DO\b/i.test(text) ||
      /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(
        text
      )) &&
    /(?<![\w$])(?:E|U&)'/i.test(text)
  ) {
    ctx.immediate.push(
      `${file}: a DO block or function uses an escaped string literal (E'...' or U&'...'). Its escapes (\\x63, \\0063) can spell a payroll name that no text scan decodes; write the body as a dollar-quoted block (Issue #1077 audit, HIGH-1).`
    );
  }

  // LOW-3: the replication role switches off every trigger and rule, the
  // immutability triggers of the ledger included.
  if (depth === 0 && /session_replication_role/i.test(text)) {
    ctx.immediate.push(
      `${file}: session_replication_role is changed; it disables the triggers that make a payroll table a ledger (Issue #1077 audit, LOW-3).`
    );
  }

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

  // ---- Issue #1077 audit, H1/L1/M5: things that take a payroll object out of
  // the family or hollow it, in any statement form, and inside function bodies.
  const familyRename = new RegExp(
    String.raw`${start}ALTER\s+(?:MATERIALIZED\s+VIEW|VIEW|FOREIGN\s+TABLE|TABLE|INDEX|SEQUENCE|TYPE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})\s+(?:RENAME\s+TO|SET\s+SCHEMA)\s+(${NAME})`,
    "i"
  ).exec(text);

  if (
    familyRename &&
    isPayrollTable(bareName(familyRename[1]!)) &&
    (/\bSET\s+SCHEMA\b/i.test(text)
      ? bareName(familyRename[2]!) !== "public"
      : // A QUOTED name keeps its case and its spaces: "AWCMS_HR_..." and
        // "awcms_hr_... " are not the family name PostgreSQL looks up.
        !isPayrollTable(bareName(familyRename[2]!)) ||
        !isExactIdentifier(familyRename[2]!))
  ) {
    ctx.immediate.push(
      `${file}: ${bareName(familyRename[1]!)} (a table, view, index or sequence of the payroll family) is renamed to or moved into ${bareName(familyRename[2]!)}, outside the family, whose membership is its name (Issue #1077, M1).`
    );
  }

  // A trigger renamed on a payroll table leaves its required name behind.
  const triggerRename = new RegExp(
    String.raw`${start}ALTER\s+TRIGGER\s+${IDENT}\s+ON\s+(${NAME})\s+RENAME\s+TO\b`,
    "i"
  ).exec(text);

  if (triggerRename && isPayrollTable(bareName(triggerRename[1]!))) {
    ctx.immediate.push(
      `${file}: a trigger of payroll table ${bareName(triggerRename[1]!)} is renamed; the required trigger names are how the catalog layer tells the real ledger from a look-alike (Issue #1077 audit).`
    );
  }

  // Writing the catalog directly renames, hides or re-owns anything.
  if (
    depth === 0 &&
    /(?<![\w$])(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:pg_catalog\s*\.\s*)?"?pg_(?:class|trigger|proc|namespace|attribute|constraint|depend|authid|auth_members|policy|rewrite|index|type)"?(?![\w$])/i.test(
      text
    )
  ) {
    ctx.immediate.push(
      `${file}: a statement writes a system catalog (pg_class, pg_trigger, ...) directly; it can rename or hide any payroll object (Issue #1077 audit).`
    );
  }

  const ownerChange = new RegExp(
    String.raw`${start}ALTER\s+(?:MATERIALIZED\s+VIEW|VIEW|FOREIGN\s+TABLE|TABLE|INDEX|SEQUENCE|TYPE|FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})[^;]{0,300}?\bOWNER\s+TO\b`,
    "i"
  ).exec(text);

  if (
    ownerChange &&
    isPayrollTable(bareName(ownerChange[1]!)) &&
    !Object.hasOwn(PAYROLL_OWNER_CHANGE_ALLOWLIST, file)
  ) {
    ctx.immediate.push(
      `${file}: ALTER ... ${bareName(ownerChange[1]!)} OWNER TO changes who owns a payroll object; an owner holds every privilege on it. Name the migration in PAYROLL_OWNER_CHANGE_ALLOWLIST with the reason, or do not (Issue #1077 audit, M5).`
    );
  }

  if (/^\s*REASSIGN\s+OWNED\b/i.test(text)) {
    ctx.immediate.push(
      `${file}: REASSIGN OWNED moves every object of a role, payroll objects included, to another owner (Issue #1077 audit, M5).`
    );
  }

  if (/^\s*ALTER\s+EXTENSION\s+(?:"[^"]+"|[\w$]+)\s+ADD\b/i.test(text)) {
    ctx.immediate.push(
      `${file}: ALTER EXTENSION ... ADD makes an object an extension member, and the catalog layer does not read extension members at all (Issue #1077 audit, L1).`
    );
  }

  const dropTrigger = new RegExp(
    String.raw`${start}DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?${IDENT}\s+ON\s+(${NAME})`,
    "i"
  ).exec(text);
  const triggerSwitch = new RegExp(
    String.raw`${start}ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})\s+(DISABLE|ENABLE(?:\s+(?:REPLICA|ALWAYS))?)\s+TRIGGER\s+(${IDENT})`,
    "i"
  ).exec(text);
  const triggerTarget = dropTrigger?.[1];

  // DISABLE is how a backfill steps around an immutability trigger (sql/236). It
  // is accepted only when the SAME migration enables the trigger again.
  if (triggerSwitch && isPayrollTable(bareName(triggerSwitch[1]!))) {
    const table = bareName(triggerSwitch[1]!);
    const verb = triggerSwitch[2]!.toUpperCase();
    const target = bareName(triggerSwitch[3]!);
    // ALL and USER stand for every trigger of the table: the required ones by
    // name, plus a wildcard for any other.
    const names =
      target === "all" || target === "user"
        ? [...(PAYROLL_REQUIRED_TRIGGERS[table] ?? []), "*"]
        : [target];

    if (verb === "DISABLE") {
      for (const name of names) {
        ctx.disabledTriggers.set(`${file}\u0000${table}\u0000${name}`, file);
      }
    } else if (verb === "ENABLE") {
      for (const name of names) {
        ctx.disabledTriggers.delete(`${file}\u0000${table}\u0000${name}`);
      }

      // ENABLE TRIGGER ALL re-enables the wildcard too, and everything.
      if (names.includes("*")) {
        for (const key of [...ctx.disabledTriggers.keys()]) {
          if (key.startsWith(`${file}\u0000${table}\u0000`)) {
            ctx.disabledTriggers.delete(key);
          }
        }
      }
    } else {
      ctx.immediate.push(
        `${file}: ${verb} TRIGGER on payroll table ${bareName(triggerSwitch[1]!)} changes when its triggers fire (Issue #1077 audit, H1).`
      );
    }
  }

  if (triggerTarget && isPayrollTable(bareName(triggerTarget))) {
    ctx.immediate.push(
      `${file}: a trigger is dropped or disabled on payroll table ${bareName(triggerTarget)}. The immutability and audit triggers are what make the ledger a ledger (Issue #1077 audit, H1).`
    );
  }

  const comment = new RegExp(
    String.raw`${start}COMMENT\s+ON\s+TABLE\s+(${NAME})\s+IS\s+([\s\S]*)$`,
    "i"
  ).exec(text);

  if (comment && isPayrollTable(bareName(comment[1]!))) {
    ctx.tableComments.set(bareName(comment[1]!), {
      file,
      // A plain or dollar-quoted literal; an E'...' literal is refused as unreadable.
      marked: /^(?:'|\$[A-Za-z_]*\$)payroll-boundary/.test(comment[2]!.trim())
    });
  }

  // `COPY <payroll> TO` and `COPY (SELECT ... payroll) TO` move rows out of the
  // database into a file or a program (Issue #1077, M4). `COPY ... FROM` writes.
  const copyQuery = /^\s*COPY\s*\(([\s\S]*)\)\s+TO\b/i.exec(text);

  if (copyQuery) {
    ctx.copyQueries.push({ file, body: copyQuery[1]! });
    return;
  }

  const copyTable = new RegExp(
    String.raw`^\s*COPY\s+(${NAME})\s*(?:\([^)]*\))?\s+TO\b`,
    "i"
  ).exec(text);

  if (copyTable) {
    const table = bareName(copyTable[1]!);

    if (isPayrollTable(table)) {
      ctx.immediate.push(
        `${file}: COPY ${table} TO moves payroll rows out of the database. Payroll data leaves only through its module's audited export.`
      );
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
    const createdName = bareName(created[1]!);

    if (
      PAYROLL_MODULE_TABLE_PREFIX.test(createdName) &&
      !isPayrollTable(createdName) &&
      !Object.hasOwn(PAYROLL_OWNED_NON_PAYROLL_TABLES, createdName)
    ) {
      ctx.immediate.push(
        `${file}: table ${createdName} carries the payroll modules' prefix but is not a payroll-family name (isPayrollTable), and is not in PAYROLL_OWNED_NON_PAYROLL_TABLES with a reason. A phase-3 table named outside the family would sit outside every registry gate (Issue #1077, M1).`
      );
    }

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

  // `UPDATE t SET c = (SELECT ... FROM payroll)`, `UPDATE ... FROM payroll` and
  // `MERGE INTO t USING payroll` copy payroll values into another table
  // (Issue #1077 audit, H2).
  const update = new RegExp(
    String.raw`${dml}UPDATE\s+(?:ONLY\s+)?(${NAME})\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*)$`,
    "i"
  ).exec(text);
  const merge = new RegExp(
    String.raw`${dml}MERGE\s+INTO\s+(?:ONLY\s+)?(${NAME})([\s\S]*)$`,
    "i"
  ).exec(text);
  const writer = update ?? merge;

  if (writer && !isPayrollTable(bareName(writer[1]!))) {
    ctx.inserts.push({
      file,
      kind: "copy",
      body: writer[2]!,
      mode: "positions",
      target: bareName(writer[1]!)
    });
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
    // A function that runs EXECUTE can build a relation name at run time. A
    // migration can CALL it and then DROP or REPLACE it, leaving no object for
    // the catalog layer and no text for the end-of-run scan (Issue #1077, M5).
    // So it is judged where it is CREATED, like a DO block, whatever becomes of
    // it later.
    if (
      depth === 0 &&
      !isPayrollTable(bareName(fn[1]!)) &&
      !Object.hasOwn(PAYROLL_DO_EXECUTE_ALLOWLIST, file) &&
      /\bLANGUAGE\s+'?plpgsql'?/i.test(text) &&
      /(?<![\w$])EXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/i.test(text)
    ) {
      ctx.dynamicFunctions.push({ file, name: bareName(fn[1]!) });
    }

    // Every non-family function is judged where it is CREATED, body included
    // (Issue #1077 audit, H1/H2): a migration can create, call and drop one,
    // and the end-of-run scan never sees it. Its statements run through the
    // same analysers as a DO block, and a body that names a payroll table or
    // calls a family function fails on the spot.
    if (depth === 0 && !isPayrollTable(bareName(fn[1]!))) {
      const bodies = dollarQuotedBodies(text);
      const sources = bodies.length > 0 ? bodies : singleQuotedLiterals(text);
      const direct = forbiddenTablesIn(text);

      if (direct.length > 0) {
        ctx.immediate.push(
          `${file}: function ${bareName(fn[1]!)} names ${direct.join(", ")} but is not itself a payroll function, whatever becomes of it later (create-call-drop included).`
        );
      }

      for (const body of sources) {
        for (const inner of splitSqlStatements(body)) {
          analyseStatement(inner, file, ctx, true, depth + 1);
        }
      }
    }

    ctx.functions.set(bareName(fn[1]!), {
      file,
      text,
      securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(text)
    });
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
    String.raw`${start}ALTER\s+(?:MATERIALIZED\s+)?(?:VIEW|TABLE|INDEX|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})\s+RENAME\s+TO\s+(${NAME})`,
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

  // The family is `public` + a payroll name (the catalog layer): moving one to
  // another schema leaves it outside, exactly like a rename.
  const setSchema = new RegExp(
    String.raw`${start}ALTER\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?(${NAME})[^;]{0,300}?\bSET\s+SCHEMA\s+(${NAME})`,
    "i"
  ).exec(text);

  if (
    setSchema &&
    isPayrollTable(bareName(setSchema[1]!)) &&
    bareName(setSchema[2]!) !== "public"
  ) {
    ctx.immediate.push(
      `${file}: ${bareName(setSchema[1]!)} is moved to schema ${bareName(setSchema[2]!)}; a payroll relation stays in public, where the boundary looks for it (Issue #1077, M1).`
    );
  }

  const renameFn = new RegExp(
    String.raw`${start}ALTER\s+(?:FUNCTION|PROCEDURE)\s+(${NAME})\s*(?:\([^)]*\))?\s+RENAME\s+TO\s+(${NAME})`,
    "i"
  ).exec(text);

  if (renameFn) {
    const from = bareName(renameFn[1]!);
    const entry = ctx.functions.get(from);

    if (isPayrollTable(from) && !isPayrollTable(bareName(renameFn[2]!))) {
      ctx.immediate.push(
        `${file}: ALTER FUNCTION ${from} RENAME TO ${bareName(renameFn[2]!)} takes a payroll-family function out of the family, and with it the grant check (Issue #1077, M1).`
      );
    }

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

  for (const [name, def] of ctx.functions) {
    if (
      !isPayrollTable(name) &&
      def.securityDefiner &&
      PAYROLL_INDIRECT_READ_PATTERN.test(foldStringConcatenation(def.text))
    ) {
      failures.push(
        `${def.file}: function ${name} is SECURITY DEFINER outside the payroll family and uses a helper that reads a relation named by a string or an OID (schema_to_xml, query_to_xml, table_to_xml, regclass, format(), ts_stat, dblink, U&"..."). Its body never needs to spell the table to read it, so the gate cannot hold it to the rule (Issue #1077, M2). Name it in the payroll family or do not create it.`
      );
    }
  }

  for (const dynamic of ctx.dynamicFunctions) {
    failures.push(
      `${dynamic.file}: function ${dynamic.name} runs dynamic SQL (EXECUTE) and is not a payroll-family function. A migration that creates one can call it and drop it, leaving no object behind, with a relation name built at run time; write the statement out, or name the migration in PAYROLL_DO_EXECUTE_ALLOWLIST with the reason (Issue #1077, M5).`
    );
  }

  for (const query of ctx.copyQueries) {
    const read = reachedBy(query.body, false);

    if (read.length > 0) {
      failures.push(
        `${query.file}: COPY (SELECT ...) TO reads ${read.join(", ")}, moving payroll rows out of the database (Issue #1077, M4).`
      );
    }
  }

  for (const key of ctx.disabledTriggers.keys()) {
    const [file, table, trigger] = key.split("\u0000");

    failures.push(
      `${file}: DISABLE TRIGGER ${trigger === "*" ? "ALL/USER" : trigger} on payroll table ${table} is never followed by ENABLE TRIGGER for the same trigger in the same migration (Issue #1077 audit, HIGH-2).`
    );
  }

  for (const [table, comment] of ctx.tableComments) {
    if (!comment.marked) {
      failures.push(
        `${comment.file}: the last COMMENT ON TABLE ${table} does not start with 'payroll-boundary'. The marker is what the catalog layer uses to notice a payroll table that left the family (Issue #1077 audit, H1).`
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

/**
 * Issue #1077, M1: every table a payroll-owner module owns must be a payroll
 * table by NAME, so a future phase-3 table (run lines, periods, rules) cannot
 * fall outside the family by being named unluckily. `owned` is what the modules
 * say they own (`source` names where the claim comes from: a writer file or a
 * `subjectData` descriptor); the migrations' own `CREATE TABLE` names with a
 * payroll module's prefix are checked inside {@link findPayrollSqlLeaks}.
 * An entry of `PAYROLL_OWNED_NON_PAYROLL_TABLES` that no module and no
 * migration mentions any more is stale.
 */
export function findPayrollOwnershipGaps(
  owned: readonly { table: string; source: string }[],
  files: readonly SqlFile[],
  exceptions: Readonly<
    Record<string, string>
  > = PAYROLL_OWNED_NON_PAYROLL_TABLES
): string[] {
  const failures: string[] = [];
  const known = new Set<string>();

  for (const { table, source } of owned) {
    const name = table.toLowerCase();

    known.add(name);

    if (!isPayrollTable(name) && !Object.hasOwn(exceptions, name)) {
      failures.push(
        `${source}: ${name} is owned by a payroll module but its name is not in the payroll family (isPayrollTable). Rename it into the family, widen FORBIDDEN_PAYROLL_TABLE_PATTERNS, or list it in PAYROLL_OWNED_NON_PAYROLL_TABLES with the reason it is not pay data (Issue #1077, M1).`
      );
    }
  }

  for (const file of files) {
    for (const match of file.sql.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(awcms_[a-z0-9_]+)"?/gi
    )) {
      known.add(match[1]!.toLowerCase());
    }
  }

  for (const table of Object.keys(exceptions)) {
    if (!known.has(table)) {
      failures.push(
        `stale PAYROLL_OWNED_NON_PAYROLL_TABLES entry: ${table} is neither created by a migration nor owned by a module any more.`
      );
    }
  }

  return failures;
}

/** What the payroll-owner modules say they own: literal writers and `subjectData` descriptors. */
async function ownedByPayrollModules(): Promise<
  { table: string; source: string }[]
> {
  const owned: { table: string; source: string }[] = [];

  for (const module of listModules()) {
    if (!PAYROLL_OWNER_MODULE_KEYS.includes(module.key)) continue;

    for (const entry of module.subjectData ?? []) {
      owned.push({
        table: entry.tableName,
        source: `${module.key} subjectData ${entry.key}`
      });
    }
  }

  for (const write of await collectTableWrites()) {
    if (PAYROLL_OWNER_MODULE_KEYS.includes(write.owner)) {
      owned.push({ table: write.table, source: write.file });
    }
  }

  return owned;
}

async function main(): Promise<void> {
  const files = loadMigrations().map((migration) => ({
    name: migration.name,
    sql: migration.sql
  }));
  const failures = [
    ...findPayrollSqlLeaks(files),
    ...findPayrollOwnershipGaps(await ownedByPayrollModules(), files)
  ];

  if (failures.length > 0) {
    console.error("payroll:sql-boundary:check FAILED -");

    for (const failure of failures) console.error(`  - ${failure}`);

    process.exitCode = 1;
    return;
  }

  console.log(
    `payroll:sql-boundary:check OK - ${files.length} migration(s): no view, rule, function, copy or foreign trigger reaches a payroll-boundary table, and every table a payroll module owns is in the payroll family (static layer; the catalog layer is payroll:catalog-boundary:check).`
  );
}

if (import.meta.main) {
  await main();
}
