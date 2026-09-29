/**
 * Translated label for OMES worker-enrollment `status` (Issue #861, item 4 of
 * #854).
 *
 * `status` ("pending" | "enrolled" | "revoked" | "expired",
 * `src/modules/omes-control/application/enrollment-directory.ts`, CHECK in
 * `sql/154`) is rendered on TWO admin screens —
 * `src/pages/admin/omes/servers.astro` (the enrollments nested under a
 * server) and `src/pages/admin/omes/enrollments.astro` — so it gets ONE
 * shared helper rather than a copy per screen, per the design decision on
 * #861.
 *
 * `EnrollmentStatus` is declared locally (the module exports no union for
 * it, the column is `text`) so the `Record` below stays exhaustive. An
 * unrecognised value falls back to the raw string.
 */
import type { Translator } from "../catalog";

type EnrollmentStatus = "pending" | "enrolled" | "revoked" | "expired";

function isEnrollmentStatus(value: string): value is EnrollmentStatus {
  return (
    value === "pending" ||
    value === "enrolled" ||
    value === "revoked" ||
    value === "expired"
  );
}

export function omesEnrollmentStatusLabel(
  t: Translator["t"],
  status: string
): string {
  if (!isEnrollmentStatus(status)) return status;

  const LABELS: Record<EnrollmentStatus, string> = {
    pending: t("Pending"),
    enrolled: t("Enrolled"),
    revoked: t("Revoked"),
    expired: t("Expired")
  };

  return LABELS[status];
}
