/**
 * `CrmLeadPort` — how a downstream customer authority (for example the
 * `commerce` adapter of a consuming product, `awcms-one` #463) reads a lead's
 * state and records or reverses a conversion in `crm_leads` (Issue #1166,
 * ADR-0153 section 6, ADR-0011).
 *
 * The shape is fixed HERE, in neutral ground: `crm_leads` imports nothing from
 * a downstream product, and an adapter depends on THIS type, never on
 * `crm_leads`' `application/` or `domain/` code.
 *
 * ## Opaque ids only (ADR-0153 L6)
 *
 * The port carries ids, stage categories, source kinds and opaque references.
 * It returns no name, no contact value and no note: a caller that needs them
 * reads the lead through the HTTP surface under its own permission.
 *
 * ## The composition root authorizes and audits
 *
 * Calling the adapter performs NO access check and writes NO audit row. The
 * consumer's composition root MUST authorize its actor through
 * `authorizeInTransaction` against `crm_leads.conversions.approve` before
 * calling `confirmConversion`/`reverseConversion`, and audit the business
 * action. (`POST /api/v1/crm-leads/leads/{id}/conversions` is such a root.)
 *
 * ## Transactions and replay
 *
 * `tx` is the CALLER's tenant-scoped transaction. A replayed confirmation (same
 * `evidenceRef`) is a no-op returning `replayed`; a business refusal is a
 * returned outcome, not an exception, and writes nothing.
 */

export type CrmLeadState = {
  leadId: string;
  pipelineId: string;
  stageKey: string;
  stageCategory:
    "new" | "working" | "qualified" | "converted" | "lost" | "disqualified";
  status: "open" | "merged" | "anonymized";
  mergedIntoLeadId: string | null;
  ownerTenantUserId: string | null;
  firstSourceKind: string | null;
  firstTouchId: string | null;
  externalCustomerRef: string | null;
  version: number;
};

export type CrmLeadConversionRequest = {
  leadId: string;
  /** The version of the lead the authority acted on (optimistic concurrency). */
  expectedVersion: number;
  externalCustomerRef: string;
  /** The replay key. `A-Za-z0-9._:-`, at most 128 characters. */
  evidenceRef: string;
  /** A converted stage of the current revision; omitted = the first one. */
  toStageKey?: string;
  occurredAt: Date;
};

export type CrmLeadConversionOutcome =
  | { outcome: "converted"; conversionId: string }
  | { outcome: "replayed"; conversionId: string }
  | {
      outcome:
        | "not_found"
        | "version_conflict"
        | "not_open"
        | "evidence_reused"
        | "already_converted"
        | "no_converted_stage"
        | "stage_not_found"
        | "transition_not_allowed"
        | "guard_not_met"
        | "input_invalid";
    };

export type CrmLeadReversalRequest = {
  conversionId: string;
  evidenceRef: string;
  occurredAt: Date;
};

export type CrmLeadReversalOutcome =
  | { outcome: "reversed" | "replayed"; conversionId: string }
  | {
      outcome:
        "not_found" | "already_reversed" | "evidence_reused" | "input_invalid";
    };

export interface CrmLeadPort {
  readLeadState(
    tx: Bun.SQL,
    tenantId: string,
    leadId: string
  ): Promise<CrmLeadState | null>;

  confirmConversion(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string,
    request: CrmLeadConversionRequest,
    correlationId?: string | null
  ): Promise<CrmLeadConversionOutcome>;

  reverseConversion(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string,
    request: CrmLeadReversalRequest,
    correlationId?: string | null
  ): Promise<CrmLeadReversalOutcome>;
}
