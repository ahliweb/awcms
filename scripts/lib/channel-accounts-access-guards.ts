/**
 * The readiness pins and the behavioural probe of the channel-account access
 * guards (Issue #1215 M-c, `sql/398` and `sql/399`), used by
 * `scripts/security-readiness.ts`.
 *
 * What they protect: an account is `assigned` unless an administrator chose
 * otherwise, an assigned account is never left ownerless by a demotion, an
 * erasure that does orphan one leaves an audit row, and an account's business
 * scope and identity cannot be rewritten. The pins say the guards are the
 * reviewed ones; the probe says they DO what the review assumed, whatever the
 * text. Its own file, like the other probes, because it is readiness code that
 * opens a transaction (always rolled back).
 *
 * The pinned bodies below are the bodies of the migrations, verbatim.
 */

const AWCMS_CHANNEL_ACCOUNTS_IDENTITY_GUARD_BODY = `
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.account_kind IS DISTINCT FROM OLD.account_kind
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel account identity (tenant, provider, kind, external id) is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
     OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
    RAISE EXCEPTION 'a channel account business scope is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted channel account is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
`;

const AWCMS_CHANNEL_ACCOUNTS_ACCESS_MODE_GUARD_BODY = `
BEGIN
  IF NEW.access_mode = 'assigned'
     AND OLD.access_mode IS DISTINCT FROM 'assigned' THEN
    -- The owner rows are SHARE-locked, not merely read: a concurrent DELETE of
    -- the only owner (a data-subject erasure takes no account lock) then waits
    -- for this transaction, and its orphan-audit trigger sees the account as
    -- 'assigned' and writes the trace. A plain read let both succeed unseen.
    PERFORM 1
    FROM awcms_channel_account_assignments AS a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.account_id = NEW.id
      AND a.kind = 'owner'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'an account can only become assigned when it has an owner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
`;

const AWCMS_CHANNEL_ACCOUNT_ASSIGNMENTS_GUARD_BODY = `
DECLARE
  v_mode text;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel account assignment tenant, account, person and id are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.kind = 'owner' AND NEW.kind <> 'owner' THEN
    SELECT access_mode INTO v_mode
    FROM awcms_channel_accounts
    WHERE tenant_id = OLD.tenant_id AND id = OLD.account_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_mode = 'assigned' THEN
      -- SHARE-locked, so a concurrent erasure of "the other owner" waits for
      -- this transaction instead of both seeing the other remain.
      PERFORM 1
      FROM awcms_channel_account_assignments AS a
      WHERE a.tenant_id = OLD.tenant_id
        AND a.account_id = OLD.account_id
        AND a.kind = 'owner'
        AND a.id <> OLD.id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'the last owner of an assigned channel account cannot be demoted'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
`;

const AWCMS_CHANNEL_ACCOUNT_ASSIGNMENTS_ORPHAN_AUDIT_BODY = `
BEGIN
  IF OLD.kind = 'owner'
     AND EXISTS (
       SELECT 1 FROM awcms_channel_accounts AS acc
       WHERE acc.tenant_id = OLD.tenant_id
         AND acc.id = OLD.account_id
         AND acc.deleted_at IS NULL
         AND acc.access_mode = 'assigned'
     )
     AND NOT EXISTS (
       SELECT 1 FROM awcms_channel_account_assignments AS a
       WHERE a.tenant_id = OLD.tenant_id
         AND a.account_id = OLD.account_id
         AND a.kind = 'owner'
     ) THEN
    INSERT INTO awcms_audit_events
      (tenant_id, module_key, action, resource_type, resource_id, severity,
       message, attributes)
    VALUES
      (OLD.tenant_id, 'channel_accounts',
       'channel_accounts.account.owner_orphaned', 'channel_account',
       OLD.account_id::text, 'warning',
       'An assigned channel account lost its last owner; only its remaining assignees and the tenant administrators can reach it.',
       jsonb_build_object('accountId', OLD.account_id));
  END IF;

  RETURN NULL;
END;
`;

