import { log, type LogContext } from "./logger";
import { safeErrorDetail, sanitizeErrorForLog } from "./error-sanitizer";

/**
 * The two mechanical call-site helpers Issue #687 (epic #679,
 * platform-hardening) introduces — ONE way to log a caught exception from an
 * admin SSR page, and ONE way to report a CLI worker script failure, instead
 * of ~40 files each hand-rolling a raw console call with the caught value
 * passed straight through as an argument, or manually branching on the
 * caught value's type with a string-conversion fallback to derive a
 * message by hand. Both route through `sanitizeErrorForLog`/
 * `safeErrorDetail` (`./error-sanitizer.ts`) so a raw secret embedded in an
 * exception's own message/stack can never reach stdout/stderr unredacted.
 *
 * (Deliberately described in prose above rather than shown as a literal
 * code sample: this file lives inside `scripts/logging-lint-check.ts`'s own
 * `src/lib` scan root, and its checker works on raw source text — a
 * verbatim reproduction of the exact banned shape in a comment would be a
 * false-positive self-match. See that script's header for the same
 * constraint applied to its own comments.)
 */

/**
 * For `src/pages/admin/**\/*.astro` SSR page frontmatter. Replaces a raw
 * console call (page label plus the caught value passed straight through
 * as a second argument) with a correlation-aware structured log line via
 * `log()` — pass `Astro.locals.correlationId` (set for every request by
 * `src/middleware.ts` since Issue 10.1/#447) as `context.correlationId` so
 * the failure can be traced back to the request that caused it, the same
 * way every API handler already can.
 */
export function logAdminPageError(
  label: string,
  error: unknown,
  context: LogContext = {}
): void {
  log("error", label, {
    ...context,
    error: sanitizeErrorForLog(error) as unknown as Record<string, unknown>
  });
}

/**
 * For `scripts/*.ts` CLI worker entrypoints (`bun run <script>`). Replaces
 * the repeated pattern of deriving a message by hand (branch on the
 * caught value's type, fall back to a plain string conversion) and then
 * printing it via a raw console call, immediately followed by setting a
 * non-zero exit code — one call instead. `label` should already include
 * the script's own name and " FAILED" suffix (matching every existing
 * message this replaces, e.g. `"blog:publish:scheduled FAILED"`), so the
 * printed line is byte-for-byte the same shape operators already know,
 * just with the exception detail redacted first. Still sets
 * `process.exitCode = 1` so the script's own scheduler/CI step observes
 * the failure exactly as before.
 */
export function logScriptFailure(label: string, error: unknown): void {
  console.error(`${label} — ${safeErrorDetail(error)}`);
  process.exitCode = 1;
}
