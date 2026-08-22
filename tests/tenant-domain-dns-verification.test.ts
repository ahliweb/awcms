/**
 * ADR-0106 — the DNS TXT ownership check, and the two decisions inside it that
 * are easy to get subtly wrong.
 *
 * 1. **The challenge is server-owned end to end.** A check against a
 *    caller-chosen name and a caller-chosen value passes without the caller
 *    controlling a byte of the zone, so both halves are minted here and the API
 *    refuses to take either.
 * 2. **"Not published" and "we could not find out" are different answers.**
 *    Only the second feeds the circuit breaker, and only the second must leave
 *    the domain's status alone. Collapsing them fails in both directions at
 *    once — see the file header of `dns-txt-verifier.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";
import {
  buildVerificationRecordName,
  MAX_TXT_RECORDS_SCANNED,
  mintVerificationChallenge,
  mintVerificationRecordValue,
  txtRecordsCarryValue,
  VERIFICATION_VALUE_PREFIX
} from "../src/modules/tenant-domain/domain/domain-verification-challenge";
import { resolveVerificationTxtRecords } from "../src/modules/tenant-domain/infrastructure/dns-txt-verifier";

afterEach(() => {
  resetProviderCircuitBreakersForTests();
});

/** A c-ares-shaped error: the code is on `.code`, not in the message. */
function dnsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`queryTxt ${code}`), { code });
}

describe("the challenge is derived from the hostname being claimed", () => {
  test("the record name lives in the claimed zone, under an underscore label", () => {
    const built = buildVerificationRecordName("shop.example.com");

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.recordName).toBe("_awcms-verify.shop.example.com");
  });

  test("a hostname with no room for the label is refused, not truncated", () => {
    const label = "a".repeat(60);
    const built = buildVerificationRecordName(
      [label, label, label, label, "com"].join(".")
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hostname_too_long");
  });

  test("values are unguessable and never repeat", () => {
    const minted = new Set(
      Array.from({ length: 200 }, () => mintVerificationRecordValue())
    );

    expect(minted.size).toBe(200);

    for (const value of minted) {
      expect(value).toStartWith(VERIFICATION_VALUE_PREFIX);
      // 32 bytes as base64url — 43 characters, no padding.
      expect(value.slice(VERIFICATION_VALUE_PREFIX.length)).toMatch(
        /^[A-Za-z0-9_-]{43}$/
      );
    }
  });

  test("two domains never share a challenge, even in the same tenant", () => {
    const a = mintVerificationChallenge("one.example.com");
    const b = mintVerificationChallenge("one.example.com");

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Same hostname, same name — different value. Publishing one zone's record
    // must never activate a second row.
    expect(a.challenge.recordName).toBe(b.challenge.recordName);
    expect(a.challenge.recordValue).not.toBe(b.challenge.recordValue);
  });
});

describe("matching a TXT record set", () => {
  test("finds the challenge among unrelated records", () => {
    const expected = mintVerificationRecordValue();

    expect(
      txtRecordsCarryValue(
        [["v=spf1 -all"], ["google-site-verification=xyz"], [expected]],
        expected
      )
    ).toBe(true);
  });

  test("concatenates a multi-chunk record with NO separator", () => {
    // RFC 1035 caps one character-string at 255 octets, so a long value arrives
    // split. Joining with a space — or reading only chunks[0] — is the classic
    // way this comparison silently stops matching once the value grows.
    const expected = `${VERIFICATION_VALUE_PREFIX}${"x".repeat(300)}`;
    const chunks = [expected.slice(0, 255), expected.slice(255)];

    expect(txtRecordsCarryValue([chunks], expected)).toBe(true);
    expect(chunks.join(" ")).not.toBe(expected);
  });

  test("tolerates whitespace a zone editor added, and nothing else", () => {
    const expected = mintVerificationRecordValue();

    expect(txtRecordsCarryValue([[` ${expected} `]], expected)).toBe(true);
    // base64url is case-sensitive: folding case would shrink the search space.
    expect(txtRecordsCarryValue([[expected.toUpperCase()]], expected)).toBe(
      false
    );
    // A near miss is a miss.
    expect(txtRecordsCarryValue([[`${expected}x`]], expected)).toBe(false);
    expect(txtRecordsCarryValue([], expected)).toBe(false);
  });

  test("bounds how many records it will scan", () => {
    const expected = mintVerificationRecordValue();
    const padding = Array.from({ length: MAX_TXT_RECORDS_SCANNED }, () => [
      "noise"
    ]);

    expect(txtRecordsCarryValue([...padding, [expected]], expected)).toBe(
      false
    );
    expect(txtRecordsCarryValue([[expected], ...padding], expected)).toBe(true);
  });
});

