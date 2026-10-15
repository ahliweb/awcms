/**
 * Labels shared by the booking admin screens (Issue #942): a closed enum is
 * never rendered raw (the `awcms-i18n` rule), so every reservation status and
 * history kind goes through one translated map, and the raw value stays in a
 * `data-*` attribute for tests.
 */
import type { Translator } from "./i18n";

export type PillTone =
  "success" | "warning" | "danger" | "info" | "neutral" | "primary";

export const RESERVATION_STATUSES = [
  "held",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
  "expired"
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function reservationStatusLabels(
  t: Translator["t"]
): Record<ReservationStatus, string> {
  return {
    held: t("Held"),
    confirmed: t("Confirmed"),
    checked_in: t("Checked in"),
    completed: t("Completed"),
    cancelled: t("Cancelled"),
    rescheduled: t("Rescheduled"),
    no_show: t("No-show"),
    expired: t("Expired")
  };
}

export const RESERVATION_STATUS_TONE: Record<ReservationStatus, PillTone> = {
  held: "warning",
  confirmed: "success",
  checked_in: "info",
  completed: "neutral",
  cancelled: "danger",
  rescheduled: "neutral",
  no_show: "danger",
  expired: "neutral"
};

export function reservationEventLabels(
  t: Translator["t"]
): Record<string, string> {
  return {
    created: t("Created"),
    held: t("Hold placed"),
    confirmed: t("Confirmed"),
    rescheduled: t("Rescheduled"),
    cancelled: t("Cancelled"),
    checked_in: t("Checked in"),
    completed: t("Completed"),
    no_show: t("Marked as no-show"),
    expired: t("Hold expired")
  };
}

export function statusLabel(
  labels: Record<ReservationStatus, string>,
  value: string
): string {
  return (labels as Record<string, string>)[value] ?? value;
}

export function statusTone(value: string): PillTone {
  return (
    (RESERVATION_STATUS_TONE as Record<string, PillTone>)[value] ?? "neutral"
  );
}
