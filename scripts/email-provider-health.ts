/**
 * email-provider-health.ts — `bun run email:provider:health`.
 *
 * Issue #495 (epic #492) §"Add provider health/check command". Standalone
 * CLI (no HTTP endpoint exists for this yet — that's admin-diagnostics
 * territory, Issue #499): resolves the configured `EmailProvider`
 * (`src/modules/email/infrastructure/email-provider-resolver.ts`) exactly
 * as the dispatcher does, and calls its `healthCheck()`. A live network
 * check against the real Mailketing API when `EMAIL_PROVIDER=mailketing` —
 * deliberately not run as part of `bun run check`/CI (no network egress
 * there), operators run this manually or from a deployment smoke-test step.
 *
 * Exits 0 (no-op) when `EMAIL_ENABLED` is not `"true"` — nothing to check;
 * a disabled email module is never a go-live blocker (doc 18 feature-flag
 * rule).
 */
import { resolveEmailProvider } from "../src/modules/email/infrastructure/email-provider-resolver";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";

async function main() {
  if (process.env.EMAIL_ENABLED !== "true") {
    console.log('email:provider:health SKIPPED — EMAIL_ENABLED is not "true".');
    return;
  }

  const provider = resolveEmailProvider();
  const result = await provider.healthCheck();

  if (!result.ok) {
    // `result.error` is already-truncated provider-response text (see
    // `MailketingProvider.healthCheck`), but not yet run through this
    // repo's shared secret-pattern redaction — `safeErrorDetail` is
    // idempotent-safe to apply here regardless of the input shape.
    console.error(
      `email:provider:health FAILED — ${safeErrorDetail(result.error)}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `email:provider:health OK — provider=${process.env.EMAIL_PROVIDER ?? "unknown"}`
  );
}

if (import.meta.main) {
  await main();
}
