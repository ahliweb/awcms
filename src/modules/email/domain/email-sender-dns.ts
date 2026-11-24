/**
 * Advisory SPF, DKIM and DMARC evidence of a tenant sender's domain (Issue
 * #1479, ADR-0151 section 2 and Q9, owner decision K19.2). Pure: parsing and
 * classification only, no network and no database.
 *
 * ## Advisory, and why the vocabulary is closed
 *
 * The evidence is shown to an operator with the date of the check. It is NOT a
 * verdict and never changes a sender's status: a sender is usable only when the
 * PROVIDER reports it verified. So this file produces closed codes and nothing
 * else; the text of a TXT record (which a tenant, or anyone who can publish in
 * its zone, controls) is parsed here and never stored, logged or returned.
 *
 * ## Absent is not unavailable
 *
 * `absent` (the name has no such record) is a fact about the domain.
 * `unavailable` (timeout, SERVFAIL, a refusal, anything unrecognised) is a fact
 * about OUR resolver and tells nothing about the domain. It is never collapsed
 * into `absent`: a resolver outage must not read as "this tenant has no SPF".
 */

export type DnsRecordState =
  "present" | "absent" | "invalid" | "unavailable" | "not_checked";

export type DmarcPolicy = "none" | "quarantine" | "reject";

export type EmailSenderDnsEvidence = {
  domain: string;
  spf: Exclude<DnsRecordState, "not_checked">;
  dkim: DnsRecordState;
  dmarc: Exclude<DnsRecordState, "not_checked">;
  dmarcPolicy: DmarcPolicy | null;
};

/** What one TXT lookup learnt (the shape every resolver adapter returns). */
export type TxtLookup =
  | { outcome: "records"; records: string[][] }
  | { outcome: "absent" }
  | { outcome: "unavailable" };

export type TxtResolver = (name: string) => Promise<TxtLookup>;

/** Same shape the `sql/461` CHECK enforces: at least two labels, LDH only. */
const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SELECTOR_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const MAX_DKIM_SELECTORS = 5;

/** The lower-case domain of an address, or `null` when it is not a checkable domain (no IP literal, no single label, nothing over 253 characters). */
export function senderDomainOf(address: string): string | null {
  const at = address.lastIndexOf("@");

  if (at < 1) return null;

  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();

  return domain.length <= 253 && DOMAIN_PATTERN.test(domain) ? domain : null;
}

/**
 * `EMAIL_SENDER_DNS_EVIDENCE_ENABLED`: ON unless exactly `"false"`. Egress is
 * allowed from the jobs container only (K19.2); a host without DNS egress
 * simply learns `unavailable` and writes nothing.
 */
export function isEmailSenderDnsEvidenceEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.EMAIL_SENDER_DNS_EVIDENCE_ENABLED?.trim() !== "false";
}

/**
 * `EMAIL_SENDER_DKIM_SELECTORS`: a comma list of the DKIM selectors to look up
 * (at most {@link MAX_DKIM_SELECTORS}, each a plain DNS label). Empty by
 * default: Mailketing documents no selector, and a DKIM record cannot be found
 * without one, so DKIM is then `not_checked` rather than guessed.
 */
export function resolveEmailSenderDkimSelectors(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const seen = new Set<string>();

  for (const part of (env.EMAIL_SENDER_DKIM_SELECTORS ?? "").split(",")) {
    const selector = part.trim().toLowerCase();

    if (SELECTOR_PATTERN.test(selector)) seen.add(selector);
    if (seen.size >= MAX_DKIM_SELECTORS) break;
  }

  return [...seen];
}

function joined(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(""));
}

const SPF_TERM = /^[+\-~?]?[a-z0-9]+([:=/][^\s]*)?$/i;

export function classifySpf(lookup: TxtLookup): DnsRecordState {
  if (lookup.outcome === "unavailable") return "unavailable";
  if (lookup.outcome === "absent") return "absent";

  const spf = joined(lookup.records).filter((text) =>
    /^v=spf1(\s|$)/i.test(text.trim())
  );

  if (spf.length === 0) return "absent";
  // Two SPF records is a permanent error (RFC 7208 section 4.5).
  if (spf.length > 1) return "invalid";

  const terms = spf[0]!.trim().split(/\s+/).slice(1);

  return terms.every((term) => SPF_TERM.test(term)) ? "present" : "invalid";
}

export function classifyDmarc(lookup: TxtLookup): {
  state: Exclude<DnsRecordState, "not_checked">;
  policy: DmarcPolicy | null;
} {
  if (lookup.outcome === "unavailable") {
    return { state: "unavailable", policy: null };
  }
  if (lookup.outcome === "absent") return { state: "absent", policy: null };

  const dmarc = joined(lookup.records).filter((text) =>
    /^v=DMARC1\s*(;|$)/i.test(text.trim())
  );

  if (dmarc.length === 0) return { state: "absent", policy: null };
  if (dmarc.length > 1) return { state: "invalid", policy: null };

  for (const tag of dmarc[0]!.split(";")) {
    const [name, ...rest] = tag.split("=");

    if (name?.trim().toLowerCase() !== "p") continue;

    const policy = rest.join("=").trim().toLowerCase();

    return policy === "none" || policy === "quarantine" || policy === "reject"
      ? { state: "present", policy }
      : { state: "invalid", policy: null };
  }

  return { state: "invalid", policy: null };
}

/** One selector's record: present only with a non-empty public key (`p=`); an empty `p=` is a revoked key. */
export function classifyDkimSelector(lookup: TxtLookup): DnsRecordState {
  if (lookup.outcome === "unavailable") return "unavailable";
  if (lookup.outcome === "absent") return "absent";

  const keys = joined(lookup.records).filter((text) =>
    /(^|;)\s*p\s*=/i.test(text)
  );

  if (keys.length === 0) return "absent";

  return keys.some((text) =>
    /(^|;)\s*p\s*=\s*[A-Za-z0-9+/=\s]{8,}\s*(;|$)/i.test(text)
  )
    ? "present"
    : "invalid";
}

/** Folds the per-selector results into the one DKIM state: any key found wins; otherwise a lookup we could not make is `unavailable`, then `invalid`, then `absent`. */
export function foldDkim(states: readonly DnsRecordState[]): DnsRecordState {
  if (states.length === 0) return "not_checked";
  if (states.includes("present")) return "present";
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("invalid")) return "invalid";

  return "absent";
}

/**
 * Whether the evidence learnt anything at all. A pass in which every lookup was
 * `unavailable` writes nothing, so the last recorded evidence stands with its
 * (older) date instead of being replaced by "we could not tell".
 */
export function evidenceLearntNothing(
  evidence: EmailSenderDnsEvidence
): boolean {
  return (
    evidence.spf === "unavailable" &&
    evidence.dmarc === "unavailable" &&
    (evidence.dkim === "unavailable" || evidence.dkim === "not_checked")
  );
}
