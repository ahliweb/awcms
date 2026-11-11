/**
 * Consent store and suppression list (Issue #963, ADR-0133 section 4).
 *
 * Both are keyed by `recipient_hash`; the raw number is never stored here. The
 * marketing consent decision joins THIS table and nothing else: segment, list
 * or campaign-audience membership is not an input anywhere in this module.
 *
 * ## Withdrawal and suppression win over everything queued
 *
 * Withdrawing a marketing consent, or suppressing a number, cancels the
 * recipient's still-waiting messages in the SAME transaction, and the
 * dispatcher re-checks eligibility again immediately before every send — so a
 * withdrawal lands in minutes even for a row claimed a moment earlier.
 *
 * ## The brand an opt-in was collected for (Issue #1231 M4, option (c))
 *
 * The consent stays ONE row per (tenant, recipient, purpose) and its status is
 * the tenant-wide answer. A grant records WHAT it covers: a business scope (a
 * brand) appended to `business_scopes`, or, with no scope, `unscoped_granted`.
 * Marketing of brand B needs B listed; an unscoped or legacy (`NULL`, recorded
 * before `sql/354`) opt-in covers only marketing that names no scope. A
 * withdrawal clears both (a CHECK in `sql/354` holds it), so reinstating never
 * resurrects a brand the person withdrew from: it records only the brand the
 * reinstating request names. Opt-out and suppression stay tenant-wide.
 */
import {
  buildRecipientHashes,
  hashListParam,
  maskRecipient,
  normalizePhoneNumber,
  parseRecipientHashKeys,
  type RecipientHashes,
  type RecipientKeyRing
} from "../domain/whatsapp-recipient";
import type {
  ConsentStatus,
  EligibilityFacts,
  SuppressionReason
} from "../domain/whatsapp-eligibility";
import {
  WHATSAPP_CONSENT_GRANTED_EVENT_TYPE,
  WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE
} from "../domain/whatsapp-events";
import { resolveWhatsappDefaultCountryCode } from "../domain/whatsapp-config";
import type { WhatsappBusinessScope } from "../domain/whatsapp-sender";
import { emitWhatsappConsentEvent } from "./whatsapp-event-emit";

export const WHATSAPP_LIST_MAX_LIMIT = 200;

/** Most brands one consent row may list (the CHECK in `sql/354`). */
export const WHATSAPP_CONSENT_MAX_SCOPES = 256;

/** One brand a marketing opt-in was collected for (Issue #1231 M4). */
export type ConsentScopeGrant = {
  type: string;
  id: string;
  source: string;
  grantedAt: string;
};

export type ConsentEntry = {
  id: string;
  recipientMasked: string;
  purpose: "marketing";
  status: ConsentStatus;
  source: string;
  grantedAt: string;
  withdrawnAt: string | null;
  /** Issue #1231 M4. The brands this opt-in covers; empty when withdrawn. */
  businessScopes: ConsentScopeGrant[];
  /**
   * Issue #1231 M4. `true`: an opt-in collected with no brand, covering only
   * marketing that names no business scope. `null`: recorded before brands were
   * recorded (legacy), read the same way. Never `true` on a withdrawn row.
   */
  unscopedGranted: boolean | null;
};

export type SuppressionEntry = {
  id: string;
  recipientMasked: string;
  reason: SuppressionReason;
  createdAt: string;
};

type ConsentRow = {
  id: string;
  recipient_masked: string;
  purpose: "marketing";
  status: ConsentStatus;
  source: string;
  granted_at: Date | string;
  withdrawn_at: Date | string | null;
  business_scopes: unknown;
  unscoped_granted: boolean | null;
};

