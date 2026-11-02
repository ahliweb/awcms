/**
 * The public intake, as two short database phases around the network calls
 * (ADR-0155 section 4; ADR-0006: no provider call inside a transaction).
 *
 *   phase 1  `verifyIntake`      token (tenant opened FROM the token), tenant and
 *                                module gates, source status, Origin host (https
 *                                unless a localhost dev host)
 *   (between) semantic checks, honeypot, Turnstile, THEN the per-source budget
 *                                [route]. There is deliberately NO "already
 *                                received" probe before the challenge: it would
 *                                be an eventId oracle for any token holder, so a
 *                                duplicate is decided only by the insert below
 *                                and answers exactly like a new submission.
 *   phase 2  `recordSubmission`  one transaction: insert + outbox event
 *
 * ## Every pre-proof failure is the SAME failure
 *
 * An unparseable token, an unknown tenant, an unknown source, a wrong secret, a
 * revoked or paused source, a disabled module, an unregistered Origin: all
 * `verifyIntake` returns is `null`, and it pays the same database round trips
 * and the same keyed-hash computation for each, so neither the body nor the
 * latency says which control refused. (A holder of a VALID token learns about
 * source-specific problems from `checkSourceRules`, after proof.)
 *
 * ## No person is created
 *
 * This writes a submission and one event. It creates, matches and merges no
 * person (ADR-0148 I7). The event carries an opaque reference and facts about
 * the submission, never the visitor's details.
 */
import { randomUUID } from "node:crypto";

import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  encryptField,
  keyedHashCandidates,
  keyedHashPrimary,
  matchesAnyHash,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  isTurnstileRequired,
  resolveTurnstileConfig,
  resolveTurnstileMaxTokenAgeSec,
  verifyTurnstileToken
} from "../../../lib/security/turnstile";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import { maskIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  buildSubmissionReceivedPayload,
  type SubmissionReceivedFacts
} from "../domain/engagement-events";
import {
  classifySubmissionOrigin,
  isAcceptableOriginScheme,
  isRegisteredHost,
  type SubmissionOrigin
} from "../domain/origin-policy";
import type { ParsedSourceToken } from "../domain/source-token";
import type { SubmissionRequest } from "../domain/submission-request";
import {
  SOURCE_TOKEN_HASH_PURPOSE,
  SUBMISSION_CONTACT_AAD_PURPOSE,
  SUBMISSION_CONTRACT_VERSION,
  SUBMISSION_EMAIL_HASH_PURPOSE,
  SUBMISSION_PHONE_HASH_PURPOSE,
  WEBSITE_ENGAGEMENT_MODULE_KEY,
  WEBSITE_ENGAGEMENT_SUBMISSION_AGGREGATE_TYPE,
  WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
  WEBSITE_ENGAGEMENT_EVENT_VERSION,
  WEBSITE_ENGAGEMENT_TURNSTILE_ACTION,
  type ChallengeMode,
  type ChallengeOutcome,
  type SubmissionKind
} from "../domain/website-engagement-constants";

type Sql = Bun.SQL;

/** The same SHAPE as a real stored hash, so an unknown source costs the same compare. */
const DUMMY_TOKEN_HASH = `k0:${"0".repeat(64)}`;

export type VerifiedSource = {
  tenantId: string;
  sourceId: string;
  code: string;
  acceptedKinds: SubmissionKind[];
  consentCopyVersion: string;
  challengeMode: ChallengeMode;
  origin: SubmissionOrigin;
};

type SourceRow = {
  id: string;
  code: string;
  status: string;
  token_hash: string;
  accepted_kinds: SubmissionKind[];
  consent_copy_version: string;
  challenge_mode: ChallengeMode;
};

/**
 * Phase 1. `null` is the single, uniform "refused" answer.
 *
 * The tenant is opened FROM THE TOKEN, and the secret is verified inside that
 * tenant's RLS context. A token naming a tenant that does not own the source
 * finds no row.
 */
