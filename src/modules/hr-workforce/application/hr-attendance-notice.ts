/**
 * Tell the requester how an attendance correction ended (#1044, follow-up to
 * #998). Called by the settler consumer (`hr-attendance-settlement.ts`) right
 * after a successful automatic settlement.
 *
 * ## Never on the settlement path
 *
 * Nothing here calls a provider. The port's `enqueueNotification` is a plain
 * INSERT into the e-mail outbox in the consumer's own transaction; `bun run
 * email:dispatch` sends it later, outside any transaction (AGENTS.md: external
 * delivery goes through the outbox). And a notification that cannot be queued
 * never costs the settlement: the call runs in a savepoint and a failure is
 * logged (class and code only) and swallowed -- the correction is settled, the
 * requester just is not told, which is what #998 already was.
 *
 * ## What the message carries
 *
 * The outcome (as WHICH template is used, so each outcome is translated whole),
 * the employee's display name, and the date. NEVER the correction's reason: this
 * file does not read that column (the worker has no SELECT on it, sql/280), and
 * the per-category variable allow-list of the e-mail templates has no slot for it.
 *
 * ## One notice per (correction, outcome)
 *
 * Two guards do the work. (1) Only the transition `pending -> settled`
 * notifies, and it happens once: a redelivered or second event finds the
 * correction already settled (`already_settled`) and never reaches this file.
 * (2) The runtime wraps the consumer in the per-(consumer, event) effect ledger,
 * so a retried delivery of the SAME event is a no-op. The outbox row also
 * carries the deterministic correlation id
 * `hr_workforce.attendance_correction:<id>:<outcome>`, but that is a LABEL for
 * finding the row, not a uniqueness guarantee: `awcms_email_messages` has no
 * unique key on it, and nothing here relies on one.
 *
 * ## Channel
 *
 * E-mail only. A tenant turns it on by having the three
 * `hr.attendance_correction_*` templates active (`email:templates:seed-defaults`);
 * with none the port is a silent no-op. Telegram is not wired: its templates are
 * registered by module scope in the process that imports them and the dispatcher
 * is a different process, and its variable kinds cannot carry an employee name.
 * WhatsApp has no staff-phone resolver. Both are left for a follow-up.
 */
import { log } from "../../../lib/logging/logger";
import type { WorkflowNotificationPort } from "../../_shared/ports/workflow-notification-port";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";

export type CorrectionNoticeOutcome = "applied" | "rejected" | "cancelled";

/** The e-mail template (and category) per outcome. */
export const CORRECTION_NOTICE_TEMPLATE_KEYS: Readonly<
  Record<CorrectionNoticeOutcome, string>
> = {
  applied: "hr.attendance_correction_applied",
  rejected: "hr.attendance_correction_rejected",
  cancelled: "hr.attendance_correction_cancelled"
};

/** `approved` -> applied, `rejected` -> rejected, `withdrawn` -> cancelled; anything else is not a settlement. */
export function noticeOutcomeForStatus(
  status: string
): CorrectionNoticeOutcome | null {
  switch (status) {
    case "approved":
      return "applied";
    case "rejected":
      return "rejected";
    case "withdrawn":
      return "cancelled";
    default:
      return null;
  }
}

export function correctionNoticeCorrelationId(
  correctionId: string,
  outcome: CorrectionNoticeOutcome
): string {
  return `${HR_WORKFORCE_MODULE_KEY}.attendance_correction:${correctionId}:${outcome}`;
}

/** The calendar date (UTC) of an instant, `YYYY-MM-DD`. The mail says so. */
export function formatCorrectionDate(instant: Date | string): string {
  return new Date(instant).toISOString().slice(0, 10);
}

type NoticeRow = {
  requested_by: string;
  proposed_occurred_at: Date | string;
  employee_name: string | null;
};

/**
 * Queue the notice for a correction that was just settled to `status`.
 * Returns `true` when a request was handed to the port (the port itself no-ops
 * when the tenant has no active template or the requester cannot be mailed).
 */
export async function notifyRequesterOfSettlement(
  tx: Bun.TransactionSQL,
  tenantId: string,
  correctionId: string,
  status: string,
  port: WorkflowNotificationPort
): Promise<boolean> {
  const outcome = noticeOutcomeForStatus(status);

  if (!outcome) {
    return false;
  }

  try {
    // A savepoint: a throw rolls back the notice alone, never the settlement.
    return await tx.savepoint(async (savepoint) => {
      const sp = savepoint as unknown as Bun.TransactionSQL;
      const rows = (await sp`
        SELECT c.requested_by, c.proposed_occurred_at,
               p.display_name AS employee_name
        FROM awcms_hr_attendance_corrections c
        JOIN awcms_hr_employments e
          ON e.tenant_id = c.tenant_id AND e.id = c.employment_id
        LEFT JOIN awcms_profiles p
          ON p.tenant_id = e.tenant_id AND p.id = e.profile_id
        WHERE c.tenant_id = ${tenantId} AND c.id = ${correctionId}
      `) as NoticeRow[];
      const row = rows[0];

      if (!row) {
        return false;
      }

      await port.enqueueNotification(sp, {
        tenantId,
        templateKey: CORRECTION_NOTICE_TEMPLATE_KEYS[outcome],
        recipientTenantUserIds: [row.requested_by],
        variables: {
          // Display name only. Never the reason, the employee number or a contact.
          employeeName: row.employee_name ?? "",
          correctionDate: formatCorrectionDate(row.proposed_occurred_at)
        },
        correlationId: correctionNoticeCorrelationId(correctionId, outcome)
      });

      return true;
    });
  } catch (error) {
    // Class and code only: the message text of a database error can carry a value.
    const code = (error as { code?: unknown } | null)?.code;

    log("warning", "hr_workforce.attendance_correction.notice_failed", {
      tenantId,
      moduleKey: HR_WORKFORCE_MODULE_KEY,
      correctionId,
      errorClass:
        error instanceof Error ? error.constructor.name : typeof error,
      ...(typeof code === "string" ? { errorCode: code } : {})
    });

    return false;
  }
}
