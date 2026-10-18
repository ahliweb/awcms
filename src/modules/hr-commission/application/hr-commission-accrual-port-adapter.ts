/**
 * Concrete `CommissionAccrualPort` (Issue #951, ADR-0132, ADR-0011) — the seam a
 * downstream adapter is wired to at ITS composition root.
 *
 * Deliberately thin: it delegates to the one posting core
 * (`accrueCommission`, which validates with the same validators the HTTP surface
 * uses), so there is no second write path to the ledger. It performs no access
 * check and, for `accrue`, writes no audit row (`void` rides the one transition
 * core, which audits and publishes `awcms.hr.commission.voided`); the contract that puts that duty on the caller
 * is `_shared/ports/commission-accrual-port.ts`.
 */
import type { CommissionAccrualPort } from "../../_shared/ports/commission-accrual-port";
import {
  accrueCommission,
  voidCommissionBySource
} from "./hr-commission-accrual-ledger";

export function createCommissionAccrualPort(): CommissionAccrualPort {
  return {
    accrue: (tx, tenantId, actorTenantUserId, request) =>
      accrueCommission(tx, tenantId, actorTenantUserId, request),
    void: (tx, tenantId, actorTenantUserId, request) =>
      voidCommissionBySource(tx, tenantId, actorTenantUserId, request)
  };
}
