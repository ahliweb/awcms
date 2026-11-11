/**
 * "A withdrawal wins over everything queued" (ADR-0133 section 4, ADR-0152 TG6)
 * in one statement, shared by revocation, `/stop`, a block and erasure. Its own
 * file so the dispatcher can reach it without reaching the registration path.
 */

/** Cancels every queued (not yet leased) message of a bot or a contact; clears their text. */
export async function cancelQueuedMessages(
  tx: Bun.SQL,
  tenantId: string,
  scope: { accountId: string } | { contactId: string },
  failureCode: string
): Promise<number> {
  const rows = (
    "accountId" in scope
      ? await tx`
    UPDATE awcms_telegram_engagement_messages
    SET status = 'cancelled', failure_code = ${failureCode},
        text_ciphertext = NULL, finalized_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND account_id = ${scope.accountId}
      AND status = 'queued'
    RETURNING id
  `
      : await tx`
    UPDATE awcms_telegram_engagement_messages
    SET status = 'cancelled', failure_code = ${failureCode},
        text_ciphertext = NULL, finalized_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND contact_id = ${scope.contactId}
      AND status = 'queued'
    RETURNING id
  `
  ) as { id: string }[];

  return rows.length;
}
