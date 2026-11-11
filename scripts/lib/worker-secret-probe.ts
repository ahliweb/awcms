/**
 * The behavioural probe of the worker secret row policy (Issue #1160 audit
 * M3), used by `scripts/security-readiness.ts`. A file of its own because it is
 * the one place a readiness check opens a transaction (always rolled back),
 * which keeps every other readiness check outside the transaction gate.
 */

class ProbeRollback extends Error {}

/**
 * Issue #1160 audit M3: a BEHAVIOURAL probe of what `awcms_worker` can read in
 * `awcms_channel_secrets`, inside a transaction that is always rolled back. It
 * seeds one throwaway tenant with one secret the worker MUST see (the token of
 * a connected Mailketing account, the positive control) and five it must NOT
 * (a Telegram bot token, a WhatsApp refresh token, a Mailketing
 * `sender_identity`'s own token, a pending Mailketing account's token, a
 * Facebook page token), then reads as the worker under that tenant.
 *
 * Returns a finding, or `null` when the worker sees exactly the control. When
 * the checking connection cannot assume the worker role (a non-superuser that
 * is not a member), the probe is not run; the exact expression pin above still
 * applies.
 */
export async function probeWorkerSecretVisibility(
  sql: Bun.SQL
): Promise<string | null> {
  const can = (await sql`
    SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
           OR pg_has_role(current_user, 'awcms_worker', 'MEMBER') AS can
  `) as { can: boolean }[];

  if (!can[0]?.can) return null;

  let finding: string | null = null;

  try {
    await sql.begin(async (tx) => {
      const tenantId = crypto.randomUUID();
      const code = `rdy-${tenantId.slice(0, 8)}`;

      await tx`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${tenantId}, ${code}, ${code})
      `;

      const secret = async (purpose: string): Promise<string> => {
        const rows = (await tx`
          INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id)
          VALUES (${tenantId}, ${purpose}, 'v2:probe:aa:bb:cc', 'probe')
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      };
      const account = async (
        provider: string,
        kind: string,
        authMode: string,
        status: string,
        secretId: string | null,
        parentId: string | null = null
      ): Promise<string> => {
        const rows = (await tx`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name,
             auth_mode, status, secret_id, parent_account_id)
          VALUES (${tenantId}, ${provider}, ${kind},
                  ${`probe-${crypto.randomUUID()}`}, 'probe', ${authMode},
                  ${status}, ${secretId}, ${parentId})
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      };

      const allowed = await secret("api_token");
      const esp = await account(
        "mailketing",
        "esp_account",
        "api_token",
        "connected",
        allowed
      );
      const denied = [
        await secret("bot_token"),
        await secret("provider_refresh_token"),
        await secret("api_token"),
        await secret("api_token"),
        await secret("provider_access_token")
      ];

      await account("telegram", "bot", "bot_token", "connected", denied[0]!);
      await tx`
        INSERT INTO awcms_channel_provider_connections
          (tenant_id, provider, auth_mode, grant_state, refresh_secret_id)
        VALUES (${tenantId}, 'whatsapp_cloud', 'oauth2', 'active', ${denied[1]!})
      `;
      await account(
        "mailketing",
        "sender_identity",
        "api_token",
        "connected",
        denied[2]!,
        esp
      );
      await account(
        "mailketing",
        "esp_account",
        "api_token",
        "pending",
        denied[3]!
      );
      await account("facebook", "page", "oauth2", "connected", denied[4]!);

      await tx`SET LOCAL ROLE awcms_worker`;
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const seen = (
        (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
      ).map((row) => row.id);
      const leaked = denied.filter((id) => seen.includes(id)).length;

      if (leaked > 0 || !seen.includes(allowed)) {
        finding =
          `awcms_channel_secrets worker visibility probe FAILED: as awcms_worker, ${leaked} of 5 secrets that must stay hidden ` +
          `(Telegram bot token, WhatsApp refresh token, Mailketing sender_identity token, pending Mailketing account token, Facebook token) were visible` +
          (seen.includes(allowed)
            ? ""
            : ", and the connected Mailketing account token (positive control) was NOT visible");
      }

      throw new ProbeRollback("rollback");
    });
  } catch (error) {
    // tx-swallow-ok: this catch is OUTSIDE the transaction: `sql.begin` has
    // already rolled it back (the sentinel throw is how the probe always ends),
    // so nothing aborted is left open and nothing is committed.
    if (!(error instanceof ProbeRollback)) {
      return `awcms_channel_secrets worker visibility probe could not run (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}); the worker's secret visibility is unproven`;
    }
  }

  return finding;
}
