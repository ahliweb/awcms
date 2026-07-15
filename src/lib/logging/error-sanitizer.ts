import { redactSecretsInText } from "../../modules/_shared/redaction";

/**
 * Error normalization/redaction (Issue #687, epic #679 platform-hardening).
 * Narrow remediation, NOT a replacement for the structured logger/audit
 * trail foundation (Issue 10.1/#403/#447) — this module only makes sure a
 * caught exception's own message/stack (and any nested `.cause`) is safe to
 * hand to `log()`/`console.error` in the first place, by running it through
 * `redactSecretsInText` before it ever reaches a log line, an operator's
 * terminal, or (indirectly, via a bug) an HTTP response.
 *
 * Every call site in this codebase that used to do
 * `error instanceof Error ? error.message : String(error)` by hand and
 * print the result directly should instead go through `safeErrorDetail`
 * (flat string, for CLI scripts) or `sanitizeErrorForLog` (structured, for
 * `log()`'s `LogContext`) — see `./error-log.ts` for the two call-site
 * helpers built on top of these, and `scripts/logging-lint-check.ts` for the
 * regression gate that keeps the old hand-rolled idiom from creeping back
 * into `src/pages/admin/**`, `src/pages/api/v1/**`, or `scripts/*.ts`.
 */

/** One already-redacted level of an error (or its `.cause`) chain. */
export type SafeErrorDetail = {
  name: string;
  message: string;
  stack?: string;
  cause?: SafeErrorDetail;
};

/**
 * Bounds how deep a `.cause` chain is walked — a defensive limit, not an
 * expected depth (this codebase's own nested-cause usage is 1-2 levels
 * deep). Prevents an adversarial or accidentally-circular cause chain from
 * making a single log call do unbounded work.
 */
const MAX_CAUSE_DEPTH = 5;

function sanitizeOne(error: unknown): SafeErrorDetail {
  if (error instanceof Error) {
    const detail: SafeErrorDetail = {
      name: error.name,
      message: redactSecretsInText(error.message)
    };

    if (error.stack) {
      detail.stack = redactSecretsInText(error.stack);
    }

    return detail;
  }

  return {
    name: "NonErrorValue",
    message: redactSecretsInText(String(error))
  };
}

/**
 * Structured, already-redacted representation of `error` (and its `.cause`
 * chain, if any) — safe to pass as a `LogContext` attribute to `log()`.
 * Never throws, regardless of what `error` actually is (a real `Error`, a
 * plain string/object someone threw, `null`/`undefined`, etc).
 */
export function sanitizeErrorForLog(error: unknown): SafeErrorDetail {
  const root = sanitizeOne(error);
  let current = root;
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  let depth = 0;

  while (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    const sanitizedCause = sanitizeOne(cause);
    current.cause = sanitizedCause;
    current = sanitizedCause;
    cause = cause instanceof Error ? cause.cause : undefined;
    depth += 1;
  }

  return root;
}

/**
 * Flat, single-line, already-redacted summary of `error` — for CLI scripts
 * that print a plain-text operator message (`bun run <script>` output),
 * where a nested JSON structure would hurt readability more than it helps.
 * Only the top-level message is included (no stack, no cause chain) —
 * scripts using this already print their own actionable context around it
 * (which stage failed, which tenant, etc); the full structured detail
 * belongs in a `log()` call instead, if one is warranted.
 */
export function safeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return redactSecretsInText(raw);
}