export async function verifyIntake(
  sql: Sql,
  token: ParsedSourceToken,
  request: Request,
  ring: KeyRing
): Promise<VerifiedSource | null> {
  const origin = classifySubmissionOrigin(request);

  return withTenantOrThrow(sql, token.tenantId, async (tx) => {
    const tenantRows = (await tx`
      SELECT status FROM awcms_tenants WHERE id = ${token.tenantId}
    `) as { status: string }[];
    const moduleEntry = await fetchTenantModuleEntry(
      tx,
      token.tenantId,
      WEBSITE_ENGAGEMENT_MODULE_KEY
    );
    const sourceRows = (await tx`
      SELECT id, code, status, token_hash, accepted_kinds,
             consent_copy_version, challenge_mode
      FROM awcms_engagement_sources
      WHERE tenant_id = ${token.tenantId}
        AND id = ${token.sourceId}
        AND deleted_at IS NULL
    `) as SourceRow[];
    const source = sourceRows[0];

    // Always computed, always compared: the work does not depend on whether the
    // source exists.
    const candidates = keyedHashCandidates(
      token.secret,
      { purpose: SOURCE_TOKEN_HASH_PURPOSE, tenantId: token.tenantId },
      ring
    );
    const secretMatches = matchesAnyHash(
      source?.token_hash ?? DUMMY_TOKEN_HASH,
      candidates
    );

    // Always read, for the same reason.
    const hostRows = (await tx`
      SELECT d.normalized_hostname
      FROM awcms_engagement_source_domains sd
      JOIN awcms_tenant_domains d ON d.id = sd.tenant_domain_id
      WHERE sd.tenant_id = ${token.tenantId}
        AND sd.source_id = ${token.sourceId}
        AND d.status = 'active'
        AND d.deleted_at IS NULL
    `) as { normalized_hostname: string }[];

    const accepted =
      source !== undefined &&
      secretMatches &&
      source.status === "active" &&
      tenantRows[0]?.status === "active" &&
      (moduleEntry?.tenantEnabled ?? false) &&
      origin !== null &&
      isAcceptableOriginScheme(origin) &&
      isRegisteredHost(
        origin.hostname,
        hostRows.map((row) => row.normalized_hostname)
      );

    if (!accepted || !source || !origin) return null;

    return {
      tenantId: token.tenantId,
      sourceId: source.id,
      code: source.code,
      acceptedKinds: source.accepted_kinds,
      consentCopyVersion: source.consent_copy_version,
      challengeMode: source.challenge_mode,
      origin
    };
  });
}

export type SourceRuleRefusal =
  | { ok: true }
  | {
      ok: false;
      status: number;
      code: "KIND_NOT_ACCEPTED" | "CONSENT_REQUIRED" | "CONSENT_COPY_MISMATCH";
    };

/**
 * What can only be judged against the SOURCE, after proof. A refusal here is
 * specific (the website's developer needs it) and is about the request, never
 * about any person.
 */
export function checkSourceRules(
  source: Pick<VerifiedSource, "acceptedKinds" | "consentCopyVersion">,
  request: SubmissionRequest
): SourceRuleRefusal {
  if (!source.acceptedKinds.includes(request.kind)) {
    return { ok: false, status: 422, code: "KIND_NOT_ACCEPTED" };
  }

  if (request.kind === "interaction") return { ok: true };

  // A contact/lead is stored only with an explicit, un-implied consent to be
  // responded to, stated against the exact text the website currently shows.
  if (!request.consent.purposes.includes("respond_to_inquiry")) {
    return { ok: false, status: 422, code: "CONSENT_REQUIRED" };
  }

  if (request.consent.copyVersion !== source.consentCopyVersion) {
    return { ok: false, status: 409, code: "CONSENT_COPY_MISMATCH" };
  }

  return { ok: true };
}

/**
 * The challenge, outside any transaction. `null` means refused (one generic
 * outcome: a missing token, a rejected one, an outage and a misconfiguration are
 * indistinguishable to the caller, and the provider failing CLOSED means an
 * outage blocks forms rather than opening them).
 *
 * The expected hostname is the VERIFIED Origin host of THIS request, not one
 * global value, so a tenant with several domains is verified against the domain
 * the visitor was actually on.
 */
