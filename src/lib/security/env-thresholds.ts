import { log } from "../logging/logger";

/**
 * Parsing for operator-set NUMERIC SECURITY THRESHOLDS read from the
 * environment — rate-limit ceilings, windows, lockout counts.
 *
 * ## The defect this exists to make unrepeatable
 *
 * `Number(process.env.X ?? 60)` is wrong in two directions at once, and both
 * failures are silent:
 *
 * - `??` falls back only on `undefined`/`null`. A **non-numeric** value —
 *   `SITE_SEARCH_RATE_LIMIT_MAX=6O` with a letter O, or `sixty` — yields
 *   `NaN`. Every comparison against `NaN` is `false`, so `count > NaN` never
 *   trips and **the limiter is switched off entirely**. Worse than merely off:
 *   the `rate_limited` metric stays at zero, which an operator reads as
 *   evidence of no abuse.
 * - An **empty** value (`SITE_SEARCH_RATE_LIMIT_MAX=`) is not `undefined`, so
 *   `??` does not fire either; `Number("")` is `0`, and a ceiling of zero 429s
 *   every visitor on the first request.
 *
 * `resolveLoginPolicyConfig` learned this in Issue #147 and grew its own
 * `parsePositiveIntEnv`. The lesson did not travel: the three public,
 * UNAUTHENTICATED rate limits — site search, search suggestions, and the setup
 * bootstrap — each kept the raw `Number(process.env…)` form.
 *
 * ## Why this takes the VALUE and not the NAME
 *
 * `parsePositiveIntEnv(name, fallback)` reads `process.env[name]`, and a
 * computed read is INVISIBLE to `config:env:coverage:check` — that gate resolves
 * literal `process.env.NAME` spellings (and `env.NAME` aliases) and says so in
 * its own header: computed reads "need a human". A variable read only through a
 * name-taking helper therefore stops being checked against `.env.example`, and
 * an operator loses the one artefact that tells them the knob exists.
 *
 * So the call site keeps the literal read and passes the VALUE:
 *
 * ```ts
 * const MAX = parsePositiveIntSetting(
 *   process.env.SITE_SEARCH_RATE_LIMIT_MAX, // literal — the gate still sees it
 *   60,
 *   "SITE_SEARCH_RATE_LIMIT_MAX"           // for the warning only
 * );
 * ```
 *
 * The name argument is used for the log message and nothing else. It is
 * deliberately NOT used to read the environment.
 */

/**
 * Deduplicated per `name=value`, because these constants are evaluated by
 * modules serving public, unauthenticated endpoints. A per-request warning
 * would be a free log-volume amplifier for an attacker, and repeating a message
 * about a value that cannot change mid-process adds nothing.
 */
const warnedValues = new Set<string>();

function warnOnce(name: string, raw: string, fallback: number): void {
  const dedupeKey = `${name}=${raw}`;

  if (warnedValues.has(dedupeKey)) {
    return;
  }

  warnedValues.add(dedupeKey);

  // `value` is echoed deliberately: these are operator-set numeric thresholds,
  // never secrets, and the malformed value is the whole point of the message.
  log("warning", "security.env_threshold.invalid_value", {
    envVar: name,
    value: raw,
    fallback,
    reason: "not a positive integer — falling back to the default"
  });
}

/**
 * Returns `fallback` for anything that is not a usable positive integer:
 * absent, empty, whitespace, non-numeric, fractional, zero, or negative.
 *
 * Zero and negatives are rejected as firmly as `NaN`. A ceiling of `0` refuses
 * every request; a window of `0` divides the limiter's arithmetic by nothing.
 * Neither is a value an operator can have meant, and treating them as absent is
 * the only reading that fails CLOSED — back to the documented default — rather
 * than open.
 */
export function parsePositiveIntSetting(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    warnOnce(name, raw, fallback);
    return fallback;
  }

  return parsed;
}

/** Test-only: clears the warn-once memory so tests do not bleed into each other. */
export function resetEnvThresholdWarningsForTests(): void {
  warnedValues.clear();
}
