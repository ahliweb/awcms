/**
 * `security:readiness` pin + behavioural probe for the ABAC policy version
 * counter (sql/432, Issue #1482).
 *
 * The cross-process policy cache is only as correct as the trigger that bumps
 * `awcms_abac_policy_versions`: a disabled, detached, narrowed (one event
 * fewer, a `WHEN` clause) or re-bodied trigger, or a runtime role that can write
 * the version itself, silently brings back the stale ALLOW the issue closed.
 * Every one of those is caught here, structurally (exact catalog shape and
 * exact whitespace-normalised body, never a substring) AND behaviourally (in a
 * transaction that is always rolled back, every write kind must move the
 * version, and the runtime role must be refused a direct write).
 */

/** Same normalisation as `normalizePolicyExpression` in security-readiness. */
function normalizePolicyExpression(expression: string): string {
  return expression.replace(/\s+/g, " ").trim();
}

export const ABAC_POLICY_VERSION_BUMP_ROLE = "awcms_abac_policy_version_bump";
export const ABAC_POLICY_VERSION_TABLE = "awcms_abac_policy_versions";
export const ABAC_POLICY_VERSION_SEQUENCE = "awcms_abac_policy_version_seq";
export const ABAC_POLICY_VERSION_FUNCTION = "awcms_abac_policy_version_bump()";

/** The reviewed body of `awcms_abac_policy_version_bump()` (sql/432), exactly. */
export const ABAC_POLICY_VERSION_BUMP_BODY =
  "DECLARE v_old uuid; v_new uuid; BEGIN IF TG_OP = 'TRUNCATE' THEN INSERT INTO awcms_abac_policy_versions AS v (tenant_id, policy_version) SELECT t.id, nextval('awcms_abac_policy_version_seq') FROM awcms_tenants AS t ON CONFLICT (tenant_id) DO UPDATE SET policy_version = EXCLUDED.policy_version, updated_at = now(); RETURN NULL; END IF; IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := OLD.tenant_id; END IF; IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := NEW.tenant_id; END IF; INSERT INTO awcms_abac_policy_versions AS v (tenant_id, policy_version) SELECT t.id, nextval('awcms_abac_policy_version_seq') FROM awcms_tenants AS t WHERE t.id = v_old OR t.id = v_new ON CONFLICT (tenant_id) DO UPDATE SET policy_version = EXCLUDED.policy_version, updated_at = now(); RETURN NULL; END;";

/**
 * The two triggers on `awcms_abac_policies`, by EXACT `tgtype`
 * (bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE,
 * 64 INSTEAD): AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW = 29, and AFTER
 * TRUNCATE FOR EACH STATEMENT = 32. Exact, so dropping an event, moving to
 * BEFORE or turning the row trigger into a statement trigger is a finding.
 */
export const ABAC_POLICY_VERSION_TRIGGERS: readonly {
  name: string;
  tgtype: number;
}[] = [
  { name: "awcms_abac_policies_version_bump", tgtype: 29 },
  { name: "awcms_abac_policies_version_bump_truncate", tgtype: 32 }
];

/**
 * Structural pin. Returns findings (empty = pass).
 */
