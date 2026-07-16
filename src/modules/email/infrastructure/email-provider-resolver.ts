/**
 * Production resolver (Issue #495) — mirrors
 * `sync-storage/infrastructure/object-storage-uploader.ts`'s
 * `resolveObjectUploader`: picks the concrete `EmailProvider` from
 * configuration, degrading to a clean failed-result provider on
 * misconfiguration rather than throwing (a single misconfigured deployment
 * must not crash the dispatcher — `bun run config:validate`, Issue #493,
 * is what should have already caught this at boot).
 */
import {
  isKnownEmailProvider,
  resolveEmailSendTimeoutMs
} from "../domain/email-config";
import type { EmailProvider } from "../domain/email-provider-contract";
import { createLogEmailProvider } from "./log-email-provider";
import { createMailketingEmailProvider } from "./mailketing-provider";

function createMisconfiguredProvider(reason: string): EmailProvider {
  return {
    async send() {
      return { ok: false, error: reason, retryable: false };
    },
    async healthCheck() {
      return { ok: false, error: reason };
    }
  };
}

export function resolveEmailProvider(
  env: NodeJS.ProcessEnv = process.env
): EmailProvider {
  const provider = env.EMAIL_PROVIDER;

  if (!isKnownEmailProvider(provider)) {
    return createMisconfiguredProvider(
      "EMAIL_PROVIDER is missing or not a known provider."
    );
  }

  if (provider === "log") {
    return createLogEmailProvider();
  }

  const apiToken = env.EMAIL_MAILKETING_API_TOKEN;
  const baseUrl = env.EMAIL_MAILKETING_API_BASE_URL;

  if (!apiToken || !baseUrl) {
    return createMisconfiguredProvider(
      "Mailketing is not configured (requires EMAIL_MAILKETING_API_TOKEN, " +
        "EMAIL_MAILKETING_API_BASE_URL)."
    );
  }

  return createMailketingEmailProvider({
    apiToken,
    baseUrl,
    timeoutMs: resolveEmailSendTimeoutMs(env)
  });
}
