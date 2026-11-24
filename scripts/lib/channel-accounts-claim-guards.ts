/**
 * The readiness pins and the behavioural probe of the external-account CLAIM
 * (Issue #1215, ADR-0170, `sql/416`), used by `scripts/security-readiness.ts`.
 *
 * What they protect: an external id is claimed by exactly ONE tenant, where the
 * claim is held from registration for a provider nothing can verify and only
 * from verification for one a connector proves; the platform release action's
 * cross-tenant READ (the locator) stays one narrow, read-only SECURITY DEFINER
 * function. The pins say the schema is the reviewed one; the probe says it DOES
 * what the review assumed. A widening (the global index back to "every live
 * row", or any status; a writable basis; a locator that gained a column, a
 * privilege or a caller) is a finding.
 *
 * The behavioural probe is its own function, like the other probes, because it
 * is readiness code that opens a transaction (always rolled back).
 */

/** The NOLOGIN owner of the locator. */
export const CLAIM_LOCATOR_ROLE = "awcms_channel_claim_locator";

/** The ONLY columns of `awcms_channel_accounts` the locator may SELECT. */
export const CLAIM_LOCATOR_COLUMNS: readonly string[] = [
  "account_kind",
  "claim_basis",
  "deleted_at",
  "external_id",
  "id",
  "provider",
  "status",
  "tenant_id"
];

