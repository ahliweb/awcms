/**
 * The Meta Cloud API webhook of `whatsapp_delivery` (Issue #1143, ADR-0148 I9).
 *
 * One short tenant transaction per request, opened for the tenant the CALLBACK
 * TOKEN names (never the payload):
 *
 *   1. `channel_accounts` verifies the request (token hash, active HMAC
 *      subscription, live Meta number with a live WABA container,
 *      `X-Hub-Signature-256` over the exact bytes). Any refusal is one answer.
 *   2. The body hash is recorded per subscription; a body seen before (a
 *      replay, or Meta retrying a delivery it thinks failed) changes nothing.
 *   3. The payload is read WITHIN the binding: entries of another WABA and
 *      `messages` changes of another phone number id are dropped.
 *   4. Statuses reconcile only rows of the bound sender with that provider
 *      message id (and, when Meta names it, that recipient); inbound messages
 *      open the 24-hour window of (bound sender, recipient hash) and nothing
 *      else (no content is read or stored); template, limit and account events
 *      update the bound WABA's records only.
 *
 * No provider call, no queue write, no consent change: an inbound "STOP" is not
 * interpreted here (see the README's open items). Nothing is sent from this
 * path, so it cannot become a second dispatcher.
 */
import { createHash } from "node:crypto";

import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import type {
  ChannelWebhookVerifierPort,
  VerifyMetaWebhookRefusal
} from "../../_shared/ports/channel-account-port";
import type { ParsedChannelCallbackToken } from "../../_shared/channel-webhook-token";
import { parseMetaWebhook } from "../domain/meta-cloud-policy";
import type { RecipientKeyRing } from "../domain/whatsapp-recipient";
import {
  applyMetaWebhookActions,
  recordWebhookReceipt,
  type ApplyMetaWebhookResult
} from "./whatsapp-meta-directory";

export type MetaWebhookOutcome =
  | { kind: "refused"; reason: VerifyMetaWebhookRefusal }
  | {
      kind: "accepted";
      result: ApplyMetaWebhookResult & {
        bindingMismatches: number;
        ignored: number;
        malformed: boolean;
      };
    };

/** Meta's subscription handshake, in the token's tenant transaction. `true` only for an active signed subscription whose callback token is also the verify token. */
export async function handleMetaHandshake(
  sql: Bun.SQL,
  token: ParsedChannelCallbackToken,
  verifyToken: string | null,
  verifier: ChannelWebhookVerifierPort
): Promise<boolean> {
  return withTenantOrThrow(
    sql,
    token.tenantId,
    (tx) =>
      verifier.verifyMetaHandshake(tx, {
        tenantId: token.tenantId,
        subscriptionId: token.subscriptionId,
        token: token.raw,
        verifyToken
      }),
    { workClass: "interactive" }
  );
}

export async function handleMetaWebhook(
  sql: Bun.SQL,
  token: ParsedChannelCallbackToken,
  input: { rawBody: string; signatureHeader: string | null },
  deps: {
    verifier: ChannelWebhookVerifierPort;
    ring: Extract<RecipientKeyRing, { ok: true }>;
    now?: Date;
  }
): Promise<MetaWebhookOutcome> {
  const now = deps.now ?? new Date();

  return withTenantOrThrow(
    sql,
    token.tenantId,
    async (tx): Promise<MetaWebhookOutcome> => {
      const verdict = await deps.verifier.verifyMetaWebhook(tx, {
        tenantId: token.tenantId,
        subscriptionId: token.subscriptionId,
        token: token.raw,
        rawBody: input.rawBody,
        signatureHeader: input.signatureHeader
      });

      if (!verdict.ok) return { kind: "refused", reason: verdict.reason };

      const empty = {
        statusesApplied: 0,
        statusesUnmatched: 0,
        windowsOpened: 0,
        templatesUpdated: 0,
        signalsUpdated: 0,
        bindingMismatches: 0,
        ignored: 0
      };
      const fresh = await recordWebhookReceipt(
        tx,
        token.tenantId,
        verdict.binding.subscriptionId,
        createHash("sha256").update(input.rawBody, "utf8").digest("hex")
      );

      if (!fresh) {
        return {
          kind: "accepted",
          result: { ...empty, duplicate: true, malformed: false }
        };
      }

      let payload: unknown;

      try {
        payload = JSON.parse(input.rawBody);
      } catch {
        // Signed by Meta but not JSON: nothing to apply. Answered 200 so the
        // provider does not retry it for a week.
        return {
          kind: "accepted",
          result: { ...empty, duplicate: false, malformed: true }
        };
      }

      const parsed = parseMetaWebhook(
        payload,
        {
          wabaId: verdict.binding.wabaId,
          phoneNumberId: verdict.binding.phoneNumberId
        },
        now
      );
      const applied = await applyMetaWebhookActions(
        tx,
        token.tenantId,
        verdict.binding,
        parsed.actions,
        deps.ring
      );

      return {
        kind: "accepted",
        result: {
          ...applied,
          duplicate: false,
          malformed: false,
          bindingMismatches: parsed.bindingMismatches,
          ignored: parsed.ignored
        }
      };
    },
    { workClass: "interactive" }
  );
}