describe("classifying what the resolver said", () => {
  test("records that resolved are handed back", async () => {
    const result = await resolveVerificationTxtRecords(
      "_awcms-verify.example.com",
      { resolver: async () => [["hello"]] }
    );

    expect(result.outcome).toBe("records");
    if (result.outcome !== "records") return;
    expect(result.records).toEqual([["hello"]]);
  });

  test("NXDOMAIN and NODATA are ABSENT — facts about the claimed domain", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      const result = await resolveVerificationTxtRecords(
        "_awcms-verify.example.com",
        {
          resolver: async () => {
            throw dnsError(code);
          }
        }
      );

      expect(result.outcome, code).toBe("absent");
    }
  });

  test("SERVFAIL and friends are UNAVAILABLE — facts about our resolver", async () => {
    for (const code of ["ESERVFAIL", "EREFUSED", "ECONNREFUSED"]) {
      const result = await resolveVerificationTxtRecords(
        "_awcms-verify.example.com",
        {
          resolver: async () => {
            throw dnsError(code);
          }
        }
      );

      expect(result.outcome, code).toBe("unavailable");
      resetProviderCircuitBreakersForTests();
    }
  });

  test("an UNRECOGNISED code is unavailable, never absent", async () => {
    // Fail-safe in the direction that matters: a code this list has not met
    // must never be read as "the record is definitely not there" and mark a
    // correctly-configured domain `failed`.
    const result = await resolveVerificationTxtRecords(
      "_awcms-verify.example.com",
      {
        resolver: async () => {
          throw dnsError("EWHATEVER");
        }
      }
    );

    expect(result.outcome).toBe("unavailable");
  });

  test("an absent record does NOT push the breaker toward open", async () => {
    // The D6 rule. The provider breaker opens after 5 consecutive failures, so
    // without this a handful of tenants with unpublished records would stop
    // verification for the whole deployment.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await resolveVerificationTxtRecords(
        "_awcms-verify.example.com",
        {
          resolver: async () => {
            throw dnsError("ENOTFOUND");
          }
        }
      );

      expect(result.outcome, `attempt ${attempt}`).toBe("absent");
    }
  });

  test("repeated resolver failures DO open the breaker, and it says so", async () => {
    const failing = async (): Promise<string[][]> => {
      throw dnsError("ESERVFAIL");
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await resolveVerificationTxtRecords("_awcms-verify.example.com", {
        resolver: failing
      });
    }

    let called = false;
    const result = await resolveVerificationTxtRecords(
      "_awcms-verify.example.com",
      {
        resolver: async () => {
          called = true;
          return [];
        }
      }
    );

    expect(result.outcome).toBe("unavailable");
    if (result.outcome !== "unavailable") return;
    expect(result.reason).toBe("circuit_open");
    expect(called).toBe(false);
  });

  test("a wedged resolver times out rather than holding the request open", async () => {
    const result = await resolveVerificationTxtRecords(
      "_awcms-verify.example.com",
      { resolver: () => new Promise<string[][]>(() => {}), timeoutMs: 25 }
    );

    expect(result.outcome).toBe("unavailable");
    if (result.outcome !== "unavailable") return;
    expect(result.reason).toBe("timeout");
  });
});

describe("the verify route's shape", () => {
  const ROUTE = "src/pages/api/v1/tenant/domains/[id]/verify.ts";

  /**
   * The character range of the call that starts at `openIndex`, found by
   * balancing parentheses. String literals and comments are not tracked, which
   * is why the source is comment-stripped first and why this is only used on a
   * file whose call arguments contain no unbalanced parenthesis in a string.
   */
  function callExtent(source: string, openIndex: number): [number, number] {
    const start = source.indexOf("(", openIndex);
    let depth = 0;

    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) return [start, index];
      }
    }

    throw new Error("unbalanced call");
  }

  test("the DNS lookup happens OUTSIDE every transaction (ADR-0006)", async () => {
    // The single most important structural property of this route, and the one
    // a well-meaning simplification would undo first: folding the three phases
    // back into one `withTenant` holds a pooled connection open for as long as
    // somebody else's resolver takes, which is how one slow dependency becomes
    // a database outage.
    const source = stripComments(await Bun.file(ROUTE).text());
    const lookupAt = source.indexOf("resolveVerificationTxtRecords(");

    expect(lookupAt).toBeGreaterThan(-1);

    let searchFrom = source.indexOf("withTenant(");
    let transactions = 0;

    while (searchFrom !== -1) {
      const [open, close] = callExtent(source, searchFrom);
      transactions += 1;

      expect(
        lookupAt > open && lookupAt < close,
        "resolveVerificationTxtRecords is inside a withTenant callback"
      ).toBe(false);

      searchFrom = source.indexOf("withTenant(", close);
    }

    expect(transactions).toBe(2);
  });

  test("the transaction that WRITES authorises for itself (ADR-0063)", async () => {
    // Phase 1's decision is stale by the time phase 3 runs: a session revoked
    // or a permission withdrawn while DNS was being queried must stop the
    // write, not merely have stopped the read.
    const source = stripComments(await Bun.file(ROUTE).text());
    const guards = source.split("authorizeInTransaction(").length - 1;

    expect(guards).toBe(2);
  });

  test("a resolver failure writes nothing", async () => {
    // "We could not find out" is not "the record is not there". The 503 must be
    // returned before the second transaction is ever opened.
    const source = stripComments(await Bun.file(ROUTE).text());
    const unavailableAt = source.indexOf('lookup.outcome === "unavailable"');
    const secondTransactionAt = source.lastIndexOf("withTenant(");

    expect(unavailableAt).toBeGreaterThan(-1);
    expect(unavailableAt).toBeLessThan(secondTransactionAt);
  });
});
