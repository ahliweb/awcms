/**
 * Production resolver (Issue #963) — mirrors `push-provider-resolver.ts`: picks
 * the concrete `WhatsappProvider` from configuration and DEGRADES to a
 * failed-result provider on misconfiguration rather than throwing, so one
 * misconfigured deployment cannot crash the dispatcher. The degraded provider
 * returns `retryable: false`: a missing credential will not fix itself between
 * passes, and retrying would burn every queued row's budget against a condition
 * only an operator can change.
 */
import {
  isKnownWhatsappProvider,
  resolveWhatsappSendTimeoutMs
} from "../domain/whatsapp-config";
import type { WhatsappProvider } from "../domain/whatsapp-provider-contract";
import { createFonnteWhatsappProvider } from "./fonnte-provider";
import { createLogWhatsappProvider } from "./log-whatsapp-provider";
import { createMetaCloudWhatsappProvider } from "./meta-cloud-provider";

function createMisconfiguredProvider(reason: string): WhatsappProvider {
  return {
    async send() {
      return {
        ok: false,
        error: reason,
        retryable: false,
        failureCode: "misconfigured"
      };
    },
    async healthCheck() {
      return { ok: false, error: reason };
    }
  };
}

export function resolveWhatsappProvider(
  env: NodeJS.ProcessEnv = process.env
): WhatsappProvider {
  const provider = env.WHATSAPP_PROVIDER;

  if (!isKnownWhatsappProvider(provider)) {
    return createMisconfiguredProvider(
      "WHATSAPP_PROVIDER is missing or not a known provider."
    );
  }

  const timeoutMs = resolveWhatsappSendTimeoutMs(env);

  switch (provider) {
    case "log":
      return createLogWhatsappProvider();

    case "fonnte": {
      const token = env.WHATSAPP_FONNTE_TOKEN?.trim();

      return token
        ? createFonnteWhatsappProvider({ token, timeoutMs })
        : createMisconfiguredProvider("WHATSAPP_FONNTE_TOKEN is not set.");
    }

    case "meta": {
      const accessToken = env.WHATSAPP_META_ACCESS_TOKEN?.trim();
      const phoneNumberId = env.WHATSAPP_META_PHONE_NUMBER_ID?.trim();
      const apiVersion = env.WHATSAPP_META_API_VERSION?.trim() || "v21.0";

      if (!accessToken || !phoneNumberId) {
        return createMisconfiguredProvider(
          "WHATSAPP_META_ACCESS_TOKEN and WHATSAPP_META_PHONE_NUMBER_ID must be set."
        );
      }

      if (
        !/^v\d+\.\d+$/.test(apiVersion) ||
        !/^\d{5,25}$/.test(phoneNumberId)
      ) {
        return createMisconfiguredProvider(
          "WHATSAPP_META_API_VERSION or WHATSAPP_META_PHONE_NUMBER_ID is malformed."
        );
      }

      return createMetaCloudWhatsappProvider({
        accessToken,
        phoneNumberId,
        apiVersion,
        timeoutMs
      });
    }
  }
}
