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
 *
 * What it returns is MASKED (Issue #1095, contract 2.0.0): the port records no
 * sensitive read, so no amount and no beneficiary leave it. Every result passes
 * through `maskAccrueOutcome` / `maskVoidOutcome`, and the sensitive-read gate
 * refuses this file if it stops calling them.
 */
import type { CommissionAccrualPort } from "../../_shared/ports/commission-accrual-port";
import {
  accrueCommission,
  voidCommissionBySource
} from "./hr-commission-accrual-ledger";
import {
  maskAccrueOutcome,
  maskVoidOutcome
} from "./hr-commission-accrual-receipt";

export function createCommissionAccrualPort(): CommissionAccrualPort {
  return {
    accrue: async (tx, tenantId, actorTenantUserId, request) =>
      maskAccrueOutcome(
        await accrueCommission(tx, tenantId, actorTenantUserId, request)
      ),
    void: async (tx, tenantId, actorTenantUserId, request) =>
      maskVoidOutcome(
        await voidCommissionBySource(tx, tenantId, actorTenantUserId, request)
      )
  };
}
