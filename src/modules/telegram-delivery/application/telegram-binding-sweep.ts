/**
 * The binding eligibility sweep (Issue #965, ADR-0140 sections 2 and 3; audit M3).
 *
 * A binding holds an encrypted chat id for as long as it is live. Three things
 * can make it ineligible without anyone revoking it, and none of them touches a
 * Telegram row, so nothing else would ever notice:
 *
 * 1. the **tenant gate** closed: Module Management switched the module off, or
 *    the audited tenant setting is off;
 * 2. the **person left**: the tenant user or its identity is no longer active, or
 *    it holds no role grant in force (`awcms_telegram_principal_active`,
 *    `sql/217`);
 * 3. the **confirmation window** of a `pending_confirmation` binding passed.
 *
 * Each ends the binding through the one revocation path (`endBindings`), which
 * erases the ciphertext in the same statement. The sweep runs from BOTH the
 * dispatcher (every pass, so the effect is within a minute) and the nightly
 * purge, and the purge runs whether or not `TELEGRAM_ENABLED` is on and whether
 * or not the module is on for the tenant. That second caller is the point: a
 * deployment that turned Telegram off, or a tenant that disabled the module,
 * would otherwise keep every staff member's chat id for as long as nobody
 * dispatched.
 *
 * It runs in the caller's tenant transaction as `awcms_worker`; the two definer
 * functions it uses answer one boolean each and obey the tenant's RLS.
 */
import {
  auditEndedBindings,
  endBindings,
  expirePendingBindings
} from "./telegram-bindings";
import {
  isTenantGateOpen,
  readTelegramTenantGateForWorker
} from "./telegram-settings";

/** Bounds one sweep; a tenant with more live bindings than this is finished by the next run. */
const SWEEP_BATCH_LIMIT = 1000;

export type BindingSweepResult = {
  /** False when the module or the tenant setting is off (every live binding was ended). */
  gateOpen: boolean;
  /** Bindings ended because the gate is closed. */
  endedByGate: number;
  /** Bindings ended because the person is deactivated or holds no role. */
  endedByPrincipal: number;
  /** Pending bindings ended because their confirmation window passed. */
  expiredPending: number;
};

export async function sweepIneligibleBindings(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  context: { correlationId?: string } = {}
): Promise<BindingSweepResult> {
  const result: BindingSweepResult = {
    gateOpen: true,
    endedByGate: 0,
    endedByPrincipal: 0,
    expiredPending: 0
  };
  const gate = await readTelegramTenantGateForWorker(tx, tenantId);

  if (!isTenantGateOpen(gate)) {
    // A suspended or inactive tenant keeps no stored chat id, whatever its switches say.
    const cause =
      gate.tenantActive === false
        ? "tenant_suspended"
        : gate.moduleEnabled
          ? "tenant_disabled"
          : "module_disabled";
    const ended = await endBindings(tx, tenantId, { all: true }, cause);

    await auditEndedBindings(tx, tenantId, ended, cause, context);

    return { ...result, gateOpen: false, endedByGate: ended.ended.length };
  }

  result.expiredPending = await expirePendingBindings(
    tx,
    tenantId,
    now,
    context
  );

  const departed = (await tx`
    SELECT b.id
    FROM awcms_telegram_bindings AS b
    WHERE b.tenant_id = ${tenantId}
      AND b.status IN ('pending_confirmation', 'active')
      AND NOT awcms_telegram_principal_active(${tenantId}::uuid, b.principal_id)
    ORDER BY b.created_at, b.id
    LIMIT ${SWEEP_BATCH_LIMIT}
  `) as { id: string }[];

  if (departed.length > 0) {
    const ended = await endBindings(
      tx,
      tenantId,
      { bindingIds: departed.map((row) => row.id) },
      "principal_deactivated"
    );

    await auditEndedBindings(
      tx,
      tenantId,
      ended,
      "principal_deactivated",
      context
    );
    result.endedByPrincipal = ended.ended.length;
  }

  return result;
}
