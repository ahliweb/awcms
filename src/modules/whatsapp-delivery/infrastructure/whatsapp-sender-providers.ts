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
 * `whatsapp_cloud`, and `starsender` (Issue #1142) ONLY while
 * `WHATSAPP_STARSENDER_ENABLED=true`. StarSender is unofficial (ADR-0148 section
 * 7): its adapter is behind that flag, and a device is usable only with an
 * attested connection and the tenant's active risk acknowledgement, both decided
 * by `ChannelAccountPort` before this is reached. With the flag off a StarSender
 * sender cannot be enqueued to and a row that somehow carries one fails closed.
 * Adding a provider is adding one `case` here, never a code default of a
 * provider.
 */
import type { ResolvedWhatsappSender } from "../../_shared/ports/channel-account-port";
import { isStarsenderAdapterEnabled } from "../../_shared/unofficial-provider-flags";
import {
  resolveWhatsappSendTimeoutMs,
  WHATSAPP_META_DEFAULT_API_VERSION
} from "../domain/whatsapp-config";
import type { WhatsappProvider } from "../domain/whatsapp-provider-contract";
import { createMetaCloudWhatsappProvider } from "./meta-cloud-provider";
import { createStarsenderWhatsappProvider } from "./starsender-provider";
import type { WhatsappHttpClient } from "./whatsapp-http-client";

const PHONE_NUMBER_ID = /^\d{5,25}$/;
const API_VERSION = /^v\d+\.\d+$/;

/** The Graph API version in force, or `null` when the operator's value is malformed. */
export function resolveWhatsappMetaApiVersion(
  env: NodeJS.ProcessEnv
): string | null {
  const version =
    env.WHATSAPP_META_API_VERSION?.trim() || WHATSAPP_META_DEFAULT_API_VERSION;

  return API_VERSION.test(version) ? version : null;
}

export function isWhatsappMetaApiVersionValid(env: NodeJS.ProcessEnv): boolean {
  return resolveWhatsappMetaApiVersion(env) !== null;
}

/** Whether this deployment can send through a sender of `provider`. Checked at ENQUEUE so a row that could never be sent is refused instead of queued. */
export function hasWhatsappSenderAdapter(
  provider: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (provider === "whatsapp_cloud") return true;

  // StarSender is UNOFFICIAL: its adapter exists on a deployment only when the
  // operator switched it on (`WHATSAPP_STARSENDER_ENABLED`, off by default).
  return provider === "starsender" && isStarsenderAdapterEnabled(env);
}

/** A StarSender device id is whatever the vendor calls it; only a sane printable token is accepted, so a malformed record fails closed instead of reaching a header or a log. */
const STARSENDER_DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

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
      const apiVersion =
        input.env.WHATSAPP_META_API_VERSION?.trim() ||
        WHATSAPP_META_DEFAULT_API_VERSION;

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

    case "starsender": {
      if (
        !isStarsenderAdapterEnabled(input.env) ||
        !STARSENDER_DEVICE_ID.test(input.sender.externalId)
      ) {
        return null;
      }

      return createStarsenderWhatsappProvider({
        deviceKey: input.credential.trim(),
        timeoutMs: resolveWhatsappSendTimeoutMs(input.env),
        breakerKey: input.breakerKey,
        ...(input.http ? { http: input.http } : {})
      });
    }

    default:
      return null;
  }
}
