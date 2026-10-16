/**
 * A quote-aware SQL reader for the static gates that read migration text
 * (Issue #1015). It keeps literals and dollar-quoted bodies VERBATIM, which is
 * the difference from `splitStatements` in `db-function-search-path-check.ts`
 * (that one neutralises them because it only needs the header of a statement).
 * The payroll boundary needs the opposite: the interesting text is often
 * INSIDE a literal or a body.
 *
 * What it gets right, and the regex gate it replaces got wrong:
 *
 * - a `;` inside `'...'`, `"..."` or `$tag$...$tag$` does not end a statement;
 * - `--` and block comments (nesting) are comments only outside those;
 * - `E'..\'..'` honours backslash escapes, `'..''..'` doubled quotes.
 */

const DOLLAR_TAG = /^\$([A-Za-z_]\w*)?\$/;

/** Statements of `sql` with comments replaced by one space; literals untouched. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;

  const flush = (): void => {
    if (current.trim() !== "") statements.push(current.trim());
    current = "";
  };

  while (index < sql.length) {
    const char = sql[index]!;

    if (char === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);

      index = end === -1 ? sql.length : end;
      current += " ";
      continue;
    }

    if (char === "/" && sql[index + 1] === "*") {
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

      while (cursor < sql.length) {
        if (escaped && sql[cursor] === "\\") {
          cursor += 2;
          continue;
        }

        if (sql[cursor] === "'") {
          if (sql[cursor + 1] === "'") {
            cursor += 2;
            continue;
          }

          break;
        }

        cursor += 1;
      }

      current += sql.slice(index, cursor + 1);
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

    if (char === "$" && !/[\w$]$/.test(current)) {
      const tag = DOLLAR_TAG.exec(sql.slice(index, index + 80));

      if (tag) {
        const close = sql.indexOf(tag[0], index + tag[0].length);
        const stop = close === -1 ? sql.length : close + tag[0].length;

        current += sql.slice(index, stop);
        index = stop;
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

  return statements;
}

/**
 * `'awcms_hr_pay' || 'roll_runs'` -> `'awcms_hr_payroll_runs'`. Adjacent string
 * literals joined by `||` are one literal to PostgreSQL, so a table name split
 * across them is one table name. (A name built from a variable, `format('%I', x)`
 * or a lookup stays invisible to ANY text scan; that is the limit the catalog
 * gate exists for, see `scripts/lib/payroll-catalog-boundary.ts`.)
 */
export function foldStringConcatenation(text: string): string {
  let folded = text;
  let previous: string;

  do {
    previous = folded;
    folded = folded.replace(
      /'((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)'/g,
      "'$1$2'"
    );
  } while (folded !== previous);

  return folded;
}

/** The text between the outer `$tag$ ... $tag$` of each dollar-quoted body in `statement`. */
export function dollarQuotedBodies(statement: string): string[] {
  const bodies: string[] = [];
  let index = 0;

  while (index < statement.length) {
    const char = statement[index]!;

    if (char === "'") {
      const end = statement.indexOf("'", index + 1);

      index = end === -1 ? statement.length : end + 1;
      continue;
    }

    if (char === "$" && !/[\w$]$/.test(statement.slice(0, index))) {
      const tag = DOLLAR_TAG.exec(statement.slice(index, index + 80));

      if (tag) {
        const close = statement.indexOf(tag[0], index + tag[0].length);

        bodies.push(
          statement.slice(
            index + tag[0].length,
            close === -1 ? undefined : close
          )
        );
        index = close === -1 ? statement.length : close + tag[0].length;
        continue;
      }
    }

    index += 1;
  }

  return bodies;
}

/** Every single-quoted literal in `text`, unescaped (`''` -> `'`). */
export function singleQuotedLiterals(text: string): string[] {
  return [...text.matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
    match[1]!.replace(/''/g, "'")
  );
}