export async function runChallenge(
  source: Pick<VerifiedSource, "challengeMode" | "origin">,
  challengeToken: string | null,
  remoteIp: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<ChallengeOutcome | null> {
  if (source.challengeMode === "none") return "source_none";

  if (!isTurnstileRequired(env)) return "not_required";

  const config = resolveTurnstileConfig(env);

  if (!challengeToken || !config) return null;

  const result = await verifyTurnstileToken(
    challengeToken,
    config,
    {
      action: WEBSITE_ENGAGEMENT_TURNSTILE_ACTION,
      hostname: source.origin.hostname,
      maxTokenAgeSec: resolveTurnstileMaxTokenAgeSec(env)
    },
    remoteIp
  );

  return result.ok ? "turnstile_verified" : null;
}

export type RecordResult =
  | { outcome: "created"; submissionId: string }
  | { outcome: "duplicate" }
  | { outcome: "source_gone" };

/**
 * Phase 2: one transaction. The source row is re-read FOR SHARE so a revocation
 * that landed between the phases wins; the replay key's unique index is the
 * duplicate decision (`ON CONFLICT DO NOTHING`), not a read-then-write two
 * concurrent submissions could interleave with.
 */
export async function recordSubmission(
  sql: Sql,
  source: VerifiedSource,
  request: SubmissionRequest,
  challenge: ChallengeOutcome,
  ring: KeyRing,
  correlationId: string | undefined,
  now: Date = new Date()
): Promise<RecordResult> {
  return withTenantOrThrow(sql, source.tenantId, async (tx) => {
    const live = (await tx`
      SELECT 1 AS present
      FROM awcms_engagement_sources
      WHERE tenant_id = ${source.tenantId}
        AND id = ${source.sourceId}
        AND status = 'active'
        AND deleted_at IS NULL
      FOR SHARE
    `) as { present: number }[];

    if (live.length === 0) return { outcome: "source_gone" } as const;

    const submissionId = randomUUID();
    const occurredAt = request.occurredAt ?? now;
    const isInteraction = request.kind === "interaction";
    const contact = request.contact;

    const encrypted =
      !isInteraction && contact
        ? encryptField(
            JSON.stringify({
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              company: contact.company,
              subject: contact.subject,
              message: contact.message
            }),
            {
              purpose: SUBMISSION_CONTACT_AAD_PURPOSE,
              tenantId: source.tenantId,
              rowId: submissionId
            },
            ring
          )
        : null;
    const emailHash =
      !isInteraction && contact?.emailNormalized
        ? keyedHashPrimary(
            contact.emailNormalized,
            {
              purpose: SUBMISSION_EMAIL_HASH_PURPOSE,
              tenantId: source.tenantId
            },
            ring
          )
        : null;
    const phoneHash =
      !isInteraction && contact?.phoneNormalized
        ? keyedHashPrimary(
            contact.phoneNormalized,
            {
              purpose: SUBMISSION_PHONE_HASH_PURPOSE,
              tenantId: source.tenantId
            },
            ring
          )
        : null;
    const emailMasked =
      !isInteraction && contact?.emailNormalized
        ? maskIdentifierValue(contact.emailNormalized, "email")
        : null;
    const phoneMasked =
      !isInteraction && contact?.phoneNormalized
        ? maskIdentifierValue(contact.phoneNormalized, "phone")
        : null;
    const consentAt = isInteraction ? null : now;
    const purposes = isInteraction ? [] : request.consent.purposes;
    const a = request.attribution;

    const inserted = (await tx`
      INSERT INTO awcms_engagement_submissions
        (id, tenant_id, source_id, event_id, kind, interaction_type, topic, locale,
         privacy_class, occurred_at, received_at,
         contact_encrypted, email_hash, phone_hash, email_masked, phone_masked,
         consent_purposes, consent_copy_version, consent_page_path, consent_at,
         landing_path, referrer_host, utm_source, utm_medium, utm_campaign,
         utm_term, utm_content,
         origin_host, origin_via, challenge_outcome, contract_version)
      VALUES
        (${submissionId}, ${source.tenantId}, ${source.sourceId}, ${request.eventId},
         ${request.kind}, ${request.interactionType}, ${request.topic}, ${request.locale},
         ${isInteraction ? "anonymous" : "personal"}, ${occurredAt}, ${now},
         ${encrypted}, ${emailHash}, ${phoneHash}, ${emailMasked}, ${phoneMasked},
         ${tx.array(purposes, "text")},
         ${isInteraction ? null : request.consent.copyVersion},
         ${isInteraction ? null : request.consent.pagePath}, ${consentAt},
         ${a.landingPath}, ${a.referrerHost}, ${a.utmSource}, ${a.utmMedium},
         ${a.utmCampaign}, ${a.utmTerm}, ${a.utmContent},
         ${source.origin.hostname}, ${source.origin.via}, ${challenge},
         ${SUBMISSION_CONTRACT_VERSION})
      ON CONFLICT (tenant_id, source_id, event_id) DO NOTHING
      RETURNING id
    `) as { id: string }[];

    if (inserted.length === 0) return { outcome: "duplicate" } as const;

    const identifiers: ("email" | "phone")[] = [];
    if (emailHash) identifiers.push("email");
    if (phoneHash) identifiers.push("phone");

    const facts: SubmissionReceivedFacts = {
      submissionId,
      sourceId: source.sourceId,
      sourceCode: source.code,
      clientEventId: request.eventId,
      kind: request.kind,
      interactionType: request.interactionType,
      topic: request.topic,
      locale: request.locale,
      occurredAt,
      receivedAt: now,
      originHost: source.origin.hostname,
      originVia: source.origin.via,
      challenge,
      consent: {
        purposes,
        copyVersion: isInteraction ? null : request.consent.copyVersion,
        pagePath: isInteraction ? null : request.consent.pagePath,
        consentAt
      },
      attribution: a,
      identifiers,
      privacyClass: isInteraction ? "anonymous" : "personal"
    };

    await appendDomainEvent(tx, source.tenantId, {
      eventType: WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
      eventVersion: WEBSITE_ENGAGEMENT_EVENT_VERSION,
      aggregateType: WEBSITE_ENGAGEMENT_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: submissionId,
      producerModule: WEBSITE_ENGAGEMENT_MODULE_KEY,
      correlationId: correlationId ?? null,
      payload: buildSubmissionReceivedPayload(facts),
      occurredAt: now
    });

    return { outcome: "created", submissionId } as const;
  });
}
