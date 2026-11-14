/**
 * Reads what the Meta enablement preflight needs, for ONE tenant, in a
 * tenant-scoped transaction (Issue #1298 L5). READ-ONLY: three SELECTs, no
 * write, no provider call. It runs as `awcms_worker` (the role of the
 * dispatcher whose verdict it predicts), which already holds every column read
 * here, and never decrypts a credential.
 *
 * The pure verdict is `evaluateMetaEnablement`; this file only gathers rows.
 */
import type { ChannelAccountPort } from "../../_shared/ports/channel-account-port";
import { loadChannelAccountPort } from "../infrastructure/channel-account-port-loader";
import { classifySenderUnavailable } from "../domain/whatsapp-sender";
import {
  evaluateMetaEnablement,
  type MetaPreflightApproval,
  type MetaPreflightGroup,
  type MetaPreflightNumber,
  type MetaPreflightReport
} from "../domain/meta-enablement-preflight";
import {
  isMetaTemplateCategory,
  isMetaTemplateStatus
} from "../domain/meta-cloud-policy";
import {
  getWhatsappTemplate,
  WHATSAPP_PURPOSES,
  type WhatsappPurpose
} from "../domain/whatsapp-templates";

/** Hard cap on approval rows read per tenant; a tenant with more has a template catalogue this preflight cannot be exhaustive about, and says so. */
export const META_PREFLIGHT_APPROVAL_LIMIT = 5000;

export type TenantMetaPreflight = MetaPreflightReport & {
  /** `true` when the approval list hit {@link META_PREFLIGHT_APPROVAL_LIMIT}: a "not approved" finding may then be a row that was not read. */
  approvalsTruncated: boolean;
};

export async function runMetaEnablementPreflight(
  tx: Bun.SQL,
  tenantId: string,
  options: { senders?: ChannelAccountPort } = {}
): Promise<TenantMetaPreflight> {
  const numberRows = (await tx`
    SELECT a.id, p.external_id AS waba_id
    FROM awcms_channel_accounts a
    LEFT JOIN awcms_channel_accounts p
      ON p.tenant_id = a.tenant_id AND p.id = a.parent_account_id
     AND p.provider = 'whatsapp_cloud' AND p.account_kind = 'waba'
     AND p.deleted_at IS NULL
    WHERE a.tenant_id = ${tenantId} AND a.provider = 'whatsapp_cloud'
      AND a.account_kind = 'waba_phone_number' AND a.deleted_at IS NULL
      AND a.status = 'connected'
    ORDER BY a.id
  `) as { id: string; waba_id: string | null }[];
  // #1298 (audit LOW-2): the binding is decided by the dispatcher's OWN rule
  // (the sender port, which applies `loadLendingParent`: the parent's status,
  // its kind and its business scope), not by a look-alike JOIN. The same
  // `dm` verdict the dispatcher takes per lane, classified by the same
  // `classifySenderUnavailable`, so a revoked or disabled parent or a scope
  // that does not contain the number's is a TERMINAL finding and a held one
  // (degraded, pending) is reported separately.
  const port = options.senders ?? (await loadChannelAccountPort());
  const numbers: MetaPreflightNumber[] = [];

  for (const row of numberRows) {
    // No catch on purpose: an error inside this transaction poisons it, and a
    // tenant that cannot be read is reported by the caller as "could not be
    // read" (never as READY).
    const verdict = await port.resolveWhatsappSender(tx, {
      tenantId,
      accountId: row.id,
      capability: "dm"
    });
    const sender: NonNullable<MetaPreflightNumber["sender"]> = verdict.usable
      ? { verdict: "usable" }
      : {
          verdict: classifySenderUnavailable(verdict.reason),
          reason: verdict.reason
        };

    numbers.push({ accountId: row.id, wabaId: row.waba_id, sender });
  }

  if (numbers.length === 0) {
    return {
      ...evaluateMetaEnablement({
        numbers,
        groups: [],
        approvals: [],
        lookupTemplate: getWhatsappTemplate
      }),
      approvalsTruncated: false
    };
  }

  const groupRows = (await tx`
    SELECT m.sender_account_id, m.template_key, m.purpose,
           EXISTS (
             SELECT 1 FROM awcms_whatsapp_service_windows w
             WHERE w.tenant_id = m.tenant_id
               AND w.sender_account_id = m.sender_account_id
               AND w.recipient_hash = m.recipient_hash
               AND w.last_inbound_at > now() - interval '24 hours'
           ) AS window_open,
           count(*)::int AS rows
    FROM awcms_whatsapp_messages m
    WHERE m.tenant_id = ${tenantId}
      AND m.status IN ('queued', 'retry_wait', 'sending')
      AND m.sender_account_id = ANY(string_to_array(${numbers.map((n) => n.accountId).join(",")}, ',')::uuid[])
    GROUP BY m.sender_account_id, m.template_key, m.purpose, window_open
  `) as {
    sender_account_id: string;
    template_key: string;
    purpose: string;
    window_open: boolean;
    rows: number;
  }[];
  const groups: MetaPreflightGroup[] = groupRows.flatMap((row) =>
    (WHATSAPP_PURPOSES as readonly string[]).includes(row.purpose)
      ? [
          {
            senderAccountId: row.sender_account_id,
            templateKey: row.template_key,
            purpose: row.purpose as WhatsappPurpose,
            windowOpen: row.window_open,
            rows: row.rows
          }
        ]
      : []
  );
  const approvalRows = (await tx`
    SELECT waba_external_id, template_name, language, provider_status, category
    FROM awcms_whatsapp_meta_templates
    WHERE tenant_id = ${tenantId}
    ORDER BY waba_external_id, template_name, language
    LIMIT ${META_PREFLIGHT_APPROVAL_LIMIT + 1}
  `) as {
    waba_external_id: string;
    template_name: string;
    language: string;
    provider_status: string;
    category: string;
  }[];
  const approvals: MetaPreflightApproval[] = approvalRows
    .slice(0, META_PREFLIGHT_APPROVAL_LIMIT)
    .flatMap((row) =>
      isMetaTemplateStatus(row.provider_status) &&
      isMetaTemplateCategory(row.category)
        ? [
            {
              wabaId: row.waba_external_id,
              name: row.template_name,
              language: row.language,
              status: row.provider_status,
              category: row.category
            }
          ]
        : []
    );

  return {
    ...evaluateMetaEnablement({
      numbers,
      groups,
      approvals,
      lookupTemplate: getWhatsappTemplate
    }),
    approvalsTruncated: approvalRows.length > META_PREFLIGHT_APPROVAL_LIMIT
  };
}
