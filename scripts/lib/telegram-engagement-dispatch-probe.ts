/**
 * The behavioural probe of the customer Telegram dispatcher's role (Issue #1156,
 * audits H-2, M-A and M-B of PR #1260), used by `scripts/security-readiness.ts`.
 * It runs inside ONE transaction that is always rolled back: it seeds two
 * throwaway tenants with canaries, assumes `awcms_telegram_engagement_dispatch`
 * (`SET LOCAL ROLE`) and checks what the role can READ and WRITE.
 *
 * The exact expression pins in `security-readiness.ts` say the policies are the
 * reviewed ones; this probe says they DO what the review assumed, whatever the
 * text. Same pattern as the worker secret probe (`worker-secret-probe.ts`,
 * Issue #1160): its own file because it is the only readiness code that opens a
 * transaction.
 *
 * When the checking connection cannot assume the role (not a superuser and not
 * a member), the probe is not run; the exact pins still apply.
 */

class ProbeRollback extends Error {}

const ROLE = "awcms_telegram_engagement_dispatch";

/** One finding per broken expectation; empty when the role behaves. */
export async function probeTelegramEngagementDispatchRole(
  sql: Bun.SQL
): Promise<string[] | null> {
  const can = (await sql`
    SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
           OR pg_has_role(current_user, ${ROLE}, 'MEMBER') AS can
  `) as { can: boolean }[];

  if (!can[0]?.can) return null;

  const findings: string[] = [];

  try {
    await sql.begin(async (tx) => {
      const tenantA = crypto.randomUUID();
      const tenantB = crypto.randomUUID();

      for (const tenantId of [tenantA, tenantB]) {
        const code = `tge-${tenantId.slice(0, 8)}`;

        await tx`
          INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
          VALUES (${tenantId}, ${code}, ${code})
        `;
      }

      const secret = async (tenantId: string, purpose: string) =>
        (
          (await tx`
            INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id)
            VALUES (${tenantId}, ${purpose}, 'v2:probe:aa:bb:cc', 'probe')
            RETURNING id
          `) as { id: string }[]
        )[0]!.id;
      const account = async (
        tenantId: string,
        provider: string,
        kind: string,
        authMode: string,
        status: string,
        secretId: string | null
      ) =>
        (
          (await tx`
            INSERT INTO awcms_channel_accounts
              (tenant_id, provider, account_kind, external_id, display_name,
               auth_mode, status, secret_id)
            VALUES (${tenantId}, ${provider}, ${kind},
                    ${`probe-${crypto.randomUUID()}`}, 'probe', ${authMode},
                    ${status}, ${secretId})
            RETURNING id
          `) as { id: string }[]
        )[0]!.id;
      const endpoint = async (
        tenantId: string,
        accountId: string,
        seedId: string | null
      ) =>
        (
          (await tx`
            INSERT INTO awcms_telegram_engagement_endpoints
              (tenant_id, account_id, secret_id, callback_hash, state)
            VALUES (${tenantId}, ${accountId}, ${seedId},
                    ${`sha256:${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`},
                    'pending')
            RETURNING id
          `) as { id: string }[]
        )[0]!.id;

      // Positive controls: a live bot's token and its endpoint's seed.
      const liveToken = await secret(tenantA, "bot_token");
      const liveSeed = await secret(tenantA, "webhook_signing_secret");
      const liveBot = await account(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        "connected",
        liveToken
      );

      await endpoint(tenantA, liveBot, liveSeed);

      // Canaries that must stay hidden.
      const disabledToken = await secret(tenantA, "bot_token");
      const disabledSeed = await secret(tenantA, "webhook_signing_secret");
      const disabledBot = await account(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        "disabled",
        disabledToken
      );

      await endpoint(tenantA, disabledBot, disabledSeed);

      const revokedToken = await secret(tenantA, "bot_token");
      const revokedSeedTemp = await secret(tenantA, "webhook_signing_secret");
      const revokedBot = await account(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        "connected",
        revokedToken
      );
      const revokedEndpoint = await endpoint(
        tenantA,
        revokedBot,
        revokedSeedTemp
      );

      await tx`
        UPDATE awcms_telegram_engagement_endpoints
        SET state = 'revoked', revoked_at = now(), secret_id = NULL, provider_action = NULL
        WHERE id = ${revokedEndpoint}
      `;

      const whatsappToken = await secret(tenantA, "api_token");
      const whatsapp = await account(
        tenantA,
        "whatsapp_cloud",
        "phone_number",
        "api_token",
        "disabled",
        whatsappToken
      );
      const socialToken = await secret(tenantA, "provider_access_token");

      await account(
        tenantA,
        "facebook",
        "page",
        "oauth2",
        "connected",
        socialToken
      );

      const otherTenantToken = await secret(tenantB, "bot_token");
      const otherTenantBot = await account(
        tenantB,
        "telegram",
        "bot",
        "bot_token",
        "connected",
        otherTenantToken
      );

      await endpoint(
        tenantB,
        otherTenantBot,
        await secret(tenantB, "webhook_signing_secret")
      );

      const contact = (
        (await tx`
          INSERT INTO awcms_telegram_engagement_contacts
            (tenant_id, account_id, contact_hash, chat_ciphertext, state, stopped_at)
          VALUES (${tenantA}, ${liveBot}, ${`k1:${"d".repeat(64)}`},
                  'v2:probe:aa:bb:cc', 'stopped', now())
          RETURNING id
        `) as { id: string }[]
      )[0]!.id;

      // sql/436: a started contact (the one transition the role may make) and
      // a pending bot whose health the role reports through the definer.
      const startedContact = (
        (await tx`
          INSERT INTO awcms_telegram_engagement_contacts
            (tenant_id, account_id, contact_hash, chat_ciphertext, state)
          VALUES (${tenantA}, ${liveBot}, ${`k1:${"e".repeat(64)}`},
                  'v2:probe:aa:bb:cc', 'started')
          RETURNING id, version
        `) as { id: string; version: number }[]
      )[0]!;
      const pendingBot = await account(
        tenantA,
        "telegram",
        "bot",
        "bot_token",
        "pending",
        null
      );
      const versionOf = async (id: string) =>
        Number(
          (
            (await tx`
              SELECT version FROM awcms_channel_accounts WHERE id = ${id}
            `) as { version: number }[]
          )[0]!.version
        );
      const liveBotVersion = await versionOf(liveBot);
      const pendingBotVersion = await versionOf(pendingBot);

      // The #1271 audit, M1 (sql/374): another module's event the role must
      // neither see nor deliver to a consumer.
      await tx`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;

      const foreignEvent = (
        (await tx`
          INSERT INTO awcms_domain_events
            (tenant_id, event_type, event_version, aggregate_type,
             aggregate_id, order_key, producer_module, payload, occurred_at)
          VALUES (${tenantA}, 'awcms.workflow.instance.approved', '1.0',
                  'workflow_instance', ${tenantA}, 'probe', 'workflow_approval',
                  '{}'::jsonb, now())
          RETURNING id, event_sequence
        `) as { id: string; event_sequence: string }[]
      )[0]!;

      await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
      await tx`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;

      const seen = (
        (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
      ).map((row) => row.id);
      const hidden = {
        "a disabled bot's token": disabledToken,
        "a disabled bot's seed": disabledSeed,
        "a fully revoked bot's token": revokedToken,
        "a WhatsApp credential": whatsappToken,
        "a social access token": socialToken,
        "another tenant's bot token": otherTenantToken
      };

      for (const [what, id] of Object.entries(hidden)) {
        if (seen.includes(id))
          findings.push(`the dispatch role can read ${what}`);
      }

      if (!seen.includes(liveToken) || !seen.includes(liveSeed)) {
        findings.push(
          "the dispatch role cannot read a live bot's token and seed (positive control)"
        );
      }

      // Writes that must be refused: either no row is affected (a USING
      // policy hides it) or the statement fails (a WITH CHECK policy or a
      // guard); each in a savepoint so the probe goes on.
      const refused = async (
        what: string,
        run: (sp: Bun.SQL) => Promise<unknown[]>
      ) => {
        try {
          const rows = await tx.savepoint((sp) => run(sp));

          if (rows.length > 0) findings.push(`the dispatch role could ${what}`);
        } catch {
          // Refused by the database: the expectation.
        }
      };

      await refused(
        "re-enable a disabled bot",
        (sp) => sp`
        UPDATE awcms_channel_accounts SET status = 'connected'
        WHERE id = ${disabledBot} RETURNING id
      `
      );
      await refused(
        "re-enable a WhatsApp account",
        (sp) => sp`
        UPDATE awcms_channel_accounts SET status = 'connected'
        WHERE id = ${whatsapp} RETURNING id
      `
      );
      await refused(
        "re-arm a revoked endpoint's deleteWebhook",
        (sp) => sp`
        UPDATE awcms_telegram_engagement_endpoints SET provider_action = 'delete'
        WHERE id = ${revokedEndpoint} RETURNING id
      `
      );
      await refused(
        "forge a marketing opt-in",
        (sp) => sp`
        INSERT INTO awcms_telegram_engagement_consents
          (tenant_id, contact_id, purpose, action, notice_version, method, occurred_at)
        VALUES (${tenantA}, ${contact}, 'marketing', 'opt_in', 'probe-v1',
                'consent_button', now())
        RETURNING id
      `
      );
      await refused(
        "un-stop a stopped contact",
        (sp) => sp`
        UPDATE awcms_telegram_engagement_contacts SET state = 'started'
        WHERE id = ${contact} RETURNING id
      `
      );
      await refused(
        "forge another module's domain event",
        (sp) => sp`
        INSERT INTO awcms_domain_events
          (tenant_id, event_type, event_version, aggregate_type, aggregate_id,
           order_key, producer_module, payload, occurred_at)
        VALUES (${tenantA}, 'awcms.identity_access.role.assigned', '1.0', 'role',
                ${crypto.randomUUID()}, 'probe', 'identity_access', '{}'::jsonb, now())
        RETURNING id
      `
      );
      await refused(
        "read another module's event id and sequence",
        (sp) => sp`
        SELECT id FROM awcms_domain_events WHERE id = ${foreignEvent.id}
      `
      );
      await refused(
        "deliver another module's event to a consumer",
        (sp) => sp`
        INSERT INTO awcms_domain_event_deliveries
          (tenant_id, event_id, event_sequence, event_type, event_version,
           order_key, consumer_name)
        VALUES (${tenantA}, ${foreignEvent.id}, ${foreignEvent.event_sequence},
                'awcms.telegram_engagement.consent.changed', '1.0', 'probe',
                'hr_workforce.attendance_correction_settler')
        RETURNING id
      `
      );

      // sql/436 (defence in depth): no direct write on the account or its
      // health row is left to the role, whatever the value.
      for (const [what, statement] of [
        [
          "set a bot's version directly",
          (sp: Bun.SQL) => sp`
            UPDATE awcms_channel_accounts SET version = 2147483647
            WHERE id = ${liveBot} RETURNING id
          `
        ],
        [
          "write a free status_reason",
          (sp: Bun.SQL) => sp`
            UPDATE awcms_channel_accounts SET status_reason = 'probe free text'
            WHERE id = ${liveBot} RETURNING id
          `
        ],
        [
          "write a health row directly",
          (sp: Bun.SQL) => sp`
            INSERT INTO awcms_channel_account_health
              (tenant_id, account_id, state, reason_code, checked_at)
            VALUES (${tenantA}, ${liveBot}, 'ok', NULL, now() - interval '9 years')
            RETURNING account_id
          `
        ]
      ] as [string, (sp: Bun.SQL) => Promise<unknown[]>][]) {
        await refused(what, statement);
      }

      /** The definer report, in a savepoint; its code, or `refused`. */
      const report = async (
        accountId: string,
        verdict: string,
        tenantArgument: string = tenantA
      ): Promise<string> => {
        try {
          return await tx.savepoint(async (sp) => {
            const rows = (await sp`
              SELECT awcms_telegram_engagement_report_bot_health(
                ${tenantArgument}::uuid, ${accountId}::uuid, ${verdict}
              ) AS code
            `) as { code: string }[];

            return rows[0]?.code ?? "none";
          });
        } catch {
          return "refused";
        }
      };
      const expectCode = (what: string, got: string, want: string) => {
        if (got !== want) {
          findings.push(
            `the health report ${what} answered ${got}, expected ${want}`
          );
        }
      };

      expectCode(
        "for a pending bot, OK,",
        await report(pendingBot, "OK"),
        "CONNECTED"
      );
      expectCode(
        "for a connected bot, TOKEN_REJECTED,",
        await report(liveBot, "TOKEN_REJECTED"),
        "DEGRADED"
      );
      expectCode(
        "for the same bot again",
        await report(liveBot, "TOKEN_REJECTED"),
        "UNCHANGED"
      );
      expectCode(
        "for a WhatsApp account",
        await report(whatsapp, "OK"),
        "NOT_A_BOT"
      );
      expectCode(
        "for a free-text verdict",
        await report(liveBot, "probe free text"),
        "refused"
      );
      expectCode(
        "for another tenant",
        await report(liveBot, "OK", tenantB),
        "refused"
      );

      // The contact block: whatever version the statement writes, the stored
      // one is OLD + 1.
      try {
        await tx.savepoint(
          (sp) => sp`
            UPDATE awcms_telegram_engagement_contacts
            SET state = 'blocked', blocked_at = now(), version = 2147483647,
                updated_at = now()
            WHERE id = ${startedContact.id}
          `
        );
      } catch (error) {
        findings.push(
          `the dispatch role could not mark a started contact blocked (positive control): ${error instanceof Error ? error.message.slice(0, 120) : "error"}`
        );
      }

      await tx.unsafe("RESET ROLE");

      const contactVersion = Number(
        (
          (await tx`
            SELECT version FROM awcms_telegram_engagement_contacts
            WHERE id = ${startedContact.id}
          `) as { version: number }[]
        )[0]!.version
      );

      if (contactVersion !== Number(startedContact.version) + 1) {
        findings.push(
          `a contact the dispatch role marked blocked stored version ${contactVersion}, not ${Number(startedContact.version) + 1}`
        );
      }

      const bots = (await tx`
        SELECT a.id, a.status, a.status_reason, a.version, h.state, h.reason_code
        FROM awcms_channel_accounts a
        LEFT JOIN awcms_channel_account_health h
          ON h.tenant_id = a.tenant_id AND h.account_id = a.id
        WHERE a.id IN (${liveBot}, ${pendingBot})
      `) as {
        id: string;
        status: string;
        status_reason: string | null;
        version: number;
        state: string | null;
        reason_code: string | null;
      }[];
      const live = bots.find((row) => row.id === liveBot);
      const pending = bots.find((row) => row.id === pendingBot);

      if (
        live?.status !== "degraded" ||
        live.status_reason !== "TOKEN_REJECTED" ||
        Number(live.version) !== liveBotVersion + 1 ||
        live.state !== "failing" ||
        live.reason_code !== "TOKEN_REJECTED"
      ) {
        findings.push(
          `the health report did not write exactly its constants for a rejected token (got ${JSON.stringify(live)})`
        );
      }
      if (
        pending?.status !== "connected" ||
        pending.status_reason !== null ||
        Number(pending.version) !== pendingBotVersion + 1 ||
        pending.state !== "ok"
      ) {
        findings.push(
          `the health report did not write exactly its constants for a verified bot (got ${JSON.stringify(pending)})`
        );
      }

      throw new ProbeRollback("rollback");
    });
  } catch (error) {
    // tx-swallow-ok: this catch is OUTSIDE the transaction: `sql.begin` has
    // already rolled it back (the sentinel throw is how the probe always ends),
    // so nothing aborted is left open and nothing is committed.
    if (!(error instanceof ProbeRollback)) {
      return [
        `the dispatch role probe could not run (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}); its boundary is unproven`
      ];
    }
  }

  return findings;
}
