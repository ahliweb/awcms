/**
 * Evasion probes for the payroll SQL boundary (Issue #1015).
 *
 * The first ten are the ones the #978 re-audit (commit 76554c17) wrote against
 * the text-only gate; 10 of 14 evaded it. The rest are the gaps the catalog
 * layer closes that no text scan can (grants, inheritance, run-time names).
 *
 * Each probe is a COMPLETE migration body that is valid against a fully migrated
 * database (it runs, inside a transaction that is rolled back, in
 * `tests/integration/payroll-catalog-boundary.integration.test.ts`) and is also
 * fed to the static gate as a migration file. `staticCaught` and
 * `catalogCodes` state, per layer, what is expected - including where a layer
 * honestly CANNOT see the probe, so a change that quietly widens or narrows
 * either layer turns a test red instead of rewording a doc.
 *
 * The payroll table used is `awcms_hr_commission_accruals`, the only
 * payroll-boundary table that exists today.
 */
export type PayrollProbe = {
  id: string;
  /** Which of the issue's evasions this is. */
  evasion: string;
  sql: string;
  /** The static gate (`findPayrollSqlLeaks`) must report at least one failure. */
  staticCaught: boolean;
  /** Finding codes the catalog layer must report (a subset check); `[]` means it cannot see the probe. */
  catalogCodes: string[];
};

const PAYROLL = "awcms_hr_commission_accruals";

