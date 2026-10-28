/**
 * Concrete `CommissionIntakePort` (Issue #1189, ADR-0147, ADR-0011) — the seam an
 * event-driven consumer binds to at ITS composition root.
 *
 * Deliberately thin, like `hr-commission-accrual-port-adapter.ts`: it delegates to
 * the store, which validates with the ledger's own validators, reads the tenant's
 * switch and writes one intake row. It performs no access check and writes no
 * audit row; the contract that puts that duty on the registration of the consumer
 * and on the tenant's switch is `_shared/ports/commission-intake-port.ts`.
 */
import type { CommissionIntakePort } from "../../_shared/ports/commission-intake-port";
import {
  submitAccrualIntent,
  submitVoidIntent
} from "./hr-commission-intake-store";

export function createCommissionIntakePort(): CommissionIntakePort {
  return {
    submitAccrual: (tx, tenantId, actorTenantUserId, request) =>
      submitAccrualIntent(tx, tenantId, actorTenantUserId, request),
    submitVoid: (tx, tenantId, actorTenantUserId, request) =>
      submitVoidIntent(tx, tenantId, actorTenantUserId, request)
  };
}
