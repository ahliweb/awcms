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

/** The ledger name with the `c` of `commission` hidden in an E'' escape. */
const HIDDEN = String.raw`awcms_hr_\x63ommission_accruals`;
const HIDDEN_UNICODE = String.raw`awcms_hr_\0063ommission_accruals`;

const LEDGER_CONSTRAINTS = [
  "approved_by_fkey",
  "beneficiary_fkey",
  "calculation_check",
  "correlation_check",
  "created_by_fkey",
  "currency_check",
  "digest_check",
  "employment_fkey",
  "lifecycle_check",
  "not_nan_check",
  "occurred_check",
  "operation_check",
  "paid_by_fkey",
  "payment_ref_check",
  "pkey",
  "range_check",
  "released_by_fkey",
  "rule_fkey",
  "rule_key_check",
  "rule_version_check",
  "shape_check",
  "source_key",
  "source_line_check",
  "source_ref_check",
  "source_type_check",
  "status_check",
  "tenant_id_fkey",
  "tenant_id_key",
  "void_reason_check",
  "voided_by_fkey"
];
const LEDGER_INDEXES = [
  "voided_by_idx",
  "open_idx",
  "list_idx",
  "employment_idx",
  "beneficiary_idx",
  "created_by_idx",
  "paid_by_idx",
  "rule_idx",
  "released_by_idx",
  "approved_by_idx"
];

