/**
 * The content digest of a rule version's terms (Issue #950, ADR-0132).
 *
 * A reviewer approves WHAT THEY SAW. Publish and edit therefore name the digest
 * they were shown (`expectedContentDigest`), and the server refuses (409) when
 * the stored terms no longer hash to it — so a draft edited between "looked at
 * it" and "published it" can never be published unseen, and two editors cannot
 * silently overwrite one another.
 *
 * SHA-256 over a canonical JSON array of the terms in a fixed order, with
 * decimals in the trimmed form the API returns. It covers every editable term
 * and the identity (key and version); it carries no stamp, so a no-op replace
 * does not change it. It is not a secret and not an authenticator — it is a
 * version token that also goes into the publish audit row, so "which terms were
 * published" is answerable without putting a rate in the audit log.
 */
import { createHash } from "node:crypto";

export type DigestTerms = {
  ruleKey: string;
  versionNo: number;
  name: string;
  sourceType: string;
  calculation: string;
  rate: string | null;
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  currencyCode: string;
  roundingMode: string;
  roundingScale: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function ruleContentDigest(terms: DigestTerms): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        terms.ruleKey,
        terms.versionNo,
        terms.name,
        terms.sourceType,
        terms.calculation,
        terms.rate,
        terms.fixedAmount,
        terms.minAmount,
        terms.maxAmount,
        terms.currencyCode,
        terms.roundingMode,
        terms.roundingScale,
        terms.effectiveFrom,
        terms.effectiveTo
      ])
    )
    .digest("hex");
}
