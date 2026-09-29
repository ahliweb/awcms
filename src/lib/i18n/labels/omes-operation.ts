/**
 * Translated label for `OperationRequestSummary["status"]` (Issue #861, item
 * 4 of #854).
 *
 * Rendered on TWO admin screens — `src/pages/admin/omes/operations.astro`
 * and `src/pages/admin/omes/backups.astro` (restore requests reuse the same
 * `fetchOperationRequests`/`OperationRequestSummary` from
 * `src/modules/omes-control/application/operation-directory.ts` /
 * `operation-submission.ts`) — so it gets ONE shared helper rather than a
 * copy per screen, per the design decision on #861.
 *
 * `OmesOperationStatus` is declared locally (the module exports no union for
 * it) so the `Record` below stays exhaustive. An unrecognised value falls
 * back to the raw string.
 */
import type { Translator } from "../catalog";

type OmesOperationStatus =
  "requested" | "approved" | "rejected" | "dispatched" | "completed" | "failed";

function isOmesOperationStatus(value: string): value is OmesOperationStatus {
  return (
    value === "requested" ||
    value === "approved" ||
    value === "rejected" ||
    value === "dispatched" ||
    value === "completed" ||
    value === "failed"
  );
}

export function omesOperationStatusLabel(
  t: Translator["t"],
  status: string
): string {
  if (!isOmesOperationStatus(status)) return status;

  const LABELS: Record<OmesOperationStatus, string> = {
    requested: t("Requested"),
    approved: t("Approved"),
    rejected: t("Rejected"),
    dispatched: t("Dispatched"),
    completed: t("Completed"),
    failed: t("Failed")
  };

  return LABELS[status];
}