/** The N4 camouflage of the audit: rename the ledger with everything on it from an E'' DO, then rebuild a fully dressed decoy. */
function camouflage(): string {
  const hide = (text: string) =>
    text.replaceAll("commission", String.raw`\x63ommission`);
  const inner = [
    `ALTER TABLE ${PAYROLL} RENAME TO awcms_probe_x`,
    ...LEDGER_CONSTRAINTS.map(
      (name, index) =>
        `ALTER TABLE awcms_probe_x RENAME CONSTRAINT ${PAYROLL}_${name} TO awcms_probe_x_c${index}`
    ),
    ...LEDGER_INDEXES.map(
      (name, index) =>
        `ALTER INDEX ${PAYROLL}_${name} RENAME TO awcms_probe_x_i${index}`
    ),
    `ALTER POLICY ${PAYROLL}_tenant_isolation ON awcms_probe_x RENAME TO awcms_probe_x_pol`,
    ...["born_valid", "log_birth", "log_change", "immutable"].map(
      (name) => `DROP TRIGGER ${PAYROLL}_${name} ON awcms_probe_x`
    ),
    `COMMENT ON TABLE awcms_probe_x IS NULL`
  ]
    .map((statement) => `${hide(statement)};`)
    .join(" ");

  return `DO E'BEGIN ${inner} END';
CREATE TABLE ${PAYROLL} (LIKE awcms_probe_x INCLUDING DEFAULTS);
ALTER TABLE ${PAYROLL} ADD PRIMARY KEY (id);
ALTER TABLE ${PAYROLL} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${PAYROLL} FORCE ROW LEVEL SECURITY;
CREATE POLICY ${PAYROLL}_tenant_isolation ON ${PAYROLL}
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE TRIGGER ${PAYROLL}_born_valid BEFORE INSERT ON ${PAYROLL} FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_insert_guard();
CREATE TRIGGER ${PAYROLL}_log_birth AFTER INSERT ON ${PAYROLL} FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_log();
CREATE TRIGGER ${PAYROLL}_log_change AFTER UPDATE ON ${PAYROLL} FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_log();
CREATE TRIGGER ${PAYROLL}_immutable BEFORE DELETE OR UPDATE ON ${PAYROLL} FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_accruals_guard();
COMMENT ON TABLE ${PAYROLL} IS 'payroll-boundary: decoy';
GRANT SELECT, INSERT, UPDATE ON ${PAYROLL} TO awcms_app;
GRANT SELECT ON awcms_probe_x TO awcms_worker, PUBLIC;
ALTER TABLE awcms_probe_x NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_probe_x DISABLE ROW LEVEL SECURITY;`;
}

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
    catalogCodes: ["payroll-lookalike"]
  },
  {
    id: "insert-select",
    evasion: "INSERT INTO <table> SELECT",
    sql: `CREATE TABLE awcms_probe_t6 (LIKE ${PAYROLL});
INSERT INTO awcms_probe_t6 SELECT * FROM ${PAYROLL};`,
    staticCaught: true,
    catalogCodes: ["payroll-lookalike"]
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
    catalogCodes: ["payroll-lookalike"]
  },
  {
    id: "ctas-with",
    evasion: "CREATE TABLE ... AS WITH c AS (SELECT ... payroll) SELECT ...",
    sql: `CREATE TABLE awcms_probe_t17 AS WITH c AS (SELECT * FROM ${PAYROLL}) SELECT * FROM c;`,
    staticCaught: true,
    catalogCodes: ["payroll-lookalike"]
  },
  {
    id: "with-select-into",
    evasion: "WITH c AS (SELECT ... payroll) SELECT * INTO <table> FROM c",
    sql: `WITH c AS (SELECT * FROM ${PAYROLL}) SELECT * INTO awcms_probe_t18 FROM c;`,
    staticCaught: true,
    catalogCodes: ["payroll-lookalike"]
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
  },
  // Issue #1077 -------------------------------------------------------------
  {
    id: "m1-rename-out-of-family",
    evasion: "M1: the accrual ledger renamed to a name outside the family",
    sql: `ALTER TABLE ${PAYROLL} RENAME TO awcms_probe_renamed;`,
    staticCaught: true,
    catalogCodes: ["payroll-table-missing", "payroll-marker-outside-family"]
  },
  {
    id: "m1-rename-and-unmark",
    evasion: "M1: the same rename, with the marker comment removed too",
    sql: `ALTER TABLE ${PAYROLL} RENAME TO awcms_probe_renamed2;
COMMENT ON TABLE awcms_probe_renamed2 IS NULL;`,
    staticCaught: true,
    catalogCodes: ["payroll-table-missing"]
  },
  {
    id: "m1-unmarked-family-table",
    evasion: "M1: a new payroll-family table nobody marked",
    sql: `CREATE TABLE awcms_hr_payroll_probe_runs (id uuid);`,
    staticCaught: false,
    catalogCodes: ["payroll-marker-missing"]
  },
  {
    id: "m2-secdef-format",
    evasion:
      "M2: a non-family SECURITY DEFINER function that builds a relation name with format()",
    sql: `CREATE FUNCTION awcms_probe_fmt(t text) RETURNS text
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT format('%I', t) $$;`,
    staticCaught: true,
    catalogCodes: ["function-indirect-read"]
  },
  {
    id: "m2-secdef-query-to-xml",
    evasion:
      "M2: query_to_xml() on a query text that never appears in the body",
    sql: `CREATE FUNCTION awcms_probe_xml() RETURNS xml
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT query_to_xml(current_setting('awcms.probe_query'), true, false, '') $$;`,
    staticCaught: true,
    catalogCodes: ["function-indirect-read"]
  },
  {
    id: "m2-unicode-identifier",
    evasion: 'M2: a view over the ledger spelled with U&"..." escapes',
    sql: `CREATE VIEW awcms_probe_unicode AS SELECT * FROM U&"\\0061wcms_hr_commission_accruals";`,
    staticCaught: true,
    catalogCodes: ["relation-over-payroll"]
  },
  {
    id: "m4-owner-is-runtime-role",
    evasion: "M4: the transition log owned by the request role",
    sql: `ALTER TABLE awcms_hr_commission_transitions OWNER TO awcms_app;`,
    staticCaught: true,
    catalogCodes: ["payroll-owner"]
  },
  {
    id: "m4-member-of-request-role",
    evasion:
      "M4: a new role made a member of awcms_app (inherits, no ACL entry)",
    sql: `CREATE ROLE awcms_probe_member NOLOGIN;
GRANT awcms_app TO awcms_probe_member;`,
    staticCaught: false,
    catalogCodes: ["payroll-role-membership"]
  },
  {
    id: "m4-worker-member-of-request-role",
    evasion: "M4: the worker role made a member of awcms_app",
    sql: `GRANT awcms_app TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-role-membership"]
  },
  {
    id: "m4-publication-all-tables",
    evasion: "M4: a FOR ALL TABLES publication",
    sql: `CREATE PUBLICATION awcms_probe_pub_all FOR ALL TABLES;`,
    staticCaught: false,
    catalogCodes: ["payroll-publication"]
  },
  {
    id: "m4-publication-payroll-table",
    evasion: "M4: a publication of the accrual ledger",
    sql: `CREATE PUBLICATION awcms_probe_pub_one FOR TABLE ${PAYROLL};`,
    staticCaught: false,
    catalogCodes: ["payroll-publication"]
  },
  {
    id: "m4-publication-schema",
    evasion: "M4: a publication of the whole public schema",
    sql: `CREATE PUBLICATION awcms_probe_pub_schema FOR TABLES IN SCHEMA public;`,
    staticCaught: false,
    catalogCodes: ["payroll-publication"]
  },
  {
    id: "m4-foreign-table",
    evasion: "M4: a foreign table whose remote name is the ledger",
    sql: `CREATE FOREIGN DATA WRAPPER awcms_probe_fdw;
CREATE SERVER awcms_probe_srv FOREIGN DATA WRAPPER awcms_probe_fdw;
CREATE FOREIGN TABLE awcms_probe_ft (id uuid) SERVER awcms_probe_srv
  OPTIONS (table_name '${PAYROLL}');`,
    staticCaught: false,
    catalogCodes: ["payroll-foreign-table"]
  },
  {
    id: "m6-policy",
    evasion: "M6: a policy on an ordinary table that reads the ledger",
    sql: `CREATE TABLE awcms_probe_pol (id uuid);
ALTER TABLE awcms_probe_pol ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_probe_policy ON awcms_probe_pol
  USING (EXISTS (SELECT 1 FROM ${PAYROLL}));`,
    staticCaught: false,
    catalogCodes: ["dependent-on-payroll"]
  },
  {
    id: "m6-foreign-key",
    evasion: "M6: a foreign key from an ordinary table to the ledger",
    sql: `CREATE TABLE awcms_probe_fk (accrual_id uuid REFERENCES ${PAYROLL} (id));`,
    staticCaught: false,
    catalogCodes: ["dependent-on-payroll"]
  },
  // Issue #1077 security audit ------------------------------------------------
  {
    id: "h1-alter-index-rename-unmark-droptrigger-decoy",
    evasion:
      "H1: the ledger renamed through ALTER INDEX, unmarked, its four triggers dropped, a look-alike created under the family name with a decoy marker",
    sql: `ALTER INDEX ${PAYROLL} RENAME TO awcms_probe_x;
COMMENT ON TABLE awcms_probe_x IS NULL;
DROP TRIGGER ${PAYROLL}_born_valid ON awcms_probe_x;
DROP TRIGGER ${PAYROLL}_log_birth ON awcms_probe_x;
DROP TRIGGER ${PAYROLL}_log_change ON awcms_probe_x;
DROP TRIGGER ${PAYROLL}_immutable ON awcms_probe_x;
CREATE TABLE ${PAYROLL} (LIKE awcms_probe_x INCLUDING ALL);
COMMENT ON TABLE ${PAYROLL} IS 'payroll-boundary: decoy';`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-missing", "payroll-named-object-outside"]
  },
  {
    id: "h1-rename-inside-sql-function-create-call-drop",
    evasion:
      "H1: the same rename run by a LANGUAGE sql function that is created, called and dropped",
    sql: `CREATE FUNCTION awcms_probe_mv() RETURNS void LANGUAGE sql AS $$
  ALTER TABLE ${PAYROLL} RENAME TO awcms_probe_x;
  COMMENT ON TABLE awcms_probe_x IS NULL $$;
SELECT awcms_probe_mv();
DROP FUNCTION awcms_probe_mv();
CREATE TABLE ${PAYROLL} (LIKE awcms_probe_x INCLUDING ALL);
COMMENT ON TABLE ${PAYROLL} IS 'payroll-boundary: decoy';`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-missing"]
  },
  {
    id: "h2-ctas-quoted-query-to-xml-reversed-name",
    evasion:
      'H2: CREATE TABLE AS over "query_to_xml"(...) with the table name reversed at run time',
    sql: `CREATE TABLE awcms_probe_leak AS SELECT "query_to_xml"('SELECT * FROM ' || reverse('${[...PAYROLL].reverse().join("")}'), true, false, '') AS x;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "h2-ctas-ts-rewrite",
    evasion: "H2: ts_rewrite(tsquery, text) runs a query text",
    sql: `CREATE TABLE awcms_probe_leak2 AS SELECT ts_rewrite('a'::tsquery, 'SELECT ''a''::tsquery, (count(*)::text)::tsquery FROM ' || reverse('${[...PAYROLL].reverse().join("")}')) AS x;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "h2-secdef-ts-rewrite",
    evasion: "H2/M3: a non-family SECURITY DEFINER function using ts_rewrite",
    sql: `CREATE FUNCTION awcms_probe_tsr() RETURNS tsquery LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT ts_rewrite('a'::tsquery, 'SELECT 1') $$;`,
    staticCaught: true,
    catalogCodes: ["function-indirect-read"]
  },
  {
    id: "h2-update-set-subselect",
    evasion: "H2: UPDATE ... SET col = (SELECT ... FROM payroll)",
    sql: `CREATE TABLE awcms_probe_u (id int, amt text);
UPDATE awcms_probe_u SET amt = (SELECT string_agg(amount::text, ',') FROM ${PAYROLL});`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "h2-merge-using-payroll",
    evasion: "H2: MERGE INTO t USING payroll",
    sql: `CREATE TABLE awcms_probe_m (id uuid, amt numeric);
MERGE INTO awcms_probe_m m USING ${PAYROLL} a ON m.id = a.id WHEN NOT MATCHED THEN INSERT VALUES (a.id, a.amount);`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "h2-large-object-writer",
    evasion: "H2: lo_from_bytea(..., (SELECT ... FROM payroll))",
    sql: `SELECT lo_from_bytea(0, convert_to(coalesce((SELECT string_agg(amount::text, ',') FROM ${PAYROLL}), 'none'), 'UTF8'));`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "h2-sql-function-copy-create-call-drop",
    evasion:
      "H2: a LANGUAGE sql function that inserts from payroll, created, called and dropped",
    sql: `CREATE TABLE awcms_probe_sink (amt numeric);
CREATE FUNCTION awcms_probe_cp() RETURNS void LANGUAGE sql AS $$ INSERT INTO awcms_probe_sink SELECT amount FROM ${PAYROLL} $$;
SELECT awcms_probe_cp();
DROP FUNCTION awcms_probe_cp();`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "m3-quoted-qualified-format",
    evasion: 'M3: pg_catalog."format"(...) in a SECURITY DEFINER function',
    sql: `CREATE FUNCTION awcms_probe_qf(t text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT pg_catalog."format"('%I', t) $$;`,
    staticCaught: true,
    catalogCodes: ["function-indirect-read"]
  },
  {
    id: "m4-pg-read-all-data-worker",
    evasion: "M4: the worker made a member of pg_read_all_data",
    sql: `GRANT pg_read_all_data TO awcms_worker;`,
    staticCaught: false,
    catalogCodes: ["payroll-role-membership"]
  },
  {
    id: "m4-runtime-role-bypassrls",
    evasion: "M4: the worker role given BYPASSRLS",
    sql: `ALTER ROLE awcms_worker BYPASSRLS;`,
    staticCaught: false,
    catalogCodes: ["payroll-role-bypass"]
  },
  {
    id: "m5-owner-is-an-unexpected-role",
    evasion: "M5: the ledger handed to a fresh login role (not a runtime role)",
    sql: `CREATE ROLE awcms_probe_owner LOGIN;
ALTER TABLE ${PAYROLL} OWNER TO awcms_probe_owner;`,
    staticCaught: true,
    catalogCodes: ["payroll-owner"]
  },
  {
    id: "l1-extension-member",
    evasion: "L1: the ledger made a member of an extension",
    sql: `ALTER EXTENSION pg_trgm ADD TABLE ${PAYROLL};`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "l2-domain-check-on-family-function",
    evasion:
      "L2: a domain whose CHECK calls a payroll-family SECURITY DEFINER function",
    sql: `CREATE FUNCTION awcms_hr_payroll_probe_ok(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM ${PAYROLL} WHERE id = $1) $$;
CREATE DOMAIN awcms_probe_dom AS uuid CHECK (awcms_hr_payroll_probe_ok(VALUE));
CREATE TABLE awcms_probe_domt (x awcms_probe_dom);`,
    staticCaught: false,
    catalogCodes: ["dependent-on-payroll"]
  },
  // Issue #1077 re-verification audit ----------------------------------------
  {
    id: "high1-do-e-string-copy",
    evasion:
      "HIGH-1: DO E'...' with the ledger name hidden in a \\x escape, copying its rows",
    sql: `CREATE TABLE awcms_probe_sink (amt numeric);
DO E'BEGIN INSERT INTO awcms_probe_sink SELECT amount FROM ${HIDDEN}; END';`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "high1-do-u-string-copy",
    evasion: "HIGH-1: DO U&'...' with a \\0063 escape",
    sql: `CREATE TABLE awcms_probe_sink (amt numeric);
DO U&'BEGIN INSERT INTO awcms_probe_sink SELECT amount FROM ${HIDDEN_UNICODE}; END';`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "high1-function-e-string-create-call-drop",
    evasion:
      "HIGH-1: a LANGUAGE sql function AS E'...' copying the ledger, created, called, dropped",
    sql: `CREATE TABLE awcms_probe_sink (amt numeric);
CREATE FUNCTION awcms_probe_e() RETURNS void LANGUAGE sql AS E'INSERT INTO awcms_probe_sink SELECT amount FROM ${HIDDEN}';
SELECT awcms_probe_e();
DROP FUNCTION awcms_probe_e();`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "high1-do-e-string-rename",
    evasion: "HIGH-1: the ledger renamed from inside DO E'...'",
    sql: `DO E'BEGIN ALTER TABLE ${HIDDEN} RENAME TO awcms_probe_x; END';`,
    staticCaught: true,
    catalogCodes: ["payroll-table-missing", "payroll-fk-missing"]
  },
  {
    id: "high1-full-camouflage",
    evasion:
      "HIGH-1 (N4): the ledger and all its constraints, indexes and policy renamed from DO E'...', its triggers dropped, then a fully dressed decoy built and the real table granted to PUBLIC with RLS off",
    sql: camouflage(),
    staticCaught: true,
    catalogCodes: ["payroll-fk-missing", "payroll-lookalike"]
  },
  {
    id: "high2-disable-all-enable-one",
    evasion:
      "HIGH-2: DISABLE TRIGGER ALL, then ENABLE only one trigger (the pairing was per table)",
    sql: `ALTER TABLE ${PAYROLL} DISABLE TRIGGER ALL;
ALTER TABLE ${PAYROLL} ENABLE TRIGGER ${PAYROLL}_log_birth;`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-disabled"]
  },
  {
    id: "high2-disable-enable-other-table",
    evasion: "HIGH-2: DISABLE on the ledger, ENABLE on the transition log",
    sql: `ALTER TABLE ${PAYROLL} DISABLE TRIGGER ${PAYROLL}_immutable;
ALTER TABLE awcms_hr_commission_transitions ENABLE TRIGGER awcms_hr_commission_transitions_guard;`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-disabled"]
  },
  {
    id: "high2-disable-inside-do",
    evasion: "HIGH-2: DISABLE TRIGGER from inside a DO block",
    sql: `DO $$ BEGIN ALTER TABLE ${PAYROLL} DISABLE TRIGGER ${PAYROLL}_immutable; END $$;`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-disabled"]
  },
  {
    id: "medium1-ledger-missing",
    evasion:
      "MEDIUM-1: the migration ledger renamed away, so no expected owner can be derived, and the ledger handed to a stranger",
    sql: `ALTER TABLE awcms_schema_migrations RENAME TO awcms_probe_ledger;
CREATE ROLE awcms_probe_o3 NOLOGIN;
ALTER TABLE ${PAYROLL} OWNER TO awcms_probe_o3;`,
    staticCaught: true,
    catalogCodes: ["payroll-ledger-missing"]
  },
  {
    id: "low3-session-replication-role",
    evasion:
      "LOW-3: SET LOCAL session_replication_role = replica before touching the ledger",
    sql: `SET LOCAL session_replication_role = replica;`,
    staticCaught: true,
    catalogCodes: []
  },
  {
    id: "audit-rename-to-quoted-lookalike",
    evasion:
      'audit: RENAME TO "AWCMS_HR_COMMISSION_ACCRUALS" (a quoted name keeps its case, so it is not the family name)',
    sql: `ALTER TABLE ${PAYROLL} RENAME TO "AWCMS_HR_COMMISSION_ACCRUALS";`,
    staticCaught: true,
    catalogCodes: ["payroll-table-missing"]
  },
  {
    id: "audit-trigger-renamed-out",
    evasion:
      "audit: ALTER TRIGGER ... RENAME TO takes a required trigger name away",
    sql: `ALTER TRIGGER ${PAYROLL}_immutable ON ${PAYROLL} RENAME TO awcms_probe_trg2;`,
    staticCaught: true,
    catalogCodes: ["payroll-trigger-missing"]
  },
  {
    id: "audit-update-pg-class",
    evasion: "audit: UPDATE pg_class renames the ledger without any ALTER",
    sql: `UPDATE pg_class SET relname = 'awcms_probe_cat' WHERE relname = reverse('slaurcca_noissimmoc_rh_smcwa') AND relnamespace = 'public'::regnamespace;`,
    staticCaught: true,
    catalogCodes: ["payroll-table-missing"]
  },
  {
    id: "m6-row-type-column",
    evasion: "M6: a column of the ledger's row type on an ordinary table",
    sql: `CREATE TABLE awcms_probe_rowcol (r ${PAYROLL});`,
    staticCaught: false,
    catalogCodes: ["dependent-on-payroll"]
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
COMMENT ON TABLE awcms_hr_payroll_probe_log IS 'payroll-boundary: probe';
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
    id: "family-policy-and-key",
    sql: `CREATE TABLE awcms_hr_payroll_probe_lines (
  accrual_id uuid REFERENCES ${PAYROLL} (id),
  r ${PAYROLL}
);
COMMENT ON TABLE awcms_hr_payroll_probe_lines IS 'payroll-boundary: probe';
ALTER TABLE awcms_hr_payroll_probe_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_hr_payroll_probe_policy ON awcms_hr_payroll_probe_lines
  USING (EXISTS (SELECT 1 FROM ${PAYROLL}));`
  },
  {
    id: "ordinary-objects",
    sql: `CREATE TABLE awcms_probe_ok (id int);
CREATE VIEW awcms_probe_ok_v AS SELECT * FROM awcms_probe_ok;
CREATE FUNCTION awcms_probe_ok_fn() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM awcms_probe_ok';`
  }
];
