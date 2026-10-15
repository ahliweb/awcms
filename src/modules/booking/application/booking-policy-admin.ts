/**
 * The tenant booking policy for the ADMIN surface (Issue #1030, prerequisite of
 * #942; docs/awcms/booking.md sections 4, 6 and 13): the one
 * `awcms_booking_settings` row of a tenant.
 *
 * ## NULL is the module default
 *
 * A column that is `NULL` (or a tenant with no row yet) means "use the module
 * default" -- not "unlimited" (booking.md section 13, N4 of Issue #941). `GET`
 * therefore returns BOTH what the tenant set (`policy`, `null` where unset) and
 * what is in force (`effective`, the tenant value or the module default), so a
 * screen never has to know the defaults. The defaults come from the same
 * constants the allocator and the availability search read.
 *
 * ## The write
 *
 * `PUT` replaces the whole row (see `validatePolicy`) in an upsert keyed on the
 * tenant, stamps `updated_by`, and writes a `critical` audit row holding the
 * before and after values. Every value is a number, a zone name or a local
 * time: no personal data. It changes FUTURE holds and searches only; a live
 * hold keeps the expiry it was given.
 */
import { utcMicrosecondTextSql } from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { HOLD_LIMITS } from "../domain/booking-allocation";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { AVAILABILITY_LIMITS } from "../domain/booking-availability";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import { POLICY_DEFAULTS } from "../domain/booking-policy";
import type { PolicyInput } from "../domain/booking-admin-validation";
import {
  guarded,
  type AdminActor,
  type AdminRefusal,
  type Sql
} from "./booking-admin-support";

export type EffectivePolicy = {
  defaultHoldSeconds: number;
  maxHoldSeconds: number;
  maxActiveHoldsPerCustomer: number;
  maxActiveHoldsPerTenant: number;
  minLeadSeconds: number;
  maxHorizonDays: number;
  noShowGraceSeconds: number;
};

export type PolicyDto = {
  /** What the tenant set; `null` = the module default. */
  policy: PolicyInput;
  /** What is in force: the tenant value, or the module default where it is `null`. */
  effective: EffectivePolicy;
  /** `null` until the tenant first writes a policy. */
  updatedAt: string | null;
};

type PolicyRow = {
  default_hold_seconds: number | null;
  max_hold_seconds: number | null;
  max_active_holds_per_customer: number | null;
  max_active_holds_per_tenant: number | null;
  min_lead_seconds: number | null;
  max_horizon_days: number | null;
  no_show_grace_seconds: number | null;
  default_timezone: string | null;
  default_check_in_time: string | null;
  default_check_out_time: string | null;
  updated_at: string | null;
};

const EMPTY_POLICY: PolicyInput = {
  defaultHoldSeconds: null,
  maxHoldSeconds: null,
  maxActiveHoldsPerCustomer: null,
  maxActiveHoldsPerTenant: null,
  minLeadSeconds: null,
  maxHorizonDays: null,
  noShowGraceSeconds: null,
  defaultTimezone: null,
  defaultCheckInTime: null,
  defaultCheckOutTime: null
};

export function effectivePolicy(policy: PolicyInput): EffectivePolicy {
  const maxHold = Math.min(
    policy.maxHoldSeconds ?? HOLD_LIMITS.maxSeconds,
    HOLD_LIMITS.maxSeconds
  );

  return {
    maxHoldSeconds: maxHold,
    defaultHoldSeconds: Math.min(
      policy.defaultHoldSeconds ?? HOLD_LIMITS.defaultSeconds,
      maxHold
    ),
    maxActiveHoldsPerCustomer:
      policy.maxActiveHoldsPerCustomer ??
      POLICY_DEFAULTS.maxActiveHoldsPerCustomer,
    maxActiveHoldsPerTenant:
      policy.maxActiveHoldsPerTenant ?? POLICY_DEFAULTS.maxActiveHoldsPerTenant,
    minLeadSeconds:
      policy.minLeadSeconds ?? AVAILABILITY_LIMITS.defaultMinLeadSeconds,
    maxHorizonDays:
      policy.maxHorizonDays ?? AVAILABILITY_LIMITS.defaultMaxHorizonDays,
    noShowGraceSeconds:
      policy.noShowGraceSeconds ?? POLICY_DEFAULTS.noShowGraceSeconds
  };
}

