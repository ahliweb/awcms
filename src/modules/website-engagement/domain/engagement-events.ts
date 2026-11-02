/**
 * The outward seam of `website_engagement` (ADR-0155 section 6): the domain
 * events a downstream CRM adapter consumes, in the ADR-0148 section 6 shape.
 *
 * ## Opaque reference, not the person
 *
 * The event carries the SUBMISSION ID and the facts ABOUT the submission
 * (which source, which kind, where it was captured, what consent was recorded,
 * which kinds of identifier it holds). It never carries a name, an address, a
 * phone number or the message: a consumer that needs them reads the submission
 * through the sanctioned reveal endpoint under its own permission, and that
 * read is audited.
 *
 * Key names avoid the credential-shaped vocabulary the event validator refuses
 * (`email`, `phone`, `token` ...): the identifier KINDS are values of
 * `identifiers`, and the source authentication is `sourceAuthenticated`.
 *
 * The contract is versioned (`contractVersion` here, `eventVersion` on the
 * envelope). Nothing in it creates, matches or merges a person: that is
 * downstream, through `contact_link_evidence` (ADR-0148 section 6, I7).
 *
 * Pure module: no database, no I/O.
 */
import type { SubmissionAttribution } from "./submission-request";
import type {
  ChallengeOutcome,
  ConsentPurpose,
  InteractionType,
  SubmissionKind,
  SubmissionPrivacyClass,
  WithdrawalReason
} from "./website-engagement-constants";
import { SUBMISSION_CONTRACT_VERSION } from "./website-engagement-constants";

export type SubmissionReceivedFacts = {
  submissionId: string;
  sourceId: string;
  sourceCode: string;
  clientEventId: string;
  kind: SubmissionKind;
  interactionType: InteractionType | null;
  topic: string | null;
  locale: string | null;
  occurredAt: Date;
  receivedAt: Date;
  originHost: string;
  originVia: "origin" | "referer";
  challenge: ChallengeOutcome;
  consent: {
    purposes: ConsentPurpose[];
    copyVersion: string | null;
    pagePath: string | null;
    consentAt: Date | null;
  };
  attribution: SubmissionAttribution;
  identifiers: ("email" | "phone")[];
  privacyClass: SubmissionPrivacyClass;
};

function compactAttribution(
  attribution: SubmissionAttribution
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(attribution)) {
    if (value !== null) out[key] = value;
  }

  return out;
}

export function buildSubmissionReceivedPayload(
  facts: SubmissionReceivedFacts
): Record<string, unknown> {
  return {
    contractVersion: SUBMISSION_CONTRACT_VERSION,
    submissionId: facts.submissionId,
    sourceId: facts.sourceId,
    sourceCode: facts.sourceCode,
    clientEventId: facts.clientEventId,
    kind: facts.kind,
    interactionType: facts.interactionType,
    topic: facts.topic,
    locale: facts.locale,
    occurredAt: facts.occurredAt.toISOString(),
    receivedAt: facts.receivedAt.toISOString(),
    provenance: {
      sourceAuthenticated: true,
      originVerified: true,
      originHost: facts.originHost,
      originVia: facts.originVia,
      challenge: facts.challenge
    },
    consent: {
      purposes: facts.consent.purposes,
      copyVersion: facts.consent.copyVersion,
      pagePath: facts.consent.pagePath,
      consentAt: facts.consent.consentAt?.toISOString() ?? null
    },
    attribution: compactAttribution(facts.attribution),
    identifiers: facts.identifiers,
    privacyClass: facts.privacyClass
  };
}

export type SubmissionWithdrawnFacts = {
  submissionId: string;
  sourceId: string;
  sourceCode: string;
  reason: WithdrawalReason;
  withdrawnAt: Date;
  privacyClass: SubmissionPrivacyClass;
};

export function buildSubmissionWithdrawnPayload(
  facts: SubmissionWithdrawnFacts
): Record<string, unknown> {
  return {
    contractVersion: SUBMISSION_CONTRACT_VERSION,
    submissionId: facts.submissionId,
    sourceId: facts.sourceId,
    sourceCode: facts.sourceCode,
    reason: facts.reason,
    withdrawnAt: facts.withdrawnAt.toISOString(),
    privacyClass: facts.privacyClass
  };
}
