/**
 * Issue #1046 -- the search_path gate, driven with planted SQL.
 *
 * The committed schema passing proves little (`sql/296` was written to make it
 * pass). What must hold is that each rule FAILS on the shape it exists for, and
 * that the cumulative fold (a later `CREATE OR REPLACE` that drops the pin, a
 * later `ALTER FUNCTION` that restores it) is judged on the FINAL definition.
 */
import { describe, expect, test } from "bun:test";

import {
  countIdentityArguments,
  findUnpinnedFunctions,
  foldFunctions,
  isSafePin,
  readSearchPath,
  splitStatements
} from "../scripts/db-function-search-path-check";
import { loadMigrations } from "../scripts/lib/migrations";

function unpinned(...files: string[]): string[] {
  const { functions } = foldFunctions(
    files.map((sql, index) => ({ name: `${index + 1}.sql`, sql }))
  );

  return findUnpinnedFunctions(functions).map(
    (state) => `${state.name}/${state.arity}`
  );
}

const TRIGGER = (name: string, clauses = "") => `
CREATE OR REPLACE FUNCTION ${name}()
RETURNS trigger
LANGUAGE plpgsql
${clauses}
AS $$
BEGIN
  PERFORM 1 FROM awcms_things;
  RETURN NEW;
END;
$$;`;

describe("what is in scope", () => {
  test("an unpinned trigger function fails", () => {
    expect(unpinned(TRIGGER("awcms_guard"))).toEqual(["awcms_guard/0"]);
  });

  test("an unpinned SECURITY DEFINER function fails", () => {
    expect(
      unpinned(`
CREATE OR REPLACE FUNCTION awcms_lookup(p_code text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER
AS $$ SELECT id FROM awcms_things WHERE code = p_code $$;`)
    ).toEqual(["awcms_lookup/1"]);
  });

  test("a plain function (neither trigger nor definer) is not judged", () => {
    expect(
      unpinned(`
CREATE FUNCTION awcms_helper(p_a integer) RETURNS integer
LANGUAGE sql AS $$ SELECT p_a + 1 $$;`)
    ).toEqual([]);
  });

  test("event_trigger functions are in scope too", () => {
    expect(
      unpinned(
        `CREATE FUNCTION awcms_evt() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END; $$;`
      )
    ).toEqual(["awcms_evt/0"]);
  });
});

describe("what counts as a pin", () => {
  test("pg_temp last passes, with or without pg_catalog", () => {
    expect(
      unpinned(
        TRIGGER("awcms_a", "SET search_path = pg_catalog, public, pg_temp"),
        TRIGGER("awcms_b", "SET search_path = public, pg_temp"),
        TRIGGER("awcms_c", "SET search_path TO public, pg_temp"),
        TRIGGER("awcms_d", "SET search_path = 'public', 'pg_temp'")
      )
    ).toEqual([]);
  });

  test("`public` alone fails: the temp schema is still searched first", () => {
    expect(
      unpinned(TRIGGER("awcms_guard", "SET search_path = public"))
    ).toEqual(["awcms_guard/0"]);
  });

  test("pg_temp not in last position fails", () => {
    expect(
      unpinned(TRIGGER("awcms_guard", "SET search_path = pg_temp, public"))
    ).toEqual(["awcms_guard/0"]);
  });

  test("an empty search_path fails (pg_temp is not named)", () => {
    expect(unpinned(TRIGGER("awcms_guard", "SET search_path = ''"))).toEqual([
      "awcms_guard/0"
    ]);
  });

  test("FROM CURRENT fails: it freezes whatever the session happened to have", () => {
    expect(
      unpinned(TRIGGER("awcms_guard", "SET search_path FROM CURRENT"))
    ).toEqual(["awcms_guard/0"]);
  });

  test("a SET LOCAL inside the body, or in a comment or string, is not a pin", () => {
    expect(
      unpinned(`
-- SET search_path = public, pg_temp
CREATE OR REPLACE FUNCTION awcms_guard()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL search_path = public, pg_temp;
  RAISE NOTICE 'SET search_path = public, pg_temp';
  RETURN NEW;
END;
$$;`)
    ).toEqual(["awcms_guard/0"]);
  });
});