function normalise(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** `pg_get_indexdef`, normalised: the reviewed shape of the two unique indexes. */
const CLAIM_INDEXES: readonly { name: string; def: string }[] = [
  {
    name: "awcms_channel_accounts_live_external_key",
    def: normalise(
      "CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key ON public.awcms_channel_accounts USING btree (provider, account_kind, external_id) WHERE ((deleted_at IS NULL) AND ((claim_basis = 'registration'::text) OR (status = ANY (ARRAY['connected'::text, 'degraded'::text]))))"
    )
  },
  {
    name: "awcms_channel_accounts_tenant_external_key",
    def: normalise(
      "CREATE UNIQUE INDEX awcms_channel_accounts_tenant_external_key ON public.awcms_channel_accounts USING btree (tenant_id, provider, account_kind, external_id) WHERE (deleted_at IS NULL)"
    )
  }
];

const CLAIM_BASIS_CHECK = normalise(
  "CHECK ((claim_basis = ANY (ARRAY['registration'::text, 'verification'::text])))"
);

const LOCATOR_BODY = normalise(`
  SELECT a.tenant_id, a.id, a.account_kind, a.status, a.claim_basis
  FROM awcms_channel_accounts AS a
  WHERE a.provider = p_provider
    AND a.account_kind = p_account_kind
    AND a.external_id = p_external_id
    AND a.deleted_at IS NULL
    AND (a.claim_basis = 'registration' OR a.status IN ('connected', 'degraded'))
  LIMIT 1;
`);

/**
 * The exact pins: the `claim_basis` column and its CHECK, the two unique
 * indexes, and the locator (role flags, the columns it can read and nothing
 * else, no table-level privilege anywhere, the function's owner, definer flag,
 * `search_path`, body and who may EXECUTE it). The immutability trigger is
 * pinned with the other channel-account triggers
 * (`CHANNEL_ACCOUNTS_ACCESS_GUARDS`).
 */
export async function pinChannelAccountsClaimGuards(
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
                AND c.conname = 'awcms_channel_accounts_claim_basis_check'
                AND c.convalidated) AS check_def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('awcms_channel_accounts')
      AND a.attname = 'claim_basis' AND NOT a.attisdropped
  `) as {
    not_null: boolean;
    type: string;
    default_expr: string | null;
    check_def: string | null;
  }[];
  const col = column[0];

  if (!col) {
    findings.push("awcms_channel_accounts.claim_basis is missing");
  } else {
    if (!col.not_null || col.type !== "text") {
      findings.push("awcms_channel_accounts.claim_basis is not text NOT NULL");
    }
    if (col.default_expr !== "'registration'::text") {
      findings.push(
        `awcms_channel_accounts.claim_basis defaults to ${col.default_expr ?? "nothing"}, not the fail-closed 'registration' (a row inserted without a basis would hold no claim)`
      );
    }
    if (!col.check_def || normalise(col.check_def) !== CLAIM_BASIS_CHECK) {
      findings.push(
        "awcms_channel_accounts_claim_basis_check is missing or no longer admits exactly registration and verification"
      );
    }
  }

  for (const pin of CLAIM_INDEXES) {
    const rows = (await sql`
      SELECT pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS uniq,
             i.indisvalid AS valid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('awcms_channel_accounts')
        AND c.relname = ${pin.name}
    `) as { def: string; uniq: boolean; valid: boolean }[];
    const row = rows[0];

    if (!row) {
      findings.push(`index ${pin.name} is missing`);
    } else if (!row.uniq || !row.valid || normalise(row.def) !== pin.def) {
      findings.push(
        `index ${pin.name} differs from its reviewed definition (an external id could be claimed by two tenants, or held by a row that proved nothing)`
      );
    }
  }

  const role = (await sql`
    SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
           (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
    FROM pg_roles r WHERE rolname = ${CLAIM_LOCATOR_ROLE}
  `) as {
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    members: number;
  }[];

  if (!role[0]) {
    findings.push(`role ${CLAIM_LOCATOR_ROLE} is missing`);
  } else if (
    role[0].rolcanlogin ||
    role[0].rolsuper ||
    role[0].rolbypassrls ||
    role[0].rolcreatedb ||
    role[0].rolcreaterole ||
    role[0].members > 0
  ) {
    findings.push(
      `role ${CLAIM_LOCATOR_ROLE} can log in, is privileged or has members: the locator's narrow EXECUTE would be bypassed by simply connecting as its owner`
    );
  } else {
    // Exactly the reviewed columns of the one table, SELECT only; no
    // table-level privilege on any table; nothing on any other table at all.
    const columns = (await sql`
      SELECT a.attname,
             has_column_privilege(${CLAIM_LOCATOR_ROLE}, a.attrelid, a.attnum, 'SELECT') AS sel,
             has_column_privilege(${CLAIM_LOCATOR_ROLE}, a.attrelid, a.attnum, 'INSERT') AS ins,
             has_column_privilege(${CLAIM_LOCATOR_ROLE}, a.attrelid, a.attnum, 'UPDATE') AS upd,
             has_column_privilege(${CLAIM_LOCATOR_ROLE}, a.attrelid, a.attnum, 'REFERENCES') AS refs
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('awcms_channel_accounts')
        AND a.attnum > 0 AND NOT a.attisdropped
    `) as {
      attname: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      refs: boolean;
    }[];
    const readable = columns
      .filter((c) => c.sel)
      .map((c) => c.attname)
      .sort();

    if (readable.join() !== [...CLAIM_LOCATOR_COLUMNS].sort().join()) {
      findings.push(
        `${CLAIM_LOCATOR_ROLE} can SELECT [${readable.join(", ")}] of awcms_channel_accounts, not exactly the reviewed columns`
      );
    }
    if (columns.some((c) => c.ins || c.upd || c.refs)) {
      findings.push(
        `${CLAIM_LOCATOR_ROLE} holds a write or REFERENCES privilege on awcms_channel_accounts`
      );
    }

    const others = (await sql`
      SELECT c.relname,
             has_table_privilege(${CLAIM_LOCATOR_ROLE}, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_level,
             has_any_column_privilege(${CLAIM_LOCATOR_ROLE}, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') AS any_column
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
        AND c.relname LIKE 'awcms\\_%'
    `) as { relname: string; table_level: boolean; any_column: boolean }[];
    const stray = others
      .filter(
        (row) =>
          row.table_level ||
          (row.any_column && row.relname !== "awcms_channel_accounts")
      )
      .map((row) => row.relname);

    if (stray.length > 0) {
      findings.push(
        `${CLAIM_LOCATOR_ROLE} holds a privilege on [${stray.join(", ")}] beyond its column SELECT of awcms_channel_accounts`
      );
    }
  }

  const fn = (await sql`
    SELECT p.prosecdef AS definer, p.provolatile::text AS volatility,
           l.lanname AS language, p.proretset AS returns_set,
           p.proowner::regrole::text AS owner, p.proconfig AS config,
           p.prosrc AS body,
           ARRAY(
             SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC'
                         ELSE x.grantee::regrole::text END
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
             WHERE x.privilege_type = 'EXECUTE'
             ORDER BY 1) AS executors
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure('awcms_find_channel_account_claim_holder(text,text,text)')
  `) as {
    definer: boolean;
    volatility: string;
    language: string;
    returns_set: boolean;
    owner: string;
    config: string[] | null;
    body: string;
    executors: string[];
  }[];
  const fnRow = fn[0];

  if (!fnRow) {
    findings.push(
      "awcms_find_channel_account_claim_holder(text, text, text) is missing"
    );
  } else {
    const differences: string[] = [];

    if (!fnRow.definer) differences.push("not SECURITY DEFINER");
    if (fnRow.owner !== CLAIM_LOCATOR_ROLE) differences.push("another owner");
    if (fnRow.language !== "sql" || fnRow.volatility !== "s") {
      differences.push("not a STABLE sql function");
    }
    if (!fnRow.returns_set)
      differences.push("no longer a set-returning lookup");
    if (
      !fnRow.config ||
      fnRow.config.length !== 1 ||
      fnRow.config[0] !== "search_path=public, pg_temp"
    ) {
      differences.push(`search_path is not exactly "public, pg_temp"`);
    }
    if (normalise(fnRow.body) !== LOCATOR_BODY) {
      differences.push("its body is no longer the reviewed one");
    }
    if (
      [...fnRow.executors].sort().join() !==
      [CLAIM_LOCATOR_ROLE, "awcms_app"].sort().join()
    ) {
      differences.push(
        `EXECUTE is held by [${fnRow.executors.join(", ")}], not exactly its owner and awcms_app`
      );
    }

    if (differences.length > 0) {
      findings.push(
        `awcms_find_channel_account_claim_holder differs from its reviewed definition (${differences.join("; ")}): a cross-tenant read could widen`
      );
    }
  }

  return findings;
}