export const PAYROLL_BOUNDARY_PROBES: readonly PayrollProbe[] = [
  {
    id: "dynamic-execute-concat",
    evasion: "dynamic EXECUTE with concatenated names in a DO block",
    sql: `DO $probe$ BEGIN
  EXECUTE 'CREATE VIEW awcms_probe_v1 AS SELECT * FROM ' || 'awcms_hr_commission' || '_accruals';
END $probe$;`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "dynamic-execute-runtime-name",
    evasion:
      "the same, but the suffix is a variable (the name exists only at run time)",
    sql: `DO $probe$ DECLARE suffix text := 'accruals';
BEGIN
  EXECUTE 'CREATE VIEW awcms_probe_v1b AS SELECT * FROM awcms_hr_commission_' || suffix;
END $probe$;`,
    // Not by name (the table is never spelled out) but because a migration DO
    // block that runs EXECUTE must be allow-listed.
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "setof-secdef-view",
    evasion:
      "a SETOF <payroll table> SECURITY DEFINER function with a view built over it",
    sql: `CREATE FUNCTION awcms_probe_rows() RETURNS SETOF ${PAYROLL}
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT * FROM ${PAYROLL} $$;
CREATE VIEW awcms_probe_v2 AS SELECT * FROM awcms_probe_rows();`,
    staticCaught: true,
    catalogCodes: [
      "function-payroll-row-type",
      "function-reads-payroll",
      "relation-over-leaking-function"
    ]
  },
  {
    id: "rule-do-also-insert",
    evasion: "CREATE RULE ... DO ALSO INSERT ... SELECT",
    sql: `CREATE TABLE awcms_probe_sink3 (LIKE ${PAYROLL});
CREATE RULE awcms_probe_r3 AS ON INSERT TO ${PAYROLL}
  DO ALSO INSERT INTO awcms_probe_sink3 SELECT NEW.*;`,
    staticCaught: true,
    catalogCodes: ["payroll-rule-writes-outside"]
  },
  {
    id: "rule-on-ordinary-table-reads-payroll",
    evasion: "a rule on an ordinary table that reads payroll",
    sql: `CREATE TABLE awcms_probe_a3b (id int);
CREATE TABLE awcms_probe_b3b (id uuid);
CREATE RULE awcms_probe_r3b AS ON INSERT TO awcms_probe_a3b
  DO ALSO INSERT INTO awcms_probe_b3b SELECT id FROM ${PAYROLL};`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "semicolon-in-literal",
    evasion: "a ; inside a string literal",
    sql: `CREATE VIEW awcms_probe_v4 AS SELECT ';' AS semi, * FROM ${PAYROLL};`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "select-into",
    evasion: "SELECT ... INTO <new table>",
    sql: `SELECT * INTO awcms_probe_t5 FROM ${PAYROLL};`,
    staticCaught: true,
    // A one-shot copy leaves a table with no dependency on its source.
    catalogCodes: []
  },
  {
    id: "insert-select",
    evasion: "INSERT INTO <table> SELECT",
    sql: `CREATE TABLE awcms_probe_t6 (LIKE ${PAYROLL});
INSERT INTO awcms_probe_t6 SELECT * FROM ${PAYROLL};`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "uppercase-name",
    evasion: "table names in UPPERCASE",
    sql: `CREATE VIEW awcms_probe_v7 AS SELECT * FROM ${PAYROLL.toUpperCase()};`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "trigger-body-single-quoted",
    evasion: "a trigger function body in single quotes",
    sql: `CREATE TABLE awcms_probe_sink8 (id int);
CREATE FUNCTION awcms_probe_fn8() RETURNS trigger LANGUAGE plpgsql
  AS 'BEGIN INSERT INTO awcms_probe_sink8 SELECT 1 FROM ${PAYROLL} LIMIT 1; RETURN NEW; END';
CREATE TRIGGER awcms_probe_t8 AFTER INSERT ON awcms_probe_sink8
  FOR EACH ROW EXECUTE FUNCTION awcms_probe_fn8();`,
    staticCaught: true,
    catalogCodes: ["function-reads-payroll", "trigger-foreign-function"]
  },
  {
    id: "transitive-trigger",
    evasion: "a transitive trigger: trigger -> f1 -> f2 -> payroll",
    sql: `CREATE TABLE awcms_probe_sink9a (id int);
CREATE FUNCTION awcms_probe_leaf9a() RETURNS bigint LANGUAGE sql
  AS 'SELECT count(*) FROM ${PAYROLL}';
CREATE FUNCTION awcms_probe_mid9a() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN PERFORM awcms_probe_leaf9a(); RETURN NEW; END $$;
CREATE TRIGGER awcms_probe_t9a AFTER INSERT ON awcms_probe_sink9a
  FOR EACH ROW EXECUTE FUNCTION awcms_probe_mid9a();`,
    staticCaught: true,
    catalogCodes: [
      "function-reads-payroll",
      "function-chain",
      "trigger-foreign-function"
    ]
  },
  {
    id: "function-chain",
    evasion: "a function chain three deep: f1 -> f2 -> f3 -> payroll",
    sql: `CREATE FUNCTION awcms_probe_f3() RETURNS bigint LANGUAGE sql
  AS 'SELECT count(*) FROM ${PAYROLL}';
CREATE FUNCTION awcms_probe_f2() RETURNS bigint LANGUAGE sql
  AS 'SELECT awcms_probe_f3()';
CREATE FUNCTION awcms_probe_f1() RETURNS bigint LANGUAGE sql
  AS 'SELECT awcms_probe_f2()';`,
    staticCaught: true,
    catalogCodes: ["function-reads-payroll", "function-chain"]
  },
  {
    id: "view-rename",
    evasion: "CREATE VIEW awcms_hr_payroll_tmp ..., then ALTER VIEW ... RENAME",
    sql: `CREATE VIEW awcms_hr_payroll_tmp AS SELECT * FROM ${PAYROLL};
ALTER VIEW awcms_hr_payroll_tmp RENAME TO awcms_probe_v10;`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "dynamic-sql-function",
    evasion: "a plpgsql function whose relation name exists only at run time",
    sql: `CREATE FUNCTION awcms_probe_dyn() RETURNS void LANGUAGE plpgsql
  AS $$ DECLARE t text := 'accruals';
  BEGIN EXECUTE 'CREATE TABLE awcms_probe_t11 AS SELECT * FROM awcms_hr_commission_' || t; END $$;`,
    staticCaught: true,
    catalogCodes: ["function-dynamic-sql"]
  },
  {
    id: "trigger-on-payroll-foreign-function",
    evasion:
      "a trigger on a payroll table whose function copies NEW without naming the table",
    sql: `CREATE TABLE awcms_probe_sink14 (payload jsonb);
CREATE FUNCTION awcms_probe_fn14() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN INSERT INTO awcms_probe_sink14 VALUES (to_jsonb(NEW)); RETURN NEW; END $$;
CREATE TRIGGER awcms_probe_t14 AFTER INSERT ON ${PAYROLL}
  FOR EACH ROW EXECUTE FUNCTION awcms_probe_fn14();`,
    staticCaught: true,
    catalogCodes: ["trigger-foreign-function"]
  },
  {
    id: "grant-to-public",
    evasion: "GRANT SELECT on a payroll table to PUBLIC",
    sql: `GRANT SELECT ON ${PAYROLL} TO PUBLIC;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "column-grant-to-other-role",
    evasion: "a column-level grant to a role that is not a payroll role",
    sql: `GRANT SELECT (id) ON ${PAYROLL} TO awcms_partner_view;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "family-secdef-function-public-execute",
    evasion:
      "a payroll-family SECURITY DEFINER function nobody revoked from PUBLIC",
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_rows() RETURNS SETOF ${PAYROLL}
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT * FROM ${PAYROLL} $$;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "worker-table-grant",
    evasion: "GRANT SELECT on a payroll table to awcms_worker",
    sql: `GRANT SELECT ON ${PAYROLL} TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "worker-column-grant",
    evasion: "a column-level SELECT grant on a payroll table to awcms_worker",
    sql: `GRANT SELECT (id) ON ${PAYROLL} TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "worker-execute-setof",
    evasion:
      "awcms_worker may EXECUTE a family SECURITY DEFINER function returning SETOF <payroll>",
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_rows() RETURNS SETOF ${PAYROLL}
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT * FROM ${PAYROLL} $$;
REVOKE ALL ON FUNCTION awcms_hr_payroll_probe_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_payroll_probe_rows() TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "worker-execute-jsonb-dump",
    evasion:
      "awcms_worker may EXECUTE a family SECURITY DEFINER function that dumps the table as jsonb",
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_dump() RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT jsonb_agg(to_jsonb(a)) FROM ${PAYROLL} a $$;
REVOKE ALL ON FUNCTION awcms_hr_payroll_probe_dump() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_payroll_probe_dump() TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "worker-execute-unlisted-count",
    evasion:
      "awcms_worker may EXECUTE a bigint count that is not on the allow-list",
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_count() RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT count(*) FROM ${PAYROLL} $$;
REVOKE ALL ON FUNCTION awcms_hr_payroll_probe_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_payroll_probe_count() TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-grant"]
  },
  {
    id: "quoted-call-to-family-function",
    evasion: 'a non-family function calling public."awcms_hr_payroll_..."()',
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_count() RETURNS bigint
  LANGUAGE sql AS 'SELECT count(*) FROM ${PAYROLL}';
CREATE FUNCTION awcms_probe_caller() RETURNS bigint
  LANGUAGE sql AS 'SELECT public."awcms_hr_payroll_probe_count"()';`,
    staticCaught: true,
    catalogCodes: ["function-calls-payroll-function"]
  },
  {
    id: "with-insert-select",
    evasion:
      "WITH c AS (SELECT ... payroll) INSERT INTO <table> SELECT ... FROM c",
    sql: `CREATE TABLE awcms_probe_t16 (LIKE ${PAYROLL});
WITH c AS (SELECT * FROM ${PAYROLL}) INSERT INTO awcms_probe_t16 SELECT * FROM c;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "ctas-with",
    evasion: "CREATE TABLE ... AS WITH c AS (SELECT ... payroll) SELECT ...",
    sql: `CREATE TABLE awcms_probe_t17 AS WITH c AS (SELECT * FROM ${PAYROLL}) SELECT * FROM c;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "with-select-into",
    evasion: "WITH c AS (SELECT ... payroll) SELECT * INTO <table> FROM c",
    sql: `WITH c AS (SELECT * FROM ${PAYROLL}) SELECT * INTO awcms_probe_t18 FROM c;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "do-execute-benign",
    evasion: "a migration DO block that runs dynamic SQL at all",
    sql: `DO $probe$ BEGIN EXECUTE 'SELECT 1'; END $probe$;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "inheritance",
    evasion: "a payroll table made the child of an ordinary table",
    sql: `CREATE TABLE awcms_probe_parent15 (id uuid);
ALTER TABLE ${PAYROLL} INHERIT awcms_probe_parent15;`,
    staticCaught: false,
    catalogCodes: ["inheritance-crosses-boundary"]
  }
];

/** Clean twins: the same shapes, kept inside the payroll family, must pass both layers. */
export const PAYROLL_BOUNDARY_CLEAN_TWINS: readonly {
  id: string;
  sql: string;
  /** Passed to the catalog analyser (the repository's own allow-list is empty). */
  workerExecuteAllowlist?: string[];
}[] = [
  {
    id: "family-view",
    sql: `CREATE VIEW awcms_hr_payroll_probe_summary AS SELECT * FROM ${PAYROLL};`
  },
  {
    id: "family-function-and-trigger",
    sql: `CREATE TABLE awcms_hr_payroll_probe_log (payload jsonb);
CREATE FUNCTION awcms_hr_payroll_probe_fn() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN INSERT INTO awcms_hr_payroll_probe_log VALUES (to_jsonb(NEW)); RETURN NEW; END $$;
CREATE TRIGGER awcms_hr_payroll_probe_t AFTER INSERT ON ${PAYROLL}
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_payroll_probe_fn();`
  },
  {
    id: "allow-listed-count-for-the-worker",
    workerExecuteAllowlist: ["awcms_hr_payroll_probe_count"],
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_count() RETURNS bigint
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT count(*) FROM ${PAYROLL} $$;
REVOKE ALL ON FUNCTION awcms_hr_payroll_probe_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_hr_payroll_probe_count() TO awcms_app, awcms_worker;`
  },
  {
    id: "ordinary-objects",
    sql: `CREATE TABLE awcms_probe_ok (id int);
CREATE VIEW awcms_probe_ok_v AS SELECT * FROM awcms_probe_ok;
CREATE FUNCTION awcms_probe_ok_fn() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM awcms_probe_ok';`
  }
];
