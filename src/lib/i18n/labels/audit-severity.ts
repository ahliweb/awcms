/**
 * Translated label for audit-log `severity` (Issue #861, item 4 of #854).
 *
 * `severity` (`src/modules/logging/application/audit-log.ts` writes
 * "info" | "warning" | "critical", stored as a plain `text` column) is
 * rendered raw on TWO admin screens — `src/pages/admin/audit-trail.astro` and
 * `src/pages/admin/omes/audit.astro` — which already duplicate a
 * `severityVariant()` badge-colour helper. This label map is the i18n
 * counterpart, shared for the same reason.
 *
 * `AuditSeverity` is declared locally (the module exports no union for it) so
 * the `Record` below stays exhaustive — a new severity added there fails
 * typecheck here until it is given a label. The column itself is `text`, so a
 * value outside the three known ones falls back to the raw string rather than
 * crashing.
 */
import type { Translator } from "../catalog";

type AuditSeverity = "info" | "warning" | "critical";

function isAuditSeverity(value: string): value is AuditSeverity {
  return value === "info" || value === "warning" || value === "critical";
}

export function auditSeverityLabel(
  t: Translator["t"],
  severity: string
): string {
  if (!isAuditSeverity(severity)) return severity;

  const LABELS: Record<AuditSeverity, string> = {
    info: t("Info"),
    warning: t("Warning"),
    critical: t("Critical")
  };

  return LABELS[severity];
}