class ProbeRollback extends Error {}

type DbError = { errno?: string; code?: string };

/**
 * The behavioural half: in ONE transaction that is always rolled back, seed two
 * throwaway tenants and require what the pins only promise.
 *
 *  - a verification-basis row holds nothing while `pending` (two tenants can
 *    both register the id), and the first to become `connected` wins (the second
 *    is refused 23505), while a registration-basis row holds the id from the
 *    start, in any status, until it is soft-deleted;
 *  - one tenant cannot hold the same id twice;
 *  - the basis cannot be rewritten (23514);
 *  - the locator answers the holder of a held claim, and nothing for a claim
 *    that is merely pending, for another provider and for a deleted row.
 *
 * The positive controls (the pending pair, the soft-deleted release) make an
 * index that refuses EVERYTHING fail too.
 */
export async function probeChannelAccountsClaimGuards(
  sql: Bun.SQL
): Promise<string[] | null> {
  const can = (await sql`
    SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
           OR has_table_privilege(current_user, 'awcms_tenants', 'INSERT') AS can
  `) as { can: boolean }[];

  if (!can[0]?.can) return null;

  const findings: string[] = [];

  try {
    await sql.begin(async (tx) => {
      const seed = crypto.randomUUID().slice(0, 8);
      const tenantA = crypto.randomUUID();
      const tenantB = crypto.randomUUID();

      for (const [id, label] of [
        [tenantA, "a"],
        [tenantB, "b"]
      ] as const) {
        await tx`SELECT set_config('app.current_tenant_id', ${id}, true)`;
        await tx`
          INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
          VALUES (${id}, ${`clm-${label}-${seed}`}, ${`clm-${label}-${seed}`})
        `;
      }

      const insert = async (
        tenant: string,
        provider: string,
        kind: string,
        authMode: string,
        externalId: string,
        basis: string
      ): Promise<string> => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenant}, true)`;

        return (
          (await tx`
            INSERT INTO awcms_channel_accounts
              (tenant_id, provider, account_kind, external_id, display_name,
               auth_mode, claim_basis)
            VALUES (${tenant}, ${provider}, ${kind}, ${externalId}, 'probe',
                    ${authMode}, ${basis})
            RETURNING id
          `) as { id: string }[]
        )[0]!.id;
      };
      const refuses = async (
        label: string,
        sqlState: string,
        statement: () => Promise<unknown>
      ) => {
        try {
          await tx.savepoint(async () => {
            await statement();
          });
          findings.push(`${label}: the database accepted it`);
        } catch (error) {
          const state = (error as DbError).errno ?? (error as DbError).code;

          if (state !== sqlState) {
            findings.push(
              `${label}: refused for another reason (${String(state)}, expected ${sqlState})`
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
      const connect = async (tenant: string, accountId: string) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenant}, true)`;

        const moved = (await tx`
          UPDATE awcms_channel_accounts
          SET status = 'connected', connected_at = now()
          WHERE tenant_id = ${tenant} AND id = ${accountId}
          RETURNING id
        `) as { id: string }[];

        // A statement that touched no row proves nothing about the index.
        if (moved.length !== 1) {
          throw new Error(
            "probe fixture: the account to connect is not visible"
          );
        }
      };
      const holder = async (
        provider: string,
        kind: string,
        externalId: string
      ) =>
        (await tx`
          SELECT tenant_id, account_id
          FROM awcms_find_channel_account_claim_holder(${provider}, ${kind}, ${externalId})
        `) as { tenant_id: string; account_id: string }[];
      const bot = `9${seed.replace(/\D/g, "").padEnd(6, "1")}`;
      const sender = `probe-${seed}@claim.invalid`;

      // Verification basis: pending holds nothing, the first to connect wins.
      const botA = await insert(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        bot,
        "verification"
      );
      let botB = "";

      await allows(
        "a second tenant registering a verification-basis id that is only pending",
        async () => {
          botB = await insert(
            tenantB,
            "telegram",
            "bot",
            "bot_token",
            bot,
            "verification"
          );
        }
      );

      if ((await holder("telegram", "bot", bot)).length !== 0) {
        findings.push(
          "a pending verification-basis row is reported as holding a claim"
        );
      }

      await allows("the first verification-basis row becoming connected", () =>
        connect(tenantA, botA)
      );
      await refuses(
        "a second tenant's verification-basis row becoming connected for the same id",
        "23505",
        () => connect(tenantB, botB)
      );

      const held = await holder("telegram", "bot", bot);

      if (
        held.length !== 1 ||
        held[0]!.tenant_id !== tenantA ||
        held[0]!.account_id !== botA
      ) {
        findings.push(
          "the locator does not answer the tenant that verified the id"
        );
      }

      // One tenant cannot hold the same id twice, whatever the basis.
      await refuses(
        "the same tenant registering the same live id twice",
        "23505",
        () =>
          insert(tenantA, "telegram", "bot", "bot_token", bot, "verification")
      );

      // Registration basis: held from registration, in any status.
      const device = await insert(
        tenantA,
        "starsender",
        "device",
        "device_key",
        sender,
        "registration"
      );

      await refuses(
        "a second tenant registering an id a registration-basis row holds",
        "23505",
        () =>
          insert(
            tenantB,
            "starsender",
            "device",
            "device_key",
            sender,
            "registration"
          )
      );

      if (
        (await holder("starsender", "device", sender))[0]?.account_id !== device
      ) {
        findings.push(
          "the locator does not answer the holder of a registration-basis claim"
        );
      }
      if ((await holder("facebook", "device", sender)).length !== 0) {
        findings.push("the locator answered for another provider");
      }
      if (
        (await holder("starsender", "device", sender.toUpperCase())).length !==
        0
      ) {
        findings.push(
          "the locator matched a different external id (it must be an exact equality)"
        );
      }

      // The KIND is part of the claim key (audit H1): a registration-basis row
      // of ANOTHER kind with the same external id neither blocks a verification
      // of the bot nor is blocked by it, and the locator does not cross kinds.
      const crossId = `8${bot}`;
      const channel = await insert(
        tenantB,
        "telegram",
        "channel",
        "bot_token",
        crossId,
        "registration"
      );
      const crossBot = await insert(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        crossId,
        "verification"
      );

      await allows(
        "verifying a bot whose id another tenant used for a registration-basis channel",
        () => connect(tenantA, crossBot)
      );
      await allows(
        "registering a channel with the id of a bot another tenant already verified",
        () =>
          insert(
            tenantB,
            "telegram",
            "channel",
            "bot_token",
            bot,
            "registration"
          )
      );

      if (
        (await holder("telegram", "bot", crossId))[0]?.account_id !== crossBot
      ) {
        findings.push("the locator did not answer the bot for a bot id");
      }
      if (
        (await holder("telegram", "channel", crossId))[0]?.account_id !==
        channel
      ) {
        findings.push(
          "the locator did not answer the channel for a channel id"
        );
      }
      if ((await holder("mailketing", "esp_account", crossId)).length !== 0) {
        findings.push("the locator crossed account kinds");
      }

      // The basis is immutable.
      await tx`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
      await refuses(
        "rewriting an account's claim basis",
        "23514",
        () => tx`UPDATE awcms_channel_accounts SET claim_basis = 'verification'
                 WHERE tenant_id = ${tenantA} AND id = ${device}`
      );

      // A soft-deleted row releases the claim (positive control).
      await tx`
        UPDATE awcms_channel_accounts
        SET status = 'deleted', deleted_at = now()
        WHERE tenant_id = ${tenantA} AND id = ${device}
      `;
      await allows(
        "a second tenant registering an id whose holder was soft-deleted",
        () =>
          insert(
            tenantB,
            "starsender",
            "device",
            "device_key",
            sender,
            "registration"
          )
      );

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      findings.push(
        `the claim behavioural probe could not run: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return findings;
}
