import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../../lib/database/client";
import { handleMailketingWebhook } from "../../../../../../modules/email/application/mailketing-webhook-handler";
import { tryLoadWebhookSubscriptionDirectory } from "../../../../../../modules/email/infrastructure/channel-account-loaders";

/**
 * `POST /api/v1/email/webhooks/mailketing/{token}` (Issue #1161, ADR-0151
 * section 5, `strict` mode) — Mailketing's delivery callbacks for ONE tenant
 * Mailketing account. Every event is quarantined as UNAUTHENTICATED and
 * changes no state; the order of work (404 when off, a per-address failure
 * bucket charged before any database work and refunded on proof, the token in
 * constant time, a per-callback bucket) is documented in
 * `modules/email/application/mailketing-webhook-handler.ts`.
 */
export const POST: APIRoute = ({ request, params, clientAddress }) =>
  handleMailketingWebhook(request, params.token, clientAddress, {
    getSql: getDatabaseClient,
    loadDirectory: tryLoadWebhookSubscriptionDirectory
  });
