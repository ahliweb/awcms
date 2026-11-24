/**
 * Translated labels for the closed vocabularies of `/admin/email-webhooks` and
 * `/admin/email-queue` (Issue #1162): callback status, provider event type,
 * bounce class, review status and queue message status.
 *
 * Every value is a code from the application function or the database, never
 * prose, so `t()` cannot translate it in place
 * (`docs/awcms/14_ui_ux_design_system.md` "No raw enums"). An unrecognised value
 * falls back to the raw token, never a crash or a blank cell.
 */
import type { Translator } from "../catalog";
import type { StatusTone } from "./channel-accounts";

type T = Translator["t"];

export function callbackStatusLabel(t: T, value: string): string {
  switch (value) {
    case "pending":
      return t("Waiting for the first event");
    case "active":
      return t("Active");
    case "paused":
      return t("Paused");
    case "revoked":
      return t("Revoked");
    default:
      return value;
  }
}

export function callbackStatusTone(value: string): StatusTone {
  switch (value) {
    case "active":
      return "success";
    case "pending":
      return "info";
    case "paused":
      return "warning";
    default:
      return "neutral";
  }
}

export function providerEventTypeLabel(t: T, value: string): string {
  switch (value) {
    case "bounce":
      return t("Bounce");
    case "unsubscribe":
      return t("Unsubscribe");
    case "open":
      return t("Open");
    case "click":
      return t("Click");
    case "delivered":
      return t("Delivered");
    default:
      return value;
  }
}

export function bounceClassLabel(t: T, value: string): string {
  switch (value) {
    case "hard":
      return t("Hard bounce");
    case "soft":
      return t("Soft bounce");
    case "unknown":
      return t("Unclassified bounce");
    default:
      return value;
  }
}

export function reviewStatusLabel(t: T, value: string): string {
  switch (value) {
    case "pending":
      return t("Awaiting review");
    case "confirmed":
      return t("Confirmed");
    case "dismissed":
      return t("Dismissed");
    case "informational":
      return t("Informational");
    default:
      return value;
  }
}

export function reviewStatusTone(value: string): StatusTone {
  switch (value) {
    case "pending":
      return "warning";
    case "confirmed":
      return "success";
    default:
      return "neutral";
  }
}

export function messageStatusLabel(t: T, value: string): string {
  switch (value) {
    case "queued":
      return t("Queued");
    case "sending":
      return t("Sending");
    case "sent":
      return t("Sent");
    case "failed":
      return t("Failed");
    case "retry_wait":
      return t("Waiting to retry");
    case "cancelled":
      return t("Cancelled");
    case "suppressed":
      return t("Suppressed");
    default:
      return value;
  }
}

export function messageStatusTone(value: string): StatusTone {
  switch (value) {
    case "sent":
      return "success";
    case "failed":
      return "danger";
    case "retry_wait":
      return "warning";
    case "queued":
    case "sending":
      return "info";
    default:
      return "neutral";
  }
}

/** Whether `POST /email/messages/{id}/cancel` can still stop the message (`queued`, `retry_wait`). */
export function isCancellableMessageStatus(value: string): boolean {
  return value === "queued" || value === "retry_wait";
}