describe("the final definition wins", () => {
  const pinned = TRIGGER("awcms_guard", "SET search_path = public, pg_temp");

  test("CREATE OR REPLACE without the clause UNPINS an earlier pinned definition", () => {
    expect(unpinned(pinned, TRIGGER("awcms_guard"))).toEqual(["awcms_guard/0"]);
  });

  test("a later ALTER FUNCTION ... SET search_path repairs an unpinned one", () => {
    expect(
      unpinned(
        TRIGGER("awcms_guard"),
        "ALTER FUNCTION awcms_guard() SET search_path = pg_catalog, public, pg_temp;"
      )
    ).toEqual([]);
  });

  test("a schema-qualified ALTER repairs it too", () => {
    expect(
      unpinned(
        TRIGGER("awcms_guard"),
        "ALTER FUNCTION public.awcms_guard() SET search_path = pg_catalog, public, pg_temp;"
      )
    ).toEqual([]);
  });

  test("ALTER FUNCTION ... RESET search_path removes the pin again", () => {
    expect(
      unpinned(pinned, "ALTER FUNCTION awcms_guard() RESET search_path;")
    ).toEqual(["awcms_guard/0"]);
    expect(unpinned(pinned, "ALTER FUNCTION awcms_guard() RESET ALL;")).toEqual(
      ["awcms_guard/0"]
    );
  });

  test("a later ALTER with a weaker pin fails", () => {
    expect(
      unpinned(pinned, "ALTER FUNCTION awcms_guard() SET search_path = public;")
    ).toEqual(["awcms_guard/0"]);
  });

  test("CREATE OR REPLACE after the repair unpins it once more", () => {
    expect(
      unpinned(
        TRIGGER("awcms_guard"),
        "ALTER FUNCTION awcms_guard() SET search_path = pg_catalog, public, pg_temp;",
        TRIGGER("awcms_guard")
      )
    ).toEqual(["awcms_guard/0"]);
  });

  test("ALTER FUNCTION ... SECURITY DEFINER brings a plain function into scope", () => {
    const plain = `CREATE FUNCTION awcms_helper() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;`;

    expect(unpinned(plain)).toEqual([]);
    expect(
      unpinned(plain, "ALTER FUNCTION awcms_helper() SECURITY DEFINER;")
    ).toEqual(["awcms_helper/0"]);
  });

  test("OWNER TO does not disturb the pin", () => {
    expect(
      unpinned(pinned, "ALTER FUNCTION awcms_guard() OWNER TO awcms_owner;")
    ).toEqual([]);
  });

  test("a dropped function is no longer judged", () => {
    expect(
      unpinned(TRIGGER("awcms_guard"), "DROP FUNCTION awcms_guard();")
    ).toEqual([]);
    expect(
      unpinned(TRIGGER("awcms_guard"), "DROP FUNCTION IF EXISTS awcms_guard;")
    ).toEqual([]);
  });

  test("a rename carries the state to the new name", () => {
    expect(
      unpinned(
        TRIGGER("awcms_guard"),
        "ALTER FUNCTION awcms_guard() RENAME TO awcms_guard_v2;"
      )
    ).toEqual(["awcms_guard_v2/0"]);
  });
});

describe("identity by name and arity", () => {
  test("two arities of one name are judged separately", () => {
    expect(
      unpinned(
        `CREATE FUNCTION awcms_f(a integer) RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$ BEGIN END; $$;`,
        `CREATE FUNCTION awcms_f(a integer, b integer) RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN END; $$;`
      )
    ).toEqual(["awcms_f/2"]);
  });

  test("OUT arguments and defaults do not change the identity", () => {
    expect(
      countIdentityArguments("IN a uuid, OUT b integer, c text DEFAULT 'x,y'")
    ).toBe(2);
    expect(countIdentityArguments("")).toBe(0);
    expect(countIdentityArguments("a numeric(10, 2), b integer")).toBe(2);
  });
});

describe("blind spots fail instead of passing", () => {
  test("function DDL inside a DO block is reported", () => {
    const { problems } = foldFunctions([
      {
        name: "9.sql",
        sql: `DO $$ BEGIN EXECUTE 'CREATE FUNCTION awcms_dyn() RETURNS trigger LANGUAGE plpgsql AS ''BEGIN RETURN NEW; END;'''; END $$;`
      }
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("9.sql");
  });
});

describe("parsing helpers", () => {
  test("semicolons inside strings and dollar bodies do not split a statement", () => {
    const { statements } = splitStatements(
      `SELECT 'a;b'; CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $tag$ BEGIN x; y; END; $tag$ SET search_path = a, pg_temp;`
    );

    expect(statements).toHaveLength(2);
    expect(readSearchPath(statements[1]!)).toEqual(["a", "pg_temp"]);
  });

  test("isSafePin demands pg_temp last", () => {
    expect(isSafePin(["pg_catalog", "public", "pg_temp"])).toBe(true);
    expect(isSafePin(["public"])).toBe(false);
    expect(isSafePin(["pg_temp", "public"])).toBe(false);
    expect(isSafePin([])).toBe(false);
    expect(isSafePin(null)).toBe(false);
  });
});

describe("the committed schema", () => {
  test("db:function-search-path:check passes as committed", () => {
    const result = Bun.spawnSync([
      "bun",
      "scripts/db-function-search-path-check.ts"
    ]);

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("a migration that adds an unpinned guard turns the gate red", () => {
    const { functions } = foldFunctions([
      ...loadMigrations(),
      { name: "999_awcms_planted.sql", sql: TRIGGER("awcms_planted_guard") }
    ]);

    expect(findUnpinnedFunctions(functions).map((s) => s.name)).toEqual([
      "awcms_planted_guard"
    ]);
  });

  test("the gate is wired into the check chain", async () => {
    const pkg = JSON.parse(await Bun.file("package.json").text()) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["db:function-search-path:check"]).toBe(
      "bun scripts/db-function-search-path-check.ts"
    );
    expect(pkg.scripts.check).toContain("db:function-search-path:check");
  });
});
