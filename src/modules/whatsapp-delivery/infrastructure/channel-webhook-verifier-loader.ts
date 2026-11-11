/**
 * Where the Meta webhook route reaches `channel_accounts` (Issue #1143,
 * ADR-0011, `capabilities.consumes` in `module.ts`). A lazy import, like
 * `channel-account-port-loader.ts`.
 *
 * Unlike the sender-resolution adapter, the verifier DOES import the secret
 * store: it decrypts the Meta app secret to check `X-Hub-Signature-256`. It is
 * loaded only by the webhook route, which runs as the application role in a
 * request; no job imports this file, so no job is handed the key ring for it
 * (`tests/jobs-env-scoped-reach.test.ts`). A failed import is a refusal: the
 * route answers 401/503, never "verified".
 */
import type { ChannelWebhookVerifierPort } from "../../_shared/ports/channel-account-port";

export async function loadChannelWebhookVerifier(): Promise<ChannelWebhookVerifierPort> {
  const { channelWebhookVerifierAdapter } =
    await import("../../channel-accounts/application/webhook-subscription-directory");

  return channelWebhookVerifierAdapter;
}
