/**
 * Advisory DNS evidence for tenant senders (Issue #1479, ADR-0151 Q9, owner
 * decision K19.2). Looks up the SPF, DMARC and (when selectors are configured)
 * DKIM records of a sender's domain through an INJECTED resolver, and records
 * the closed result with the date of the check.
 *
 * ## It never changes a sender's status
 *
 * Nothing here imports `channel_accounts`, takes a health writer, or touches an
 * account row: the only write is one upsert of
 * `awcms_email_sender_dns_evidence`, a table the dispatcher and the health
 * writer never read. A failing record is information for the operator.
 *
 * ## Isolation, bounds, and where it runs
 *
 *   - Lookups run OUTSIDE every transaction (ADR-0006); a domain shared by
 *     several senders is looked up once per pass.
 *   - The pass is bounded: at most {@link MAX_DNS_DOMAINS_PER_PASS} domains and
 *     {@link DNS_PASS_BUDGET_MS}, so a tenant with many senders cannot hold the
 *     job; what is not reached is left with its older evidence and date.
 *   - One failing sender (a write refused, a resolver that throws) is counted
 *     and logged for THAT sender; every other sender, tenant and the provider
 *     verification are unaffected, and an advisory failure never fails the run.
 *   - Only the jobs container makes these queries (the resolver is imported by
 *     `scripts/email-senders-verify.ts` alone).
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type { EmailAccountSummary } from "../../_shared/ports/channel-account-port";
import {
  classifyDkimSelector,
  classifyDmarc,
  classifySpf,
  evidenceLearntNothing,
  foldDkim,
  senderDomainOf,
  type EmailSenderDnsEvidence,
  type TxtResolver
} from "../domain/email-sender-dns";

const MODULE_KEY = "email";

export const MAX_DNS_DOMAINS_PER_PASS = 500;
export const DNS_PASS_BUDGET_MS = 10 * 60_000;

export type EmailSenderDnsDeps = {
  resolver: TxtResolver;
  selectors: readonly string[];
  /** Shared across the tenants of one run: domain -> evidence promise. */
  cache: Map<string, Promise<EmailSenderDnsEvidence>>;
  /** Wall-clock deadline of the whole run (`Date.now()` based). */
  deadline: number;
  now?: () => number;
};

export type EmailSenderDnsSummary = {
  dnsChecked: number;
  dnsLearntNothing: number;
  dnsSkipped: number;
  dnsFailed: number;
};

export function emptyEmailSenderDnsSummary(): EmailSenderDnsSummary {
  return { dnsChecked: 0, dnsLearntNothing: 0, dnsSkipped: 0, dnsFailed: 0 };
}

export function newEmailSenderDnsDeps(
  resolver: TxtResolver,
  selectors: readonly string[],
  now: () => number = Date.now
): EmailSenderDnsDeps {
  return {
    resolver,
    selectors,
    cache: new Map(),
    deadline: now() + DNS_PASS_BUDGET_MS,
    now
  };
}

/** The evidence for one domain: three kinds of record, each looked up once. */
export async function collectDomainDnsEvidence(
  domain: string,
  resolver: TxtResolver,
  selectors: readonly string[]
): Promise<EmailSenderDnsEvidence> {
  const [spf, dmarc, ...dkim] = await Promise.all([
    resolver(domain),
    resolver(`_dmarc.${domain}`),
    ...selectors.map((selector) => resolver(`${selector}._domainkey.${domain}`))
  ]);
  const policy = classifyDmarc(dmarc);

  return {
    domain,
    spf: classifySpf(spf) as EmailSenderDnsEvidence["spf"],
    dkim: foldDkim(dkim.map((lookup) => classifyDkimSelector(lookup))),
    dmarc: policy.state,
    dmarcPolicy: policy.policy
  };
}

export async function recordSenderDnsEvidence(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  evidence: EmailSenderDnsEvidence
): Promise<void> {
  await tx`
    INSERT INTO awcms_email_sender_dns_evidence
      (tenant_id, account_id, domain, spf_state, dkim_state, dmarc_state,
       dmarc_policy, checked_at)
    VALUES (${tenantId}, ${accountId}, ${evidence.domain}, ${evidence.spf},
            ${evidence.dkim}, ${evidence.dmarc}, ${evidence.dmarcPolicy}, now())
    ON CONFLICT (tenant_id, account_id) DO UPDATE
    SET domain = EXCLUDED.domain, spf_state = EXCLUDED.spf_state,
        dkim_state = EXCLUDED.dkim_state, dmarc_state = EXCLUDED.dmarc_state,
        dmarc_policy = EXCLUDED.dmarc_policy, checked_at = EXCLUDED.checked_at,
        updated_at = now()
  `;
}

/**
 * Records advisory evidence for every sender of `accounts`. Never throws for a
 * sender: each failure is counted and logged for that sender alone.
 */
export async function recordEmailSenderDnsEvidenceForTenant(
  sql: Bun.SQL,
  tenantId: string,
  accounts: readonly EmailAccountSummary[],
  deps: EmailSenderDnsDeps
): Promise<EmailSenderDnsSummary> {
  const summary = emptyEmailSenderDnsSummary();
  const now = deps.now ?? Date.now;

  for (const account of accounts) {
    for (const sender of account.senders) {
      const domain = senderDomainOf(sender.address);

      try {
        if (domain === null) {
          summary.dnsSkipped += 1;
          continue;
        }

        let pending = deps.cache.get(domain);

        if (pending === undefined) {
          if (
            deps.cache.size >= MAX_DNS_DOMAINS_PER_PASS ||
            now() >= deps.deadline
          ) {
            summary.dnsSkipped += 1;
            continue;
          }

          pending = collectDomainDnsEvidence(
            domain,
            deps.resolver,
            deps.selectors
          );
          deps.cache.set(domain, pending);
        }

        const evidence = await pending;

        if (evidenceLearntNothing(evidence)) {
          summary.dnsLearntNothing += 1;
          continue;
        }

        await withTenantOrThrow(
          sql,
          tenantId,
          (tx) =>
            recordSenderDnsEvidence(tx, tenantId, sender.accountId, evidence),
          { workClass: "background_sync" }
        );
        summary.dnsChecked += 1;
      } catch (error) {
        summary.dnsFailed += 1;
        log("warning", "email.senders_verify.dns_evidence_failed", {
          tenantId,
          moduleKey: MODULE_KEY,
          accountId: sender.accountId,
          reason: error instanceof Error ? error.name : "unknown"
        });
      }
    }
  }

  return summary;
}