export async function pinAbacPolicyVersionBump(db: Bun.SQL): Promise<string[]> {
  const findings: string[] = [];

  const fn = (await db`
    SELECT p.prosecdef AS definer,
           l.lanname AS language,
           p.prorettype = 'trigger'::regtype AS returns_trigger,
           COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
           pg_get_userbyid(p.proowner) AS owner,
           p.prosrc AS body,
           ARRAY(
             SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                         ELSE pg_get_userbyid(a.grantee) END
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.privilege_type = 'EXECUTE'
             ORDER BY 1
           ) AS executors
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure(${ABAC_POLICY_VERSION_FUNCTION})
  `) as {
    definer: boolean;
    language: string;
    returns_trigger: boolean;
    config: string[];
    owner: string;
    body: string;
    executors: string[];
  }[];
  const row = fn[0];

  if (!row) {
    findings.push(`function ${ABAC_POLICY_VERSION_FUNCTION} is missing`);
  } else {
    if (!row.definer)
      findings.push("the bump function is not SECURITY DEFINER");
    if (row.language !== "plpgsql")
      findings.push("the bump function is not plpgsql");
    if (!row.returns_trigger)
      findings.push("the bump function does not return trigger");
    if (
      row.config.length !== 1 ||
      row.config[0] !== "search_path=public, pg_temp"
    ) {
      findings.push(
        `the bump function's search_path is not exactly "public, pg_temp"`
      );
    }
    if (row.owner !== ABAC_POLICY_VERSION_BUMP_ROLE) {
      findings.push(`the bump function is owned by ${row.owner}`);
    }
    if (
      [...new Set(row.executors)].sort().join(",") !==
      ABAC_POLICY_VERSION_BUMP_ROLE
    ) {
      findings.push(
        `EXECUTE on the bump function is held by ${row.executors.join(", ")}`
      );
    }
    if (
      normalizePolicyExpression(row.body) !==
      normalizePolicyExpression(ABAC_POLICY_VERSION_BUMP_BODY)
    ) {
      findings.push("the bump function's body is no longer the reviewed one");
    }
  }

  const triggers = (await db`
    SELECT t.tgname::text AS name, t.tgtype::int AS tgtype,
           t.tgenabled::text AS enabled,
           t.tgfoid = to_regprocedure(${ABAC_POLICY_VERSION_FUNCTION}) AS fn_ok,
           t.tgqual IS NULL AS no_when
    FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('awcms_abac_policies') AND NOT t.tgisinternal
  `) as {
    name: string;
    tgtype: number;
    enabled: string;
    fn_ok: boolean;
    no_when: boolean;
  }[];

  for (const pin of ABAC_POLICY_VERSION_TRIGGERS) {
    const trigger = triggers.find((candidate) => candidate.name === pin.name);

    if (!trigger) {
      findings.push(`awcms_abac_policies trigger ${pin.name} is missing`);
      continue;
    }
    // 'O' fires in origin/local mode, 'A' always; 'D' disabled and 'R'
    // replica-only both leave ordinary writes un-bumped.
    if (!["O", "A"].includes(trigger.enabled)) {
      findings.push(
        `trigger ${pin.name} is not enabled (tgenabled ${trigger.enabled})`
      );
    }
    if (trigger.tgtype !== pin.tgtype) {
      findings.push(
        `trigger ${pin.name} is reshaped (tgtype ${trigger.tgtype}, reviewed ${pin.tgtype})`
      );
    }
    if (!trigger.fn_ok) {
      findings.push(
        `trigger ${pin.name} no longer runs ${ABAC_POLICY_VERSION_FUNCTION}`
      );
    }
    if (!trigger.no_when) {
      findings.push(`trigger ${pin.name} gained a WHEN clause`);
    }
  }

  const privileges = (await db`
    SELECT
      has_table_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'INSERT')
        OR has_table_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'UPDATE')
        OR has_table_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'DELETE')
        OR has_table_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'TRUNCATE')
        OR has_any_column_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'UPDATE')
        OR has_any_column_privilege('awcms_app', ${ABAC_POLICY_VERSION_TABLE}, 'INSERT')
        AS app_writes,
      has_sequence_privilege('awcms_app', ${ABAC_POLICY_VERSION_SEQUENCE}, 'USAGE')
        OR has_sequence_privilege('awcms_app', ${ABAC_POLICY_VERSION_SEQUENCE}, 'UPDATE')
        AS app_sequence,
      has_table_privilege(${ABAC_POLICY_VERSION_BUMP_ROLE}, ${ABAC_POLICY_VERSION_TABLE}, 'DELETE')
        OR has_table_privilege(${ABAC_POLICY_VERSION_BUMP_ROLE}, ${ABAC_POLICY_VERSION_TABLE}, 'TRUNCATE')
        OR has_table_privilege(${ABAC_POLICY_VERSION_BUMP_ROLE}, ${ABAC_POLICY_VERSION_TABLE}, 'UPDATE')
        OR has_column_privilege(${ABAC_POLICY_VERSION_BUMP_ROLE}, ${ABAC_POLICY_VERSION_TABLE}, 'tenant_id', 'UPDATE')
        AS bump_too_wide,
      EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = to_regclass(${ABAC_POLICY_VERSION_SEQUENCE})
          AND d.deptype IN ('a', 'i')
      ) AS sequence_owned
  `) as {
    app_writes: boolean;
    app_sequence: boolean;
    bump_too_wide: boolean;
    sequence_owned: boolean;
  }[];
  const grants = privileges[0]!;

  if (grants.app_writes) {
    findings.push(
      "awcms_app can write awcms_abac_policy_versions (a runtime could re-validate a stale cache)"
    );
  }
  if (grants.app_sequence) {
    findings.push(
      "awcms_app holds a privilege on awcms_abac_policy_version_seq"
    );
  }
  if (grants.bump_too_wide) {
    findings.push(
      `${ABAC_POLICY_VERSION_BUMP_ROLE} holds more than SELECT, INSERT and UPDATE (policy_version, updated_at)`
    );
  }
  if (grants.sequence_owned) {
    findings.push(
      "awcms_abac_policy_version_seq is OWNED BY a column, so TRUNCATE ... RESTART IDENTITY could reissue a version"
    );
  }

  return findings;
}

