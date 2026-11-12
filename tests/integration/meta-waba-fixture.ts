/**
 * Shared fixture (Issue #1143): a live `waba` container for a Meta Cloud API
 * number. Since `sql/365` the queue's sender guard refuses a message whose
 * `whatsapp_cloud` `waba_phone_number` sender has no live WABA container of its
 * own tenant, so any fixture that queues a message for a Meta number must give
 * the number a parent. The guard is deliberately NOT relaxed for tests.
 *
 * Uses the caller's administrative connection (the table owner), as the other
 * channel-account fixtures do.
 */
export async function seedMetaWabaContainer(
  admin: Bun.SQL,
  tenantId: string,
  wabaExternalId: string,
  options: { id?: string } = {}
): Promise<string> {
  const rows = (await admin`
    INSERT INTO awcms_channel_accounts
      (id, tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status)
    VALUES (${options.id ?? crypto.randomUUID()}, ${tenantId}, 'whatsapp_cloud',
            'waba', ${wabaExternalId}, 'waba', 'api_token', 'connected')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}