function toDto(row: PolicyRow | undefined): PolicyDto {
  const policy: PolicyInput = row
    ? {
        defaultHoldSeconds: row.default_hold_seconds,
        maxHoldSeconds: row.max_hold_seconds,
        maxActiveHoldsPerCustomer: row.max_active_holds_per_customer,
        maxActiveHoldsPerTenant: row.max_active_holds_per_tenant,
        minLeadSeconds: row.min_lead_seconds,
        maxHorizonDays: row.max_horizon_days,
        noShowGraceSeconds: row.no_show_grace_seconds,
        defaultTimezone: row.default_timezone,
        defaultCheckInTime: row.default_check_in_time,
        defaultCheckOutTime: row.default_check_out_time
      }
    : EMPTY_POLICY;

  return {
    policy,
    effective: effectivePolicy(policy),
    updatedAt: row?.updated_at ?? null
  };
}

const POLICY_SELECT = `
  default_hold_seconds, max_hold_seconds, max_active_holds_per_customer,
  max_active_holds_per_tenant, min_lead_seconds, max_horizon_days,
  no_show_grace_seconds, default_timezone,
  to_char(default_check_in_time, 'HH24:MI:SS') AS default_check_in_time,
  to_char(default_check_out_time, 'HH24:MI:SS') AS default_check_out_time,
  ${utcMicrosecondTextSql("updated_at")} AS updated_at`;

export async function getPolicy(tx: Sql, tenantId: string): Promise<PolicyDto> {
  const rows = (await tx`
    SELECT ${tx.unsafe(POLICY_SELECT)}
    FROM awcms_booking_settings WHERE tenant_id = ${tenantId}
  `) as PolicyRow[];

  return toDto(rows[0]);
}

export type PolicyWrite =
  { outcome: "ok"; policy: PolicyDto; replayed: false } | AdminRefusal;

export async function configurePolicy(
  tx: Sql,
  tenantId: string,
  actor: AdminActor,
  input: PolicyInput
): Promise<PolicyWrite> {
  // Serialise writers BEFORE reading the "before" values, so two concurrent PUTs
  // form a coherent before/after chain in the audit log. Transaction-scoped.
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(${`awcms_booking.policy:${tenantId}`}, 0))
  `;

  const before = await getPolicy(tx, tenantId);
  const result = await guarded(tx, "awcms_booking_policy_put", async () => {
    await tx`
      INSERT INTO awcms_booking_settings
        (tenant_id, default_hold_seconds, max_hold_seconds,
         max_active_holds_per_customer, max_active_holds_per_tenant,
         min_lead_seconds, max_horizon_days, no_show_grace_seconds,
         default_timezone, default_check_in_time, default_check_out_time,
         updated_by)
      VALUES (
        ${tenantId}, ${input.defaultHoldSeconds}, ${input.maxHoldSeconds},
        ${input.maxActiveHoldsPerCustomer}, ${input.maxActiveHoldsPerTenant},
        ${input.minLeadSeconds}, ${input.maxHorizonDays},
        ${input.noShowGraceSeconds}, ${input.defaultTimezone},
        ${input.defaultCheckInTime}::time, ${input.defaultCheckOutTime}::time,
        ${actor.actorTenantUserId}
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        default_hold_seconds = EXCLUDED.default_hold_seconds,
        max_hold_seconds = EXCLUDED.max_hold_seconds,
        max_active_holds_per_customer = EXCLUDED.max_active_holds_per_customer,
        max_active_holds_per_tenant = EXCLUDED.max_active_holds_per_tenant,
        min_lead_seconds = EXCLUDED.min_lead_seconds,
        max_horizon_days = EXCLUDED.max_horizon_days,
        no_show_grace_seconds = EXCLUDED.no_show_grace_seconds,
        default_timezone = EXCLUDED.default_timezone,
        default_check_in_time = EXCLUDED.default_check_in_time,
        default_check_out_time = EXCLUDED.default_check_out_time,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
    `;
  });

  if (!result.ok) {
    return result.refusal;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId,
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.policyConfigured.action,
    resourceType: "booking_policy",
    resourceId: tenantId,
    severity: BOOKING_AUDIT_EVENTS.policyConfigured.severity,
    message: "Booking policy configured.",
    attributes: { before: before.policy, after: input },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    policy: await getPolicy(tx, tenantId),
    replayed: false
  };
}
