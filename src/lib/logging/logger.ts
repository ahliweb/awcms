import { redactSensitiveAttributes } from "../../modules/_shared/redaction";
import { safeErrorDetail } from "./error-sanitizer";

/**
 * Structured JSON logger (Issue 10.1, doc 10 §Logger redaction). Independent
 * of the DB audit trail (`src/modules/logging/application/audit-log.ts`) —
 * "Audit melengkapi, bukan menggantikan, domain event & structured log" (doc
 * 10): these are two separate, complementary mechanisms, not the same one.
 * This logger has no I/O beyond `console.log`; nothing here touches the
 * database.
 */
export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogContext = {
  correlationId?: string;
  tenantId?: string;
  moduleKey?: string;
  [key: string]: unknown;
};

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40
};

/**
 * Spellings of a level that are accepted but are not the level's own name —
 * finding D3 of the 17 August 2026 audit round.
 *
 * `config:validate` accepted `LOG_LEVEL=warn` and this logger implements
 * `warning`, so `LOG_LEVEL_SEVERITY["warn"]` was `undefined`, the `?? info`
 * fallback took over, and the firehose kept shipping while the operator
 * believed they had quieted it. The value the logger DOES implement —
 * `warning` — was rejected by the validator. There was no value that both
 * passed the validated contract and worked.
 *
 * Fixed on both sides, and additively: the validator now accepts both, and this
 * map makes `warn` mean what an operator writing it obviously meant. Rejecting
 * `warn` outright would have been the tidier answer and would have turned a
 * silent no-op into a failed `config:validate` on a deployment that is running
 * right now, to punish a spelling.
 */
const LOG_LEVEL_ALIASES: Record<string, LogLevel> = {
  warn: "warning"
};

let warnedAboutAlias = false;

function currentThreshold(): number {
  const configured = process.env.LOG_LEVEL?.trim();

  if (configured === undefined || configured === "") {
    return LOG_LEVEL_SEVERITY.info;
  }

  const alias = LOG_LEVEL_ALIASES[configured];

  if (alias) {
    if (!warnedAboutAlias) {
      warnedAboutAlias = true;
      // Written directly rather than through `log()`: this runs from inside the
      // threshold check that `log()` itself calls, and routing it back through
      // there is a recursion for a message about a spelling.
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warning",
          message: "logging.log_level.deprecated_spelling",
          moduleKey: "logging",
          configured,
          canonical: alias,
          impact:
            "accepted as an alias; write LOG_LEVEL=warning — before this it was accepted by config:validate, matched no level, and silently fell back to info"
        })
      );
    }

    return LOG_LEVEL_SEVERITY[alias];
  }

  // An unrecognised value still falls back to `info`, which is the safe
  // direction: the alternative is a deployment that logs nothing because
  // somebody typed `infoo`.
  return LOG_LEVEL_SEVERITY[configured as LogLevel] ?? LOG_LEVEL_SEVERITY.info;
}

/** Test-only: clears the alias warn-once memory so tests do not bleed. */
export function resetLogLevelAliasWarningForTests(): void {
  warnedAboutAlias = false;
}

/**
 * One already-redacted structured log line, as passed to `console.log` and,
 * if registered, to the extension-point sink below.
 */
export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
};

/**
 * Extension point (Issue #447 — activating the logging system operationally,
 * not building a new one). `stdout`/`console.log` stays the source of truth
 * for every log line unconditionally (doc 20 §Batasan — capture/rotation is
 * a deployment-layer job: docker logging driver/systemd journal, not
 * application code) — this hook is purely *additive*: a domain module in
 * `src/modules/` can register a consumer to forward already-redacted log
 * entries to its own alerting/export pipeline (ISO 27001 A.8.16) without
 * touching this file. Default is `null` (no-op) — zero behavior change for
 * every deployment that never calls `setLogSink`.
 *
 * Deliberately NOT a real SIEM/monitoring integration (out of scope per doc
 * 20 §Matrix kepatuhan A.8.16 and Issue #437's explicit scope boundary) —
 * just the pluggable point a real one would attach to. A sink must not
 * throw/block: it runs synchronously right after the line is written, and
 * any error it raises is caught and reported via a plain `console.error`
 * (never re-thrown) so a broken sink can never take down the app it's
 * attached to.
 */
export type LogSink = (entry: LogEntry) => void;

let registeredSink: LogSink | null = null;

export function setLogSink(sink: LogSink | null): void {
  registeredSink = sink;
}

/** Test/introspection helper — mirrors `resetRateLimitStoreForTests` style. */
export function getLogSink(): LogSink | null {
  return registeredSink;
}

/**
 * Writes one JSON line to stdout. Gated by `LOG_LEVEL` (default `"info"`) —
 * `debug` lines are only emitted when `LOG_LEVEL=debug`. Context is redacted
 * with the same `redactSensitiveAttributes` used by the audit trail, so a
 * caller can never accidentally leak a password/token/NPWP/phone/email into
 * a log line either.
 */
export function log(
  level: LogLevel,
  message: string,
  context?: LogContext
): void {
  if (LOG_LEVEL_SEVERITY[level] < currentThreshold()) {
    return;
  }

  const redactedContext = redactSensitiveAttributes(context);
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactedContext
  };

  console.log(JSON.stringify(entry));

  if (registeredSink) {
    try {
      registeredSink(entry);
    } catch (error) {
      // A registered sink is never allowed to break core logging. Issue
      // #687 follow-up (PR #712 security review): this used to print
      // `error.message` raw — a broken sink could easily be one built
      // around a secret-bearing config (a webhook URL with an embedded
      // token, a SIEM API key), so its own thrown error text needs the
      // same redaction as every other caught exception in this codebase.
      console.error(
        "Log sink threw — ignoring (Issue #447 extension point):",
        safeErrorDetail(error)
      );
    }
  }
}
