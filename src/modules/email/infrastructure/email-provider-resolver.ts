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
import { EMAIL_CONFIG_ERROR_HOLD_MS } from "../domain/email-retry";
import { createLogEmailProvider } from "./log-email-provider";
import {
  isMailketingTokenHeaderSafe,
  resolveMailketingApiVersion,
  resolveMailketingV2BaseUrl
} from "../domain/mailketing-v2-contract";
import { createMailketingEmailProvider } from "./mailketing-provider";
import { createMailketingV2Provider } from "./mailketing-v2-provider";

/**
 * A configuration error must NEVER consume messages. The dispatcher claims a
 * batch before it resolves the provider, so answering `retryable: false` here
 * used to mark up to a whole batch `failed` — OTP and password-reset mail lost
 * to a typo. `skipped` undoes the claim: the row stays `queued`, no attempt is
 * written, no retry is spent, and `configError` makes the dispatcher log and
 * summarise it loudly. It is held `EMAIL_CONFIG_ERROR_HOLD_MS` so a pass does
 * not re-claim it in a tight loop; once the configuration is fixed the queue
 * simply drains. `healthCheck` still reports the reason as a failure.
 */
function createMisconfiguredProvider(reason: string): EmailProvider {
  return {
    async send() {
      return {
        ok: false,
        error: reason,
        retryable: true,
        skipped: true,
        holdMs: EMAIL_CONFIG_ERROR_HOLD_MS,
        configError: true
      };
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

  // Issue #1159 (ADR-0151 §1). Unset = v1, byte for byte as before. An
  // unrecognised value fails closed rather than silently falling back to v1.
  const version = resolveMailketingApiVersion(env);

  if (!version.ok) {
    return createMisconfiguredProvider(version.reason);
  }

  if (version.version === "v2") {
    const v2Token = env.EMAIL_MAILKETING_API_TOKEN;

    if (!v2Token) {
      return createMisconfiguredProvider(
        "Mailketing v2 is not configured (requires EMAIL_MAILKETING_API_TOKEN)."
      );
    }

    if (!isMailketingTokenHeaderSafe(v2Token)) {
      return createMisconfiguredProvider(
        "EMAIL_MAILKETING_API_TOKEN is not usable as an HTTP header value."
      );
    }

    const v2BaseUrl = resolveMailketingV2BaseUrl(
      env.EMAIL_MAILKETING_API_BASE_URL
    );

    if (!v2BaseUrl.ok) {
      return createMisconfiguredProvider(v2BaseUrl.reason);
    }

    return createMailketingV2Provider({
      apiToken: v2Token,
      baseUrl: v2BaseUrl.baseUrl,
      timeoutMs: resolveEmailSendTimeoutMs(env),
      env
    });
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
