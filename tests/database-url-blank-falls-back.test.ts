import { afterEach, describe, expect, test } from "bun:test";

import { readConfiguredUrl } from "../src/lib/database/client";

/**
 * `WORKER_DATABASE_URL=""` used to shadow the `DATABASE_URL` fallback.
 *
 * The resolution was `process.env[name] ?? process.env.DATABASE_URL`, and `??`
 * falls back only on null/undefined — so a blank value counted as CONFIGURED,
 * the fallback never ran, and the operator got
 *
 *     WORKER_DATABASE_URL (or DATABASE_URL as a fallback) is required
 *
 * with `DATABASE_URL` set and correct. An error naming the fallback it had just
 * refused to use.
 *
 * A blank value is not an exotic input. It is what a compose file produces from
 * `WORKER_DATABASE_URL:` with nothing after it, what a PaaS UI row saved empty
 * produces, and what `export A=1 B=$A` produces — `$A` is expanded before `A`
 * is assigned, so `B` is blank. None of those look like "unset" to whoever
 * wrote them, which is why the failure reads as a contradiction.
 */
const NAME = "AWCMS_TEST_CONNECTION_URL";

afterEach(() => {
  delete process.env[NAME];
});

describe("readConfiguredUrl", () => {
  test("returns a configured value", () => {
    process.env[NAME] = "postgres://user@host/db";

    expect(readConfiguredUrl(NAME)).toBe("postgres://user@host/db");
  });

  test("an unset variable is undefined, so a caller's `??` falls back", () => {
    expect(readConfiguredUrl(NAME)).toBeUndefined();
  });

  test("a BLANK variable is undefined too — the defect this exists for", () => {
    process.env[NAME] = "";

    // The old expression returned "" here, which is not nullish, so `??` kept
    // it and the fallback was skipped.
    expect(readConfiguredUrl(NAME)).toBeUndefined();
  });

  test("whitespace-only is undefined — the same mistake with an invisible cause", () => {
    process.env[NAME] = "   ";

    // `new Bun.SQL(" ")` fails somewhere far from the variable that caused it.
    expect(readConfiguredUrl(NAME)).toBeUndefined();
  });

  test("surrounding whitespace is trimmed rather than passed through", () => {
    process.env[NAME] = "  postgres://user@host/db\n";

    expect(readConfiguredUrl(NAME)).toBe("postgres://user@host/db");
  });

  test("the fallback chain works the way the error message claims", () => {
    // The whole point, expressed as the caller expresses it.
    process.env[NAME] = "";
    process.env.AWCMS_TEST_FALLBACK_URL = "postgres://fallback@host/db";

    const resolved =
      readConfiguredUrl(NAME) ?? readConfiguredUrl("AWCMS_TEST_FALLBACK_URL");

    expect(resolved).toBe("postgres://fallback@host/db");

    delete process.env.AWCMS_TEST_FALLBACK_URL;
  });
});