class ProbeRollback extends Error {}

/**
 * Behavioural half: in ONE transaction that is always rolled back, seed a
 * throwaway tenant, then — as `awcms_app` when the connection can assume it,
 * else as the connection's own role — INSERT, UPDATE and DELETE a policy row
 * and require the tenant's version to move each time; then, as `awcms_app`,
 * require a direct UPDATE of the version row to be refused. Returns a finding
 * or `null`; `ranAsApp` says whether the refusal half could be exercised.
 */
export async function probeAbacPolicyVersionBump(
  db: Bun.SQL
): Promise<{ finding: string | null; ranAsApp: boolean }> {
  let finding: string | null = null;
  let ranAsApp = false;

  try {
    await db.begin(async (tx) => {
      const tenant = crypto.randomUUID();
      const code = `rdy-${tenant.slice(0, 8)}`;
      const can = (await tx`
        SELECT current_user = 'awcms_app'
               OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
               OR pg_has_role(current_user, 'awcms_app', 'SET') AS can
      `) as { can: boolean }[];

      await tx`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${tenant}, ${code}, ${code})
      `;
      await tx`SELECT set_config('app.current_tenant_id', ${tenant}, true)`;

      if (can[0]?.can) {
        await tx`SET LOCAL ROLE awcms_app`;
        ranAsApp = true;
      }

      const version = async (): Promise<string> => {
        const rows = (await tx`
          SELECT policy_version::text AS v FROM awcms_abac_policy_versions
          WHERE tenant_id = ${tenant}
        `) as { v: string }[];

        return rows[0]?.v ?? "0";
      };
      const seen: string[] = [await version()];

      const inserted = (await tx`
        INSERT INTO awcms_abac_policies (tenant_id, policy_code, effect)
        VALUES (${tenant}, 'readiness.probe', 'deny')
        RETURNING id
      `) as { id: string }[];
      seen.push(await version());
      await tx`
        UPDATE awcms_abac_policies SET is_active = false
        WHERE tenant_id = ${tenant} AND id = ${inserted[0]!.id}
      `;
      seen.push(await version());
      await tx`
        DELETE FROM awcms_abac_policies
        WHERE tenant_id = ${tenant} AND id = ${inserted[0]!.id}
      `;
      seen.push(await version());

      if (new Set(seen).size !== seen.length || seen.slice(1).includes("0")) {
        finding = `a policy INSERT/UPDATE/DELETE did not move the tenant's version each time (observed ${seen.join(" -> ")})`;
      }

      if (ranAsApp && finding === null) {
        try {
          await tx.savepoint(
            (sp) => sp`
              UPDATE awcms_abac_policy_versions SET policy_version = 1
              WHERE tenant_id = ${tenant}
            `
          );
          finding =
            "awcms_app could UPDATE awcms_abac_policy_versions directly";
        } catch (error) {
          if (String((error as { errno?: unknown }).errno) !== "42501") {
            throw error;
          }
        }
      }

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      finding = `the policy version probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { finding, ranAsApp };
}
