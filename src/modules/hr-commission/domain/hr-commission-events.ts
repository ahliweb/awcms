/**
 * `hr_commission` domain-event type/version constants (Issue #1109, ADR-0132;
 * `docs/awcms/hr-payroll.md` section 10).
 *
 * Kept in `domain/` with no imports so the producer, the `domain_event_runtime`
 * registry and the AsyncAPI parity gate reference the same literals (the shape
 * `procurement/domain/procurement-events.ts` set). A payload carries opaque ids,
 * a source TYPE and codes only: never an amount, a base, a rate, a source
 * reference, a payment reference or a name (hr-payroll.md section 10).
 */
export const HR_COMMISSION_EVENT_VERSION = "1.0";

export const HR_COMMISSION_ACCRUAL_VOIDED_EVENT_TYPE =
  "awcms.hr.commission.voided";

export const HR_COMMISSION_ACCRUAL_AGGREGATE_TYPE = "hr_commission.accrual";

export const HR_COMMISSION_EVENT_TYPES = [
  HR_COMMISSION_ACCRUAL_VOIDED_EVENT_TYPE
] as const;
