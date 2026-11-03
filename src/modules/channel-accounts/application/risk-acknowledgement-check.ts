/**
 * The one READ the send decision needs from the risk acknowledgement table
 * (Issue #1142). Kept in its own file because `ChannelAccountPort` runs in the
 * WhatsApp dispatcher as `awcms_worker` and must not import the secret store or
 * any writer (`tests/jobs-env-scoped-reach.test.ts`); this file imports nothing
 * but the pure catalogue.
 *
 * The worker holds COLUMN-ONLY SELECT on `(id, tenant_id, provider,
 * text_version, revoked_at)` (`sql/340`): this query names exactly those.
 */
import {
  resolveRiskAcknowledgement,
  type RiskAcknowledgementProvider
} from "../domain/risk-acknowledgements";

/** Whether `tenantId` holds an active acknowledgement of `provider`'s CURRENT, approved text. An unapproved text counts for nothing, whatever rows exist. */
export async function hasActiveRiskAcknowledgement(
  tx: Bun.SQL,
  tenantId: string,
  provider: RiskAcknowledgementProvider
): Promise<boolean> {
  const resolved = resolveRiskAcknowledgement(provider);

  if (!resolved.approved) return false;

  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_channel_provider_risk_acknowledgements
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
      AND text_version = ${resolved.entry.textVersion}
      AND revoked_at IS NULL
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}
