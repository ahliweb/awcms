/**
 * The per-source bearer token (Issue #1153, ADR-0155 section 3).
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_SOURCE_TOKEN_LENGTH,
  formatSourceToken,
  generateSourceSecret,
  parseSourceToken,
  sourceTokenPrefix
} from "../src/modules/website-engagement/domain/source-token";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

describe("website_engagement source token", () => {
  test("round-trips tenant, source and secret", () => {
    const secret = generateSourceSecret();
    const token = formatSourceToken(TENANT, SOURCE, secret);

    expect(token.startsWith("wes1.")).toBe(true);
    expect(parseSourceToken(token)).toEqual({
      tenantId: TENANT,
      sourceId: SOURCE,
      secret
    });
  });

  test("the secret is 256 random bits, base64url, never repeated", () => {
    const seen = new Set<string>();

    for (let i = 0; i < 50; i += 1) {
      const secret = generateSourceSecret();

      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(secret);
    }

    expect(seen.size).toBe(50);
  });

  test("the displayed prefix is six characters of the secret and not the whole of it", () => {
    const secret = generateSourceSecret();

    expect(sourceTokenPrefix(secret)).toBe(secret.slice(0, 6));
    expect(sourceTokenPrefix(secret).length).toBe(6);
  });

  test("everything that is not exactly the format parses to null and never throws", () => {
    const secret = generateSourceSecret();
    const good = formatSourceToken(TENANT, SOURCE, secret);
    const bad: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "wes1",
      "wes1..",
      `wes2.${TENANT}.${SOURCE}.${secret}`,
      `wes1.${TENANT}.${SOURCE}`,
      `wes1.${TENANT}.${SOURCE}.${secret}.extra`,
      `wes1.not-a-uuid.${SOURCE}.${secret}`,
      `wes1.${TENANT}.not-a-uuid.${secret}`,
      `wes1.${TENANT}.${SOURCE}.short`,
      `wes1.${TENANT}.${SOURCE}.${secret.slice(0, 42)}!`,
      `${good} `,
      ` ${good}`,
      "x".repeat(MAX_SOURCE_TOKEN_LENGTH + 1),
      `wes1.${TENANT}.${SOURCE}.${"a".repeat(10_000)}`
    ];

    for (const value of bad) {
      expect(parseSourceToken(value)).toBeNull();
    }
  });
});
