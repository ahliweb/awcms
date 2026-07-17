import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  hashClientIp,
  resetClientFingerprintKeyForTests,
  summarizeUserAgent
} from "../src/lib/security/client-fingerprint";
import { type LogEntry, setLogSink } from "../src/lib/logging/logger";
import { redactSensitiveAttributes } from "../src/modules/_shared/redaction";

const SECRET_ENV = "AUTH_IP_HASH_SECRET";
const originalSecret = process.env[SECRET_ENV];

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  setLogSink((entry) => entries.push(entry));
  return entries;
}

beforeEach(() => {
  resetClientFingerprintKeyForTests();
  process.env[SECRET_ENV] = "test-ip-hash-secret-with-plenty-of-entropy";
});

afterEach(() => {
  setLogSink(null);
  if (originalSecret === undefined) {
    delete process.env[SECRET_ENV];
  } else {
    process.env[SECRET_ENV] = originalSecret;
  }
});

describe("hashClientIp (Issue #145)", () => {
  test("is stable for the same IP so audit rows can be grouped by source", () => {
    expect(hashClientIp("203.0.113.7")).toBe(hashClientIp("203.0.113.7"));
  });

  test("distinguishes different sources", () => {
    expect(hashClientIp("203.0.113.7")).not.toBe(hashClientIp("203.0.113.8"));
  });

  test("never embeds the raw address", () => {
    const hashed = hashClientIp("203.0.113.7");

    expect(hashed).not.toContain("203.0.113.7");
    expect(hashed).toStartWith("hmac-sha256:");
  });

  test("is keyed, so the same IP under a different secret yields a different pseudonym", () => {
    const withFirstKey = hashClientIp("203.0.113.7");

    process.env[SECRET_ENV] = "a-completely-different-secret-value";

    expect(hashClientIp("203.0.113.7")).not.toBe(withFirstKey);
  });

  test("falls back to a per-process random key (never an unkeyed digest) and warns when the secret is unset", () => {
    const entries = captureLogs();
    delete process.env[SECRET_ENV];
    resetClientFingerprintKeyForTests();

    const first = hashClientIp("203.0.113.7");

    // Still usable within the process...
    expect(hashClientIp("203.0.113.7")).toBe(first);
    // ...but keyed with a secret nobody published: a fresh process key must
    // produce a different pseudonym, proving the digest is not unkeyed
    // sha256(ip), which would be reversible across the whole IPv4 space.
    resetClientFingerprintKeyForTests();
    expect(hashClientIp("203.0.113.7")).not.toBe(first);

    expect(entries.map((entry) => entry.message)).toContain(
      "security.client_fingerprint.ephemeral_ip_hash_key"
    );
  });

  test("refuses a placeholder secret — a published key would make every ipHash reversible", () => {
    const entries = captureLogs();

    for (const placeholder of ["change-me", "CHANGE-ME", "secret"]) {
      process.env[SECRET_ENV] = placeholder;
      resetClientFingerprintKeyForTests();

      const keyedWithPlaceholder =
        "hmac-sha256:" +
        createHmac("sha256", placeholder).update("203.0.113.7").digest("hex");

      expect(hashClientIp("203.0.113.7")).not.toBe(keyedWithPlaceholder);
    }

    expect(
      entries.filter(
        (entry) =>
          entry.message === "security.client_fingerprint.ephemeral_ip_hash_key"
      ).length
    ).toBeGreaterThan(0);
  });

  test("survives audit redaction under the key `ipHash` (a raw `ip` key would not)", () => {
    const attributes = {
      ipHash: hashClientIp("203.0.113.7"),
      userAgent: "curl/8.0",
      ip: "203.0.113.7"
    };

    const redacted = redactSensitiveAttributes(attributes)!;

    expect(redacted.ipHash).toBe(attributes.ipHash);
    expect(redacted.userAgent).toBe("curl/8.0");
    expect(redacted.ip).toBe("[REDACTED]");
  });
});

describe("summarizeUserAgent (Issue #145)", () => {
  function requestWithUserAgent(userAgent?: string): Request {
    return new Request("https://example.test/api/v1/auth/login", {
      headers: userAgent === undefined ? {} : { "user-agent": userAgent }
    });
  }

  test("returns the header value", () => {
    expect(summarizeUserAgent(requestWithUserAgent("curl/8.0"))).toBe(
      "curl/8.0"
    );
  });

  test("returns undefined when absent or blank, so the key is omitted entirely", () => {
    expect(summarizeUserAgent(requestWithUserAgent())).toBeUndefined();
    expect(summarizeUserAgent(requestWithUserAgent("   "))).toBeUndefined();
  });

  test("truncates an attacker-sized header before it can reach a jsonb column", () => {
    const summarized = summarizeUserAgent(
      requestWithUserAgent("A".repeat(10_000))
    );

    expect(summarized).toHaveLength(256);
  });
});
