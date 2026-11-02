/**
 * The provider adapter of a TENANT-OWNED sender (Issue #1141, ADR-0148 section
 * 4): `(provider, external id, credential)` in, a `WhatsappProvider` out.
 *
 * ## Where its inputs come from
 *
 * `provider` and `externalId` are read from the sender's own `channel_accounts`
 * record and `credential` from its secret reference, both for the claimed row's
 * tenant (`ChannelAccountPort`, `ChannelSenderCredentialPort`). This function
 * has no parameter that a request could fill: it cannot be handed a phone number
 * id or a token by anyone but the dispatcher that just resolved them. The
 * deployment sender is a different path (`whatsapp-provider-resolver.ts`, the
 * environment) and is untouched.
 *
 * ## Which providers have an adapter
 *
 * `whatsapp_cloud` only. `starsender` is a row of the provider matrix but its
 * adapter is Issue #1142, behind its own flag and per-operator risk
 * acknowledgement (ADR-0148 section 7): until it lands, a StarSender sender
 * cannot be enqueued to and a row that somehow carries one fails closed. Adding
 * a provider is adding one `case` here, never a code default of a provider.
 */
import type { ResolvedWhatsappSender } from "../../_shared/ports/channel-account-port";
import { resolveWhatsappSendTimeoutMs } from "../domain/whatsapp-config";
import type { WhatsappProvider } from "../domain/whatsapp-provider-contract";
import { createMetaCloudWhatsappProvider } from "./meta-cloud-provider";
import type { WhatsappHttpClient } from "./whatsapp-http-client";

const PHONE_NUMBER_ID = /^\d{5,25}$/;
const API_VERSION = /^v\d+\.\d+$/;

/** The Graph API version in force, or `null` when the operator's value is malformed. */
export function resolveWhatsappMetaApiVersion(
  env: NodeJS.ProcessEnv
): string | null {
  const version = env.WHATSAPP_META_API_VERSION?.trim() || "v21.0";

  return API_VERSION.test(version) ? version : null;
}

export function isWhatsappMetaApiVersionValid(env: NodeJS.ProcessEnv): boolean {
  return resolveWhatsappMetaApiVersion(env) !== null;
}

/** Whether this deployment can send through a sender of `provider`. Checked at ENQUEUE so a row that could never be sent is refused instead of queued. */
export function hasWhatsappSenderAdapter(provider: string): boolean {
  return provider === "whatsapp_cloud";
}

export type BuildSenderProviderInput = {
  sender: Pick<ResolvedWhatsappSender, "accountId" | "provider" | "externalId">;
  credential: string;
  breakerKey: string;
  env: NodeJS.ProcessEnv;
  http?: WhatsappHttpClient;
};

/** `null` when the provider has no adapter or the account's identity is malformed: the row then fails closed, never through another path. */
export function buildWhatsappSenderProvider(
  input: BuildSenderProviderInput
): WhatsappProvider | null {
  switch (input.sender.provider) {
    case "whatsapp_cloud": {
      const apiVersion = input.env.WHATSAPP_META_API_VERSION?.trim() || "v21.0";

      if (
        !PHONE_NUMBER_ID.test(input.sender.externalId) ||
        !API_VERSION.test(apiVersion) ||
        input.credential.trim() === ""
      ) {
        return null;
      }

      return createMetaCloudWhatsappProvider({
        accessToken: input.credential.trim(),
        phoneNumberId: input.sender.externalId,
        apiVersion,
        timeoutMs: resolveWhatsappSendTimeoutMs(input.env),
        breakerKey: input.breakerKey,
        ...(input.http ? { http: input.http } : {})
      });
    }

    default:
      return null;
  }
}