/** Whitespace- and case-insensitive: the shape of `normalizePolicyExpression`, local so this file does not import the readiness script back. */
function normalise(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

type PinnedGuard = {
  table: string;
  trigger: string;
  fn: string;
  /** `pg_trigger.tgtype` exactly: 1 ROW, 2 BEFORE, 8 DELETE, 16 UPDATE (AFTER has no bit). */
  tgtype: number;
  /** Set when the trigger fires only on an UPDATE of this column (`UPDATE OF`). */
  updateOf: string | null;
  body: string;
};

export const CHANNEL_ACCOUNTS_ACCESS_GUARDS: readonly PinnedGuard[] = [
  {
    table: "awcms_channel_accounts",
    trigger: "awcms_channel_accounts_identity_guard",
    fn: "awcms_channel_accounts_identity_guard",
    tgtype: 1 | 2 | 16,
    updateOf: null,
    body: AWCMS_CHANNEL_ACCOUNTS_IDENTITY_GUARD_BODY
  },
  {
    table: "awcms_channel_accounts",
    trigger: "awcms_channel_accounts_access_mode_guard",
    fn: "awcms_channel_accounts_access_mode_guard",
    tgtype: 1 | 2 | 16,
    updateOf: "access_mode",
    body: AWCMS_CHANNEL_ACCOUNTS_ACCESS_MODE_GUARD_BODY
  },
  {
    table: "awcms_channel_account_assignments",
    trigger: "awcms_channel_account_assignments_guard",
    fn: "awcms_channel_account_assignments_guard",
    tgtype: 1 | 2 | 16,
    updateOf: null,
    body: AWCMS_CHANNEL_ACCOUNT_ASSIGNMENTS_GUARD_BODY
  },
  {
    table: "awcms_channel_account_assignments",
    trigger: "awcms_channel_account_assignments_orphan_audit",
    fn: "awcms_channel_account_assignments_orphan_audit",
    tgtype: 1 | 8,
    updateOf: null,
    body: AWCMS_CHANNEL_ACCOUNT_ASSIGNMENTS_ORPHAN_AUDIT_BODY
  }
];

/** The `CHECK` that keeps `access_mode` to the two reviewed values, as `pg_get_constraintdef` prints it, normalised. */
const ACCESS_MODE_CHECK = normalise(
  "CHECK ((access_mode = ANY (ARRAY['assigned'::text, 'tenant_wide'::text])))"
);

/**
 * The exact pins (#1215 M-c, sql/398 and sql/399): the column is `text NOT NULL`
 * defaulting to the CLOSED mode, the `CHECK` admits exactly the two modes, and
 * each guard trigger exists, is enabled for ordinary sessions, fires on the
 * reviewed events, is `SECURITY INVOKER` with a pinned `search_path`, and runs
 * the reviewed body. A widening (a default of `tenant_wide`, a dropped or
 * disabled guard, a body that no longer refuses) is a finding. Substring tests
 * (`LIKE '%last owner%'`) are deliberately not used: a hollowed-out function
 * that still names its message would pass them.
 */
export async function pinChannelAccountsAccessGuards(
  sql: Bun.SQL
): Promise<string[]> {
  const findings: string[] = [];
  const column = (await sql`
    SELECT a.attnotnull AS not_null,
           format_type(a.atttypid, a.atttypmod) AS type,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr,
           (SELECT pg_get_constraintdef(c.oid)
              FROM pg_constraint c
              WHERE c.conrelid = a.attrelid
                AND c.conname = 'awcms_channel_accounts_access_mode_check'
                AND c.convalidated) AS check_def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('awcms_channel_accounts')
      AND a.attname = 'access_mode' AND NOT a.attisdropped
  `) as {
    not_null: boolean;
    type: string;
    default_expr: string | null;
    check_def: string | null;
  }[];
  const col = column[0];

  if (!col) {
    findings.push("awcms_channel_accounts.access_mode is missing");
  } else {
    if (!col.not_null || col.type !== "text") {
      findings.push("awcms_channel_accounts.access_mode is not text NOT NULL");
    }
    if (col.default_expr !== "'assigned'::text") {
      findings.push(
        `awcms_channel_accounts.access_mode defaults to ${col.default_expr ?? "nothing"}, not the closed mode 'assigned' (a new account would open to the tenant)`
      );
    }
    if (!col.check_def || normalise(col.check_def) !== ACCESS_MODE_CHECK) {
      findings.push(
        "awcms_channel_accounts_access_mode_check is missing or no longer admits exactly assigned and tenant_wide"
      );
    }
  }

  for (const pin of CHANNEL_ACCOUNTS_ACCESS_GUARDS) {
    const rows = (await sql`
      SELECT t.tgenabled AS enabled,
             t.tgtype AS tgtype,
             t.tgfoid = to_regproc(${pin.fn}) AS fn_ok,
             ARRAY(
               SELECT att.attname FROM unnest(t.tgattr) AS k(attnum)
               JOIN pg_attribute att
                 ON att.attrelid = t.tgrelid AND att.attnum = k.attnum
               ORDER BY att.attname) AS update_of,
             p.prosecdef AS definer,
             p.proconfig AS config,
             p.prosrc AS body
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = to_regclass(${pin.table})
        AND t.tgname = ${pin.trigger} AND NOT t.tgisinternal
    `) as {
      enabled: string;
      tgtype: number;
      fn_ok: boolean;
      update_of: string[];
      definer: boolean;
      config: string[] | null;
      body: string;
    }[];
    const row = rows[0];
    const label = `${pin.table} trigger ${pin.trigger}`;

    if (!row) {
      findings.push(`${label} is missing`);
      continue;
    }

    const differences: string[] = [];

    // 'O' fires in origin and local sessions, 'A' always; 'D' and 'R' do not
    // fire for an ordinary session.
    if (row.enabled !== "O" && row.enabled !== "A") {
      differences.push("not enabled for ordinary sessions");
    }
    if (row.tgtype !== pin.tgtype) differences.push("fires on other events");
    if (!row.fn_ok) differences.push("runs another function");
    if (
      (pin.updateOf === null ? [] : [pin.updateOf]).join() !==
      row.update_of.join()
    ) {
      differences.push("its UPDATE OF column list changed");
    }
    if (row.definer) differences.push("SECURITY DEFINER");
    if (
      !row.config ||
      row.config.length !== 1 ||
      row.config[0] !== "search_path=public, pg_temp"
    ) {
      differences.push(`search_path is not exactly "public, pg_temp"`);
    }
    if (normalise(row.body) !== normalise(pin.body)) {
      differences.push("its body is no longer the reviewed one");
    }

    if (differences.length > 0) {
      findings.push(
        `${label} differs from its reviewed definition (${differences.join("; ")}): an account could be opened, left ownerless or re-scoped`
      );
    }
  }

  return findings;
}

class ProbeRollback extends Error {}

type DbError = { errno?: string; code?: string };

/**
 * The behavioural half (#1215 M-c): in ONE transaction that is always rolled
 * back, seed a throwaway tenant, two people and an account, and require what
 * the pins only promise: a new account is `assigned`; the last owner cannot be
 * demoted but any other owner or assignee can; an unowned switch to `assigned`
 * is refused and an owned one is not; the scope, identity and an assignment's
 * account/person cannot be rewritten; and deleting the last owner of an assigned
 * account (what an erasure does) succeeds and leaves exactly ONE audit row,
 * while deleting a non-last owner or a tenant-wide account's owner leaves none.
 * The positive controls make a guard that refuses EVERYTHING fail too.
 */
export async function probeChannelAccountsAccessGuards(
  sql: Bun.SQL
): Promise<string[] | null> {
  // The probe seeds a throwaway tenant, so it needs a connection that may. The
  // runtime role (`awcms_app`) is not meant to create tenants: it skips, and
  // the exact pins stand alone, exactly as the other rolled-back probes do.
  const can = (await sql`
    SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
           OR (
             has_table_privilege(current_user, 'awcms_tenants', 'INSERT')
             AND has_table_privilege(current_user, 'awcms_profiles', 'INSERT')
             AND has_table_privilege(current_user, 'awcms_identities', 'INSERT')
             AND has_table_privilege(current_user, 'awcms_tenant_users', 'INSERT')
           ) AS can
  `) as { can: boolean }[];

  if (!can[0]?.can) return null;

  const findings: string[] = [];

  try {
    await sql.begin(async (tx) => {
      const tenant = crypto.randomUUID();
      const code = `caa-${tenant.slice(0, 8)}`;

      await tx`SELECT set_config('app.current_tenant_id', ${tenant}, true)`;
      await tx`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${tenant}, ${code}, ${code})
      `;

      const person = async (label: string): Promise<string> => {
        const profile = (await tx`
          INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
          VALUES (${tenant}, 'person', ${`probe ${label}`})
          RETURNING id
        `) as { id: string }[];
        const identity = (await tx`
          INSERT INTO awcms_identities
            (tenant_id, profile_id, login_identifier, password_hash)
          VALUES (${tenant}, ${profile[0]!.id}, ${`${code}-${label}@probe.invalid`}, 'x')
          RETURNING id
        `) as { id: string }[];

        return (
          (await tx`
            INSERT INTO awcms_tenant_users (tenant_id, identity_id)
            VALUES (${tenant}, ${identity[0]!.id})
            RETURNING id
          `) as { id: string }[]
        )[0]!.id;
      };
      const newAccount = async (label: string) =>
        (
          (await tx`
            INSERT INTO awcms_channel_accounts
              (tenant_id, provider, account_kind, external_id, display_name,
               auth_mode)
            VALUES (${tenant}, 'telegram', 'bot', ${`probe-${label}-${crypto.randomUUID()}`},
                    'probe', 'bot_token')
            RETURNING id, access_mode
          `) as { id: string; access_mode: string }[]
        )[0]!;
      const assign = (accountId: string, userId: string, kind: string) =>
        tx`
          INSERT INTO awcms_channel_account_assignments
            (tenant_id, account_id, tenant_user_id, kind)
          VALUES (${tenant}, ${accountId}, ${userId}, ${kind})
        `;
      /** SQLSTATE 23514 expected: anything else (or success) is a finding. */
      const refuses = async (
        label: string,
        statement: () => Promise<unknown>
      ) => {
        try {
          await tx.savepoint(async () => {
            await statement();
          });
          findings.push(`${label}: the database accepted it`);
        } catch (error) {
          const state = (error as DbError).errno ?? (error as DbError).code;

          if (state !== "23514") {
            findings.push(
              `${label}: refused for another reason (${String(state)})`
            );
          }
        }
      };
      const allows = async (
        label: string,
        statement: () => Promise<unknown>
      ) => {
        try {
          await tx.savepoint(async () => {
            await statement();
          });
        } catch {
          findings.push(`${label}: the database refused a legitimate change`);
        }
      };
      const orphanRows = async (accountId: string) =>
        (
          (await tx`
            SELECT count(*)::int AS n FROM awcms_audit_events
            WHERE tenant_id = ${tenant}
              AND action = 'channel_accounts.account.owner_orphaned'
              AND resource_id = ${accountId}::text
          `) as { n: number }[]
        )[0]!.n;

      const alice = await person("a");
      const bob = await person("b");
      const account = await newAccount("main");

      if (account.access_mode !== "assigned") {
        findings.push(
          `a new account is ${account.access_mode}, not assigned: the default is open`
        );
      }

      await assign(account.id, alice, "owner");

      await refuses(
        "demoting the last owner",
        () =>
          tx`UPDATE awcms_channel_account_assignments SET kind = 'viewer'
           WHERE tenant_id = ${tenant} AND account_id = ${account.id}`
      );
      await refuses(
        "re-pointing an assignment at another person",
        () =>
          tx`UPDATE awcms_channel_account_assignments SET tenant_user_id = ${bob}
           WHERE tenant_id = ${tenant} AND account_id = ${account.id}`
      );

      await assign(account.id, bob, "owner");
      await allows(
        "demoting one of two owners",
        () =>
          tx`UPDATE awcms_channel_account_assignments SET kind = 'operator'
           WHERE tenant_id = ${tenant} AND account_id = ${account.id}
             AND tenant_user_id = ${alice}`
      );
      await refuses(
        "demoting the owner that became the last",
        () =>
          tx`UPDATE awcms_channel_account_assignments SET kind = 'viewer'
           WHERE tenant_id = ${tenant} AND account_id = ${account.id}
             AND tenant_user_id = ${bob}`
      );

      // Two owners again: deleting one of them leaves no trace.
      await tx`
        UPDATE awcms_channel_account_assignments SET kind = 'owner'
        WHERE tenant_id = ${tenant} AND account_id = ${account.id}
          AND tenant_user_id = ${alice}
      `;
      await tx`
        DELETE FROM awcms_channel_account_assignments
        WHERE tenant_id = ${tenant} AND account_id = ${account.id}
          AND tenant_user_id = ${alice}
      `;

      if ((await orphanRows(account.id)) !== 0) {
        findings.push("deleting a non-last owner wrote an owner_orphaned row");
      }

      // The last owner goes: succeeds, exactly one audit row, no person in it.
      await tx`
        DELETE FROM awcms_channel_account_assignments
        WHERE tenant_id = ${tenant} AND account_id = ${account.id}
      `;

      if ((await orphanRows(account.id)) !== 1) {
        findings.push(
          "deleting the last owner of an assigned account did not leave exactly one owner_orphaned audit row"
        );
      }

      // Switching to assigned without an owner is refused; with one, allowed.
      await tx`UPDATE awcms_channel_accounts SET access_mode = 'tenant_wide'
               WHERE tenant_id = ${tenant} AND id = ${account.id}`;
      await refuses(
        "switching an ownerless account to assigned",
        () =>
          tx`UPDATE awcms_channel_accounts SET access_mode = 'assigned'
           WHERE tenant_id = ${tenant} AND id = ${account.id}`
      );
      await refuses(
        "an access mode outside the two reviewed values",
        () =>
          tx`UPDATE awcms_channel_accounts SET access_mode = 'open'
           WHERE tenant_id = ${tenant} AND id = ${account.id}`
      );
      await assign(account.id, alice, "owner");
      await allows(
        "switching an owned account to assigned",
        () =>
          tx`UPDATE awcms_channel_accounts SET access_mode = 'assigned'
           WHERE tenant_id = ${tenant} AND id = ${account.id}`
      );

      // tenant_wide has no owner rule and no audit.
      const wide = await newAccount("wide");

      await assign(wide.id, alice, "owner");
      await tx`UPDATE awcms_channel_accounts SET access_mode = 'tenant_wide'
               WHERE tenant_id = ${tenant} AND id = ${wide.id}`;
      await tx`
        DELETE FROM awcms_channel_account_assignments
        WHERE tenant_id = ${tenant} AND account_id = ${wide.id}
      `;

      if ((await orphanRows(wide.id)) !== 0) {
        findings.push(
          "a tenant_wide account's owner delete wrote an audit row"
        );
      }

      await refuses(
        "rewriting an account's business scope",
        () =>
          tx`UPDATE awcms_channel_accounts
           SET business_scope_type = 'office',
               business_scope_id = ${crypto.randomUUID()}
           WHERE tenant_id = ${tenant} AND id = ${account.id}`
      );
      await refuses(
        "rewriting an account's provider identity",
        () =>
          tx`UPDATE awcms_channel_accounts SET external_id = 'rewritten'
           WHERE tenant_id = ${tenant} AND id = ${account.id}`
      );

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      findings.push(
        `the behavioural probe could not run: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return findings;
}
