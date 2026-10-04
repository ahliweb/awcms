/**
 * Bounds a caller-stated tax date against the SERVER's date (ADR-0127 §6).
 *
 * Inside the window (default 7 days back, 1 forward) any caller holding the
 * route's own permission may state it. Outside it, the caller must ALSO hold
 * `tax.snapshots.backdate` — checked through the one chokepoint
 * (`authorizeInTransaction`, so the decision log records it) — and is refused with
 * its own error code otherwise. It is never accepted silently.
 *
 * "Today" is `now()` from the database, in UTC: not the application node's clock,
 * which a skewed or hostile host could move, and not the session time zone.
 */
import { fail } from "../../_shared/api-response";
import { resolveClientIp } from "../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import {
  isWithinTaxDateWindow,
  resolveTaxDateWindow,
  type TaxDateWindow
} from "../domain/tax-config";
import {
  TAX_MODULE_KEY,
  TAX_SNAPSHOTS_ACTIVITY_CODE
} from "../domain/tax-permissions";

/** The server's UTC date, and `taxDate` minus it in whole days. */
export async function taxDateOffset(
  tx: Bun.SQL,
  taxDate: string
): Promise<{ serverDate: string; offsetDays: number }> {
  const rows = (await tx`
    SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS server_date,
           (${taxDate}::date - (now() AT TIME ZONE 'UTC')::date)::int AS offset_days
  `) as { server_date: string; offset_days: number }[];

  return {
    serverDate: rows[0]!.server_date,
    offsetDays: Number(rows[0]!.offset_days)
  };
}

export type TaxDateGuardResult =
  { ok: true; backdated: boolean } | { ok: false; response: Response };

export async function guardTaxDate(
  context: {
    tx: Bun.SQL;
    tenantId: string;
    tokenHash: string;
    now: Date;
    request: Request;
    clientAddress: string | undefined;
  },
  taxDate: string,
  window: TaxDateWindow = resolveTaxDateWindow()
): Promise<TaxDateGuardResult> {
  const { offsetDays, serverDate } = await taxDateOffset(context.tx, taxDate);

  if (isWithinTaxDateWindow(offsetDays, window)) {
    return { ok: true, backdated: false };
  }

  const decision = await authorizeInTransaction(
    context.tx,
    context.tenantId,
    context.tokenHash,
    context.now,
    {
      moduleKey: TAX_MODULE_KEY,
      activityCode: TAX_SNAPSHOTS_ACTIVITY_CODE,
      action: "backdate"
    },
    { clientIp: resolveClientIp(context.request, context.clientAddress) }
  );

  if (!decision.allowed) {
    return {
      ok: false,
      response: fail(
        403,
        "TAX_BACKDATE_PERMISSION_REQUIRED",
        `taxDate ${taxDate} is outside the window of ${window.pastDays} day(s) back and ${window.forwardDays} day(s) forward of the server date ${serverDate}; tax.snapshots.backdate is required.`
      )
    };
  }

  return { ok: true, backdated: true };
}