type SuppressionRow = {
  id: string;
  recipient_masked: string;
  reason: SuppressionReason;
  created_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Tolerates a driver that hands jsonb back as text; anything malformed is dropped (it can only narrow what a consent covers). */
function toScopeGrants(value: unknown): ConsentScopeGrant[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((element) => {
    if (!element || typeof element !== "object") return [];

    const { type, id, source, grantedAt } = element as Record<string, unknown>;

    return typeof type === "string" &&
      typeof id === "string" &&
      typeof source === "string" &&
      typeof grantedAt === "string"
      ? [{ type, id, source, grantedAt }]
      : [];
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toConsent(row: ConsentRow): ConsentEntry {
  return {
    id: row.id,
    recipientMasked: row.recipient_masked,
    purpose: row.purpose,
    status: row.status,
    source: row.source,
    grantedAt: iso(row.granted_at),
    withdrawnAt: row.withdrawn_at ? iso(row.withdrawn_at) : null,
    businessScopes: toScopeGrants(row.business_scopes),
    unscopedGranted: row.unscoped_granted
  };
}

function toSuppression(row: SuppressionRow): SuppressionEntry {
  return {
    id: row.id,
    recipientMasked: row.recipient_masked,
    reason: row.reason,
    createdAt: iso(row.created_at)
  };
}

/**
 * One round trip; the facts the pure `decideEligibility` rule needs, for a
 * message of business scope `scope` (`null`: the message names no scope).
 */
export async function readEligibilityFacts(
  tx: Bun.SQL,
  tenantId: string,
  hashes: RecipientHashes,
  scope: WhatsappBusinessScope | null
): Promise<EligibilityFacts> {
  const list = hashListParam(hashes);
  const scopeType = scope?.type ?? null;
  const scopeId = scope?.id.toLowerCase() ?? null;
  // Every ring key is matched: a row written under an older key must still be
  // found, or a rotation would silently un-suppress everyone. A suppression
  // under ANY key wins; for consent the most restrictive row wins
  // (`withdrawn` over `granted`), so a stale granted row under an old key can
  // never outvote a withdrawal under a newer one.
  //
  // Coverage (Issue #1231 M4) is asked of GRANTED rows only: a scoped message
  // needs its exact (type, id) listed in `business_scopes` (containment, so the
  // element's provenance keys do not matter); an unscoped message needs an
  // unscoped opt-in, where a legacy NULL reads as one. Never a hierarchy, never
  // "any brand": the most restrictive reading.
  const rows = (await tx`
    SELECT
      (SELECT reason FROM awcms_whatsapp_suppressions
        WHERE tenant_id = ${tenantId}
          AND recipient_hash = ANY(string_to_array(${list}, ','))
        ORDER BY (reason = 'hard_failure') DESC LIMIT 1
      ) AS suppression_reason,
      (SELECT status FROM awcms_whatsapp_consents
        WHERE tenant_id = ${tenantId}
          AND recipient_hash = ANY(string_to_array(${list}, ','))
          AND purpose = 'marketing'
        ORDER BY (status = 'withdrawn') DESC LIMIT 1
      ) AS consent_status,
      (SELECT COALESCE(bool_or(
          CASE WHEN ${scopeType}::text IS NULL
            THEN unscoped_granted IS NOT FALSE
            ELSE business_scopes @> jsonb_build_array(jsonb_build_object(
              'type', ${scopeType}::text, 'id', ${scopeId}::text))
          END), false)
        FROM awcms_whatsapp_consents
        WHERE tenant_id = ${tenantId}
          AND recipient_hash = ANY(string_to_array(${list}, ','))
          AND purpose = 'marketing'
          AND status = 'granted'
      ) AS consent_covers_scope
  `) as {
    suppression_reason: SuppressionReason | null;
    consent_status: ConsentStatus | null;
    consent_covers_scope: boolean | null;
  }[];

  return {
    suppressionReason: rows[0]?.suppression_reason ?? null,
    consentStatus: rows[0]?.consent_status ?? null,
    consentCoversScope: rows[0]?.consent_covers_scope === true
  };
}

/**
 * Cancels a recipient's still-waiting messages. Only `queued`/`retry_wait`: a
 * `sending` row is already in a provider call and a cancel that raced it would
 * record a lie. `security` messages are untouched by a marketing opt-out and a
 * manual suppression (ADR-0133 section 4), so callers say whether `transactional` is included (marketing always is).
 */
export async function cancelWaitingMessagesForRecipient(
  tx: Bun.SQL,
  tenantId: string,
  hashes: RecipientHashes,
  includeTransactional: boolean,
  failureCode: string,
  onlyMessageId?: string
): Promise<number> {
  const list = hashListParam(hashes);
  const rows = (await tx`
    UPDATE awcms_whatsapp_messages
    SET status = 'cancelled', next_attempt_at = NULL, failure_code = ${failureCode},
        body = CASE WHEN contains_secret THEN '' ELSE body END,
        variables = CASE WHEN contains_secret THEN '{}'::jsonb ELSE variables END,
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND recipient_hash = ANY(string_to_array(${list}, ','))
      AND (${onlyMessageId ?? null}::uuid IS NULL OR id = ${onlyMessageId ?? null})
      AND status IN ('queued', 'retry_wait')
      AND (purpose = 'marketing'
           OR (${includeTransactional} AND purpose = 'transactional'))
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

export type GrantConsentInput = {
  phone: string;
  source: string;
  /**
   * Issue #1231 M4. The business scope (brand) this opt-in was collected for.
   * Omitted or `null`: collected for the tenant itself, covering only marketing
   * that names no business scope. The ROUTE authorises the caller for the scope
   * and resolves it against this tenant before this function runs.
   */
  businessScope?: WhatsappBusinessScope | null;
  /**
   * Re-granting over a WITHDRAWN consent silently reverses an opt-out, so it is
   * never the default (security audit F3): the caller must say so explicitly,
   * hold the separate high-risk permission, and cite evidence. A plain grant
   * over a withdrawn row is refused.
   */
  reinstateWithdrawn?: boolean;
  evidenceRef?: string;
};

export type GrantConsentResult =
  | { outcome: "granted"; entry: ConsentEntry; reinstated: boolean }
  | { outcome: "invalid_phone"; reason: string }
  | { outcome: "misconfigured"; reason: string }
  | { outcome: "withdrawn_requires_reinstatement" }
  | {
      outcome: "reinstatement_refused";
      reason: "import_source" | "evidence_required";
    }
  /** Issue #1231 M4. The row already lists {@link WHATSAPP_CONSENT_MAX_SCOPES} brands and this one is not among them. */
  | { outcome: "scope_limit_reached" };

type ExistingConsent = {
  id: string;
  recipient_hash: string;
  status: ConsentStatus;
  business_scopes: unknown;
};

async function findConsents(
  tx: Bun.SQL,
  tenantId: string,
  hashes: RecipientHashes
): Promise<ExistingConsent | undefined> {
  const rows = (await tx`
    SELECT id, recipient_hash, status, business_scopes
    FROM awcms_whatsapp_consents
    WHERE tenant_id = ${tenantId} AND purpose = 'marketing'
      AND recipient_hash = ANY(string_to_array(${hashListParam(hashes)}, ','))
    ORDER BY (status = 'withdrawn') DESC
    LIMIT 1
    FOR UPDATE
  `) as ExistingConsent[];

  return rows[0];
}

/**
 * Records an explicit opt-in. Naturally idempotent for a `granted` row (the
 * unique key is `(tenant, recipient, purpose)`; a retry re-stamps the same row).
 * A `withdrawn` row is NEVER overwritten by an ordinary grant: reinstating it
 * needs `reinstateWithdrawn` plus an evidence reference, is refused for the bulk
 * `import` source, and keeps the withdrawal in `withdrawal_history` so the
 * opt-out stays on the record (the route additionally audits and events it).
 * An existing row keeps the hash it was written under; only a new row is written
 * under the ring's active key.
 *
 * What the grant COVERS (Issue #1231 M4): a `businessScope` is added to the
 * row's brands (a repeat for the same brand re-stamps that one element); no
 * scope sets the unscoped opt-in. A grant never removes another brand from a
 * granted row. A reinstatement replaces the coverage with exactly what the
 * reinstating request names, because the withdrawal ended every earlier one.
 */
export async function grantMarketingConsent(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  input: GrantConsentInput,
  options: { env?: NodeJS.ProcessEnv; correlationId?: string } = {}
): Promise<GrantConsentResult> {
  const ring = parseRecipientHashKeys(options.env);

  if (!ring.ok) {
    return { outcome: "misconfigured", reason: ring.reason };
  }

  const phone = normalizePhoneNumber(
    input.phone,
    resolveWhatsappDefaultCountryCode(options.env)
  );

  if (!phone.valid) {
    return { outcome: "invalid_phone", reason: phone.reason };
  }

  const scope = input.businessScope ?? null;
  const scopeType = scope?.type ?? null;
  const scopeId = scope ? scope.id.toLowerCase() : null;
  const unscoped = scope === null;
  const hashes = buildRecipientHashes(tenantId, phone.e164, ring);
  const masked = maskRecipient(phone.e164);
  let existing = await findConsents(tx, tenantId, hashes);
  let reinstated = false;
  let row: ConsentRow | undefined;

  if (!existing) {
    row = (
      (await tx`
        INSERT INTO awcms_whatsapp_consents
          (tenant_id, recipient_hash, recipient_masked, purpose, status, source,
           created_by, unscoped_granted, business_scopes)
        VALUES (${tenantId}, ${hashes.primary}, ${masked}, 'marketing',
                'granted', ${input.source}, ${actorTenantUserId}, ${unscoped},
                CASE WHEN ${scopeType}::text IS NULL THEN '[]'::jsonb
                  ELSE jsonb_build_array(jsonb_build_object(
                    'type', ${scopeType}::text, 'id', ${scopeId}::text,
                    'source', ${input.source}::text,
                    'grantedAt', to_char(now() AT TIME ZONE 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
                END)
        ON CONFLICT ON CONSTRAINT awcms_whatsapp_consents_recipient_unique
        DO NOTHING
        RETURNING id, recipient_masked, purpose, status, source, granted_at,
                  withdrawn_at, business_scopes, unscoped_granted
      `) as ConsentRow[]
    )[0];

    if (!row) {
      // Lost an insert race to a concurrent grant or opt-out: that row is the
      // consent (now locked), and this request is decided against it below.
      existing = await findConsents(tx, tenantId, hashes);

      if (!existing) {
        throw new Error("WhatsApp consent grant conflicted but found no row.");
      }
    }
  }

  if (!row && existing && existing.status === "granted") {
    if (scope !== null) {
      const listed = toScopeGrants(existing.business_scopes);
      const already = listed.some(
        (grant) => grant.type === scopeType && grant.id === scopeId
      );

      if (!already && listed.length >= WHATSAPP_CONSENT_MAX_SCOPES) {
        return { outcome: "scope_limit_reached" };
      }
    }

    // Row-level `source`/`granted_at` describe the tenant-level opt-in (the
    // first recording, or the latest unscoped grant): a BRAND grant leaves them
    // as they are and carries its own provenance inside `business_scopes`
    // (#1231 audit L-3). `status = 'granted'` in the WHERE: a withdrawal that
    // commits first makes this a clean "withdrawn" answer below, never the
    // `sql/354` CHECK.
    row = (
      (await tx`
        UPDATE awcms_whatsapp_consents
        SET source = CASE WHEN ${unscoped} THEN ${input.source} ELSE source END,
            granted_at = CASE WHEN ${unscoped} THEN now() ELSE granted_at END,
            updated_at = now(),
            unscoped_granted = CASE WHEN ${unscoped} THEN true
                                    ELSE unscoped_granted END,
            business_scopes = CASE WHEN ${scopeType}::text IS NULL
              THEN business_scopes
              ELSE (
                SELECT COALESCE(jsonb_agg(element), '[]'::jsonb)
                FROM jsonb_array_elements(business_scopes) AS element
                WHERE NOT (element->>'type' = ${scopeType}::text
                           AND element->>'id' = ${scopeId}::text)
              ) || jsonb_build_array(jsonb_build_object(
                'type', ${scopeType}::text, 'id', ${scopeId}::text,
                'source', ${input.source}::text,
                'grantedAt', to_char(now() AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
            END
        WHERE tenant_id = ${tenantId} AND id = ${existing.id}
          AND status = 'granted'
        RETURNING id, recipient_masked, purpose, status, source, granted_at,
                  withdrawn_at, business_scopes, unscoped_granted
      `) as ConsentRow[]
    )[0];

    if (!row) {
      // Withdrawn under us: an opt-out is never granted over implicitly.
      return { outcome: "withdrawn_requires_reinstatement" };
    }
  } else if (!row && existing) {
    if (!input.reinstateWithdrawn) {
      return { outcome: "withdrawn_requires_reinstatement" };
    }

    if (input.source === "import") {
      return { outcome: "reinstatement_refused", reason: "import_source" };
    }

    const evidence = input.evidenceRef?.trim() ?? "";

    if (evidence.length < 1 || evidence.length > 200) {
      return { outcome: "reinstatement_refused", reason: "evidence_required" };
    }

    reinstated = true;
    row = (
      (await tx`
        UPDATE awcms_whatsapp_consents
        SET status = 'granted', source = ${input.source}, granted_at = now(),
            withdrawal_history = withdrawal_history || jsonb_build_array(
              jsonb_build_object(
                'withdrawnAt', withdrawn_at,
                'withdrawnBy', withdrawn_by,
                'reinstatedAt', now(),
                'reinstatedBy', ${actorTenantUserId}::text,
                'evidenceRef', ${evidence}::text,
                'source', ${input.source}::text,
                'businessScope', CASE WHEN ${scopeType}::text IS NULL THEN NULL
                  ELSE jsonb_build_object('type', ${scopeType}::text,
                                          'id', ${scopeId}::text) END)),
            unscoped_granted = ${unscoped},
            business_scopes = CASE WHEN ${scopeType}::text IS NULL
              THEN '[]'::jsonb
              ELSE jsonb_build_array(jsonb_build_object(
                'type', ${scopeType}::text, 'id', ${scopeId}::text,
                'source', ${input.source}::text,
                'grantedAt', to_char(now() AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
            END,
            withdrawn_at = NULL, withdrawn_by = NULL, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${existing.id}
          AND status = 'withdrawn'
        RETURNING id, recipient_masked, purpose, status, source, granted_at,
                  withdrawn_at, business_scopes, unscoped_granted
      `) as ConsentRow[]
    )[0];

    if (!row) {
      // Reinstated by a concurrent request first: the row is granted now, so
      // this request is decided as an ordinary grant against it.
      return grantMarketingConsent(
        tx,
        tenantId,
        actorTenantUserId,
        { ...input, reinstateWithdrawn: false },
        options
      );
    }
  }

  if (!row) {
    throw new Error("WhatsApp consent grant wrote no row.");
  }

  const entry = toConsent(row);

  await emitWhatsappConsentEvent(
    tx,
    tenantId,
    WHATSAPP_CONSENT_GRANTED_EVENT_TYPE,
    {
      consentId: entry.id,
      purpose: entry.purpose,
      recipientMasked: entry.recipientMasked,
      businessScope:
        scopeType !== null && scopeId !== null
          ? { type: scopeType, id: scopeId }
          : null,
      correlationId: options.correlationId ?? null,
      actorTenantUserId
    }
  );

  return { outcome: "granted", entry, reinstated };
}

export type WithdrawConsentResult =
  | {
      outcome: "withdrawn";
      entry: ConsentEntry;
      cancelledMessages: number;
      /** Issue #1231 M4. The brands the row covered just before this withdrawal (for the audit record); empty on a repeat. */
      withdrawnBusinessScopes: WhatsappBusinessScope[];
    }
  | { outcome: "not_found" };

/**
 * Cancels waiting messages for a recipient known only by the hash stored on a
 * consent row. Same-key messages match in SQL; when the ring holds several keys
 * a message written under another key is found by re-hashing its own number in
 * memory (bounded scan), because the consent row has no number to hash.
 */
async function cancelWaitingForStoredHash(
  tx: Bun.SQL,
  tenantId: string,
  storedHash: string,
  ring: RecipientKeyRing,
  includeTransactional: boolean,
  failureCode: string
): Promise<number> {
  let cancelled = await cancelWaitingMessagesForRecipient(
    tx,
    tenantId,
    { primary: storedHash, all: [storedHash] },
    includeTransactional,
    failureCode
  );

  if (ring.ok && ring.keys.length > 1) {
    const waiting = (await tx`
      SELECT id, recipient FROM awcms_whatsapp_messages
      WHERE tenant_id = ${tenantId} AND status IN ('queued', 'retry_wait')
        AND (purpose = 'marketing'
             OR (${includeTransactional} AND purpose = 'transactional'))
        AND recipient_hash <> ${storedHash}
      LIMIT 5000
    `) as { id: string; recipient: string }[];
    const matching = waiting.filter((row) =>
      buildRecipientHashes(tenantId, row.recipient, ring).all.includes(
        storedHash
      )
    );

    for (const row of matching) {
      cancelled += await cancelWaitingMessagesForRecipient(
        tx,
        tenantId,
        { primary: storedHash, all: [storedHash] },
        includeTransactional,
        failureCode,
        row.id
      );
    }
  }

  return cancelled;
}

export async function withdrawMarketingConsent(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  consentId: string,
  options: { correlationId?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<WithdrawConsentResult> {
  // Tenant-wide, every brand at once (Issue #1231 M4): the brands and the
  // unscoped opt-in are cleared in the same statement (the `sql/354` CHECK
  // holds it), so a later reinstatement cannot resurrect any of them. The prior
  // coverage is returned for the audit record only.
  const rows = (await tx`
    WITH prior AS (
      SELECT id, business_scopes AS prior_scopes
      FROM awcms_whatsapp_consents
      WHERE tenant_id = ${tenantId} AND id = ${consentId}
      FOR UPDATE
    )
    UPDATE awcms_whatsapp_consents AS c
    SET status = 'withdrawn', withdrawn_at = COALESCE(c.withdrawn_at, now()),
        withdrawn_by = COALESCE(c.withdrawn_by, ${actorTenantUserId}),
        business_scopes = '[]'::jsonb,
        unscoped_granted = CASE WHEN c.unscoped_granted IS NULL THEN NULL
                                ELSE false END,
        updated_at = now()
    FROM prior
    WHERE c.tenant_id = ${tenantId} AND c.id = prior.id
    RETURNING c.id, c.recipient_hash, c.recipient_masked, c.purpose, c.status,
              c.source, c.granted_at, c.withdrawn_at, c.business_scopes,
              c.unscoped_granted, prior.prior_scopes
  `) as (ConsentRow & { recipient_hash: string; prior_scopes: unknown })[];

  const row = rows[0];

  if (!row) {
    return { outcome: "not_found" };
  }

  // Opt-out is immediate and wins over everything queued (ADR-0133 section 4).
  // If the ring is unusable the dispatch-time re-check (which also needs the
  // ring) refuses to send, so the opt-out still holds.
  const cancelledMessages = await cancelWaitingForStoredHash(
    tx,
    tenantId,
    row.recipient_hash,
    parseRecipientHashKeys(options.env),
    false,
    "consent_withdrawn"
  );
  const entry = toConsent(row);

  await emitWhatsappConsentEvent(
    tx,
    tenantId,
    WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE,
    {
      consentId: entry.id,
      purpose: entry.purpose,
      recipientMasked: entry.recipientMasked,
      correlationId: options.correlationId ?? null,
      actorTenantUserId
    }
  );

  return {
    outcome: "withdrawn",
    entry,
    cancelledMessages,
    withdrawnBusinessScopes: toScopeGrants(row.prior_scopes).map(
      ({ type, id }) => ({ type, id })
    )
  };
}

export type ListPage<T> = { entries: T[]; hasMore: boolean };

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), WHATSAPP_LIST_MAX_LIMIT);
}

export async function listConsents(
  tx: Bun.SQL,
  tenantId: string,
  options: { status?: ConsentStatus; limit?: number } = {}
): Promise<ListPage<ConsentEntry>> {
  const limit = clampLimit(options.limit);
  const rows = (await tx`
    SELECT id, recipient_masked, purpose, status, source, granted_at,
           withdrawn_at, business_scopes, unscoped_granted
    FROM awcms_whatsapp_consents
    WHERE tenant_id = ${tenantId}
      AND (${options.status ?? null}::text IS NULL OR status = ${options.status ?? null})
    ORDER BY updated_at DESC, id
    LIMIT ${limit + 1}
  `) as ConsentRow[];

  return {
    entries: rows.slice(0, limit).map(toConsent),
    hasMore: rows.length > limit
  };
}

export async function listSuppressions(
  tx: Bun.SQL,
  tenantId: string,
  options: { limit?: number } = {}
): Promise<ListPage<SuppressionEntry>> {
  const limit = clampLimit(options.limit);
  const rows = (await tx`
    SELECT id, recipient_masked, reason, created_at
    FROM awcms_whatsapp_suppressions
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC, id
    LIMIT ${limit + 1}
  `) as SuppressionRow[];

  return {
    entries: rows.slice(0, limit).map(toSuppression),
    hasMore: rows.length > limit
  };
}

export type CreateSuppressionResult =
  | {
      outcome: "created" | "already_suppressed";
      entry: SuppressionEntry;
      cancelledMessages: number;
    }
  | { outcome: "invalid_phone"; reason: string }
  | { outcome: "misconfigured"; reason: string };

/**
 * Naturally idempotent: suppressing an already suppressed number (under ANY ring
 * key) is a safe no-op that reports the existing entry. A `manual` or
 * `stop_reply` entry cancels waiting transactional and marketing messages but
 * never a `security` one (honours hard failures only, ADR-0133 section 4).
 */
export async function createSuppression(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  input: { phone: string; reason: SuppressionReason },
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<CreateSuppressionResult> {
  const ring = parseRecipientHashKeys(options.env);

  if (!ring.ok) {
    return { outcome: "misconfigured", reason: ring.reason };
  }

  const phone = normalizePhoneNumber(
    input.phone,
    resolveWhatsappDefaultCountryCode(options.env)
  );

  if (!phone.valid) {
    return { outcome: "invalid_phone", reason: phone.reason };
  }

  const hashes = buildRecipientHashes(tenantId, phone.e164, ring);
  const existing = (await tx`
    SELECT id, recipient_masked, reason, created_at
    FROM awcms_whatsapp_suppressions
    WHERE tenant_id = ${tenantId}
      AND recipient_hash = ANY(string_to_array(${hashListParam(hashes)}, ','))
    LIMIT 1
  `) as SuppressionRow[];

  if (existing[0]) {
    return {
      outcome: "already_suppressed",
      entry: toSuppression(existing[0]),
      cancelledMessages: 0
    };
  }

  const inserted = (await tx`
    INSERT INTO awcms_whatsapp_suppressions
      (tenant_id, recipient_hash, recipient_masked, reason, created_by)
    VALUES (${tenantId}, ${hashes.primary}, ${maskRecipient(phone.e164)},
            ${input.reason}, ${actorTenantUserId})
    ON CONFLICT ON CONSTRAINT awcms_whatsapp_suppressions_recipient_unique
    DO NOTHING
    RETURNING id, recipient_masked, reason, created_at
  `) as SuppressionRow[];

  if (inserted.length === 0) {
    const raced = (await tx`
      SELECT id, recipient_masked, reason, created_at
      FROM awcms_whatsapp_suppressions
      WHERE tenant_id = ${tenantId} AND recipient_hash = ${hashes.primary}
    `) as SuppressionRow[];

    return {
      outcome: "already_suppressed",
      entry: toSuppression(raced[0]!),
      cancelledMessages: 0
    };
  }

  const cancelledMessages = await cancelWaitingMessagesForRecipient(
    tx,
    tenantId,
    hashes,
    true,
    "suppressed"
  );

  return {
    outcome: "created",
    entry: toSuppression(inserted[0]!),
    cancelledMessages
  };
}

/** Records the provider's "this number cannot receive WhatsApp" verdict. Dispatcher-only. Written under the ACTIVE key; an existing row under any ring key is left as it is. */
export async function recordHardFailureSuppression(
  tx: Bun.SQL,
  tenantId: string,
  hashes: RecipientHashes,
  recipientMasked: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_whatsapp_suppressions
      (tenant_id, recipient_hash, recipient_masked, reason)
    SELECT ${tenantId}, ${hashes.primary}, ${recipientMasked}, 'hard_failure'
    WHERE NOT EXISTS (
      SELECT 1 FROM awcms_whatsapp_suppressions
      WHERE tenant_id = ${tenantId}
        AND recipient_hash = ANY(string_to_array(${hashListParam(hashes)}, ','))
    )
    ON CONFLICT ON CONSTRAINT awcms_whatsapp_suppressions_recipient_unique
    DO NOTHING
  `;
}

export async function deleteSuppression(
  tx: Bun.SQL,
  tenantId: string,
  suppressionId: string
): Promise<{ reason: SuppressionReason } | null> {
  const rows = (await tx`
    DELETE FROM awcms_whatsapp_suppressions
    WHERE tenant_id = ${tenantId} AND id = ${suppressionId}
    RETURNING reason
  `) as { reason: SuppressionReason }[];

  return rows[0] ? { reason: rows[0].reason } : null;
}
