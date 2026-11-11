/**
 * The progress-stream loop, caps, Origin rule and the WhatsApp sender cursor
 * codec (Issue #1171, ADR-0154). Pure: no database, no network, no real timers.
 */
import { describe, expect, test } from "bun:test";

import {
  createSseConnectionRegistry,
  declaredAppOrigin,
  DEFAULT_SSE_CONNECTION_LIMITS,
  formatSseEventWithId,
  isStreamOriginAllowed,
  resolveSseRuntimeLimits,
  runProgressSseLoop,
  SSE_ERROR_EVENT,
  SSE_HEARTBEAT_COMMENT,
  SSE_OPENING_COMMENT,
  SSE_REVOKED_EVENT,
  SSE_SLOW_CONSUMER_EVENT,
  SSE_SNAPSHOT_REQUIRED_EVENT,
  SSE_STREAM_EXPIRED_EVENT,
  type ProgressLoopEffects,
  type ProgressTickOutcome
} from "../src/modules/_shared/sse-progress";
import {
  encodeSenderCursor,
  parseSenderCursor,
  parseSenderId,
  senderCursorTimestampMs,
  zeroSenderCursor
} from "../src/modules/whatsapp-delivery/application/whatsapp-sender-progress";

const LIMITS = {
  maxFrameBytes: 2_000,
  slowConsumerBytes: 1_000,
  slowConsumerGraceMs: 3_000,
  heartbeatMs: 10_000
};

/** A fake clock advanced by every wait, so "time" is the number of ticks. */
function harness(options: {
  ticks: ProgressTickOutcome[];
  tickMs?: number;
  maxTicks?: number;
  buffered?: (tickIndex: number) => number | null;
  expireAfterTicks?: number;
  clientGoneAfterTicks?: number;
}) {
  const chunks: string[] = [];
  let clock = 0;
  let waits = 0;
  let tickCalls = 0;
  const tickMs = options.tickMs ?? 5_000;

  const effects: ProgressLoopEffects = {
    initialEvents: [
      { event: "progress", id: "c0", data: { v: 1, counts: { sent: 0 } } }
    ],
    oversizeReplacement: () => ({
      event: SSE_SNAPSHOT_REQUIRED_EVENT,
      id: "head",
      data: { reason: "too_many_changes" }
    }),
    tick: async () => {
      const outcome =
        options.ticks[Math.min(tickCalls, options.ticks.length - 1)]!;
      tickCalls += 1;
      return outcome;
    },
    write: (chunk) => {
      chunks.push(chunk);
    },
    waitForNextTick: async () => {
      waits += 1;
      clock += tickMs;
    },
    finished: () => {
      if (
        options.clientGoneAfterTicks !== undefined &&
        waits >= options.clientGoneAfterTicks
      ) {
        return "client";
      }
      if (
        options.expireAfterTicks !== undefined &&
        waits >= options.expireAfterTicks
      ) {
        return "expired";
      }
      if (waits >= (options.maxTicks ?? 50)) return "client";
      return null;
    },
    bufferedBytes: () => (options.buffered ? options.buffered(waits) : null),
    now: () => clock,
    limits: LIMITS,
    retryMs: 5_000
  };

  return {
    chunks,
    stats: () => ({ waits, tickCalls }),
    run: () => runProgressSseLoop(effects)
  };
}

const ok = (events: ProgressTickOutcome extends infer T ? T : never) => events;

describe("opening", () => {
  test("first byte is the opening comment plus a retry hint, then the initial frame with its cursor", async () => {
    const h = harness({ ticks: [{ state: "ok", events: [] }], maxTicks: 0 });

    await h.run();

    expect(h.chunks[0]!.startsWith(SSE_OPENING_COMMENT)).toBe(true);
    expect(h.chunks[0]).toContain("retry: 5000");
    expect(h.chunks[1]).toStartWith("id: c0\nevent: progress\ndata: ");
  });
});

describe("revocation and errors are terminal and named", () => {
  test("a deny on the third tick ends the stream with authorization-revoked", async () => {
    const h = harness({
      ticks: [
        { state: "ok", events: [] },
        { state: "ok", events: [] },
        { state: "denied", status: 403 }
      ]
    });
    const result = await h.run();

    expect(result.endedBy).toBe("revoked");
    expect(result.deniedStatus).toBe(403);
    expect(h.stats().tickCalls).toBe(3);
    expect(h.chunks.at(-1)).toContain(`event: ${SSE_REVOKED_EVENT}`);
  });

  test("an expired session (401) is a revocation too", async () => {
    const h = harness({ ticks: [{ state: "denied", status: 401 }] });
    const result = await h.run();

    expect(result.endedBy).toBe("revoked");
    expect(h.chunks.at(-1)).toContain('"status":401');
  });

  test("a refusing database ends with stream-error, not a retry loop", async () => {
    const h = harness({ ticks: [{ state: "error" }] });
    const result = await h.run();

    expect(result.endedBy).toBe("error");
    expect(h.stats().tickCalls).toBe(1);
    expect(h.chunks.at(-1)).toContain(`event: ${SSE_ERROR_EVENT}`);
  });
});

describe("coalescing and heartbeat", () => {
  test("quiet ticks write a heartbeat only once the heartbeat interval has passed", async () => {
    const h = harness({ ticks: [{ state: "ok", events: [] }], maxTicks: 6 });
    const result = await h.run();

    // Five reads (5 s .. 25 s) with a 10 s heartbeat: written at 10 s and 20 s.
    expect(result.heartbeatsWritten).toBe(2);
    expect(h.chunks.filter((c) => c === SSE_HEARTBEAT_COMMENT)).toHaveLength(2);
  });

  test("a tick with events writes them with their cursor and no heartbeat", async () => {
    const h = harness({
      ticks: [
        {
          state: "ok",
          events: [
            { event: "progress", id: "c1", data: { counts: { sent: 1 } } }
          ]
        }
      ],
      maxTicks: 2
    });
    const result = await h.run();

    expect(result.heartbeatsWritten).toBe(0);
    expect(h.chunks.at(-1)).toStartWith("id: c1\n");
  });

  test("an oversize frame is replaced by snapshot-required, never sent bigger", async () => {
    const h = harness({
      ticks: [
        {
          state: "ok",
          events: [
            { event: "progress", id: "c1", data: { pad: "x".repeat(5_000) } }
          ]
        }
      ],
      maxTicks: 2
    });

    await h.run();

    expect(h.chunks.at(-1)).toContain(`event: ${SSE_SNAPSHOT_REQUIRED_EVENT}`);
    expect(h.chunks.every((c) => c.length < LIMITS.maxFrameBytes)).toBe(true);
  });
});

describe("lifetime and client departure", () => {
  test("the lifetime ceiling ends with stream-expired (the one ending that invites a reconnect)", async () => {
    const h = harness({
      ticks: [{ state: "ok", events: [] }],
      expireAfterTicks: 3
    });
    const result = await h.run();

    expect(result.endedBy).toBe("expired");
    expect(h.chunks.at(-1)).toContain(`event: ${SSE_STREAM_EXPIRED_EVENT}`);
  });

  test("a departed client ends the loop without another read or write", async () => {
    const h = harness({
      ticks: [{ state: "ok", events: [] }],
      clientGoneAfterTicks: 2
    });
    const result = await h.run();
    const written = h.chunks.length;

    expect(result.endedBy).toBe("client");
    expect(h.stats().tickCalls).toBe(1);
    expect(h.chunks).toHaveLength(written);
  });
});

describe("slow consumers", () => {
  test("a client that stays behind past the grace period is evicted, and no frame or read happens while behind", async () => {
    const h = harness({
      ticks: [
        { state: "ok", events: [{ event: "progress", id: "c", data: {} }] }
      ],
      buffered: (tick) => (tick >= 2 ? 5_000 : 0)
    });
    const result = await h.run();

    expect(result.endedBy).toBe("slow_consumer");
    // Tick 1 read and wrote; from tick 2 the client is behind: no more reads.
    expect(h.stats().tickCalls).toBe(1);
    expect(result.framesSkippedForPressure).toBeGreaterThan(0);
    expect(h.chunks.at(-1)).toContain(`event: ${SSE_SLOW_CONSUMER_EVENT}`);
  });

  test("a client that catches up inside the grace period is kept", async () => {
    const h = harness({
      ticks: [{ state: "ok", events: [] }],
      buffered: (tick) => (tick === 2 ? 5_000 : 0),
      maxTicks: 8
    });
    const result = await h.run();

    expect(result.endedBy).toBe("client");
    expect(result.framesSkippedForPressure).toBe(1);
  });

  test("an unmeasurable transport (null) never evicts", async () => {
    const h = harness({
      ticks: [{ state: "ok", events: [] }],
      buffered: () => null,
      maxTicks: 8
    });

    expect((await h.run()).endedBy).toBe("client");
  });
});

describe("event formatting", () => {
  test("an id with a line break is refused, so a cursor can never inject a field", () => {
    expect(() =>
      formatSseEventWithId({ event: "progress", id: "a\nevent: x", data: {} })
    ).toThrow();
  });
});

describe("connection caps", () => {
  const limits = { perActor: 2, perTenant: 3, perInstance: 4 };

  test("per actor, then per tenant, then per instance; release is idempotent", () => {
    const registry = createSseConnectionRegistry();
    const a1 = registry.tryAcquire("t1", "u1", limits);
    const a2 = registry.tryAcquire("t1", "u1", limits);
    const a3 = registry.tryAcquire("t1", "u1", limits);

    expect(a1.ok && a2.ok).toBe(true);
    expect(a3).toEqual({ ok: false, refusedBy: "actor" });

    expect(registry.tryAcquire("t1", "u2", limits).ok).toBe(true);
    expect(registry.tryAcquire("t1", "u3", limits)).toEqual({
      ok: false,
      refusedBy: "tenant"
    });

    expect(registry.tryAcquire("t2", "u9", limits).ok).toBe(true);
    expect(registry.tryAcquire("t3", "u9", limits)).toEqual({
      ok: false,
      refusedBy: "instance"
    });
    expect(registry.openCount()).toBe(4);

    if (!a1.ok) throw new Error("unreachable");
    a1.lease.release();
    a1.lease.release();
    expect(registry.openCount()).toBe(3);
    expect(registry.tryAcquire("t1", "u1", limits).ok).toBe(true);
  });

  test("the same actor id in two tenants is two actors", () => {
    const registry = createSseConnectionRegistry();
    const one = { perActor: 1, perTenant: 10, perInstance: 10 };

    expect(registry.tryAcquire("t1", "u1", one).ok).toBe(true);
    expect(registry.tryAcquire("t2", "u1", one).ok).toBe(true);
  });

  test("env limits fall back to defaults when unset or malformed, never to unlimited", () => {
    expect(resolveSseRuntimeLimits({}).connections).toEqual(
      DEFAULT_SSE_CONNECTION_LIMITS
    );
    const parsed = resolveSseRuntimeLimits({
      REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR: "0",
      REALTIME_SSE_MAX_CONNECTIONS_PER_TENANT: "-5",
      REALTIME_SSE_MAX_CONNECTIONS_PER_INSTANCE: "12",
      REALTIME_SSE_SLOW_CONSUMER_BYTES: "abc"
    });

    expect(parsed.connections).toEqual({
      perActor: DEFAULT_SSE_CONNECTION_LIMITS.perActor,
      perTenant: DEFAULT_SSE_CONNECTION_LIMITS.perTenant,
      perInstance: 12
    });
    expect(parsed.slowConsumerBytes).toBe(262_144);
  });
});

describe("Origin", () => {
  const allowed = ["https://app.example", "https://tenant.example"];

  test("absent Origin is allowed (same-origin EventSource need not send one)", () => {
    expect(isStreamOriginAllowed(null, allowed)).toBe(true);
  });

  test("own origins are allowed, case-insensitively", () => {
    expect(isStreamOriginAllowed("https://APP.example", allowed)).toBe(true);
  });

  test("a foreign, a scheme-downgraded, an empty and the literal null origin are refused", () => {
    expect(isStreamOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isStreamOriginAllowed("http://app.example", allowed)).toBe(false);
    expect(isStreamOriginAllowed("", allowed)).toBe(false);
    expect(isStreamOriginAllowed("null", allowed)).toBe(false);
    expect(
      isStreamOriginAllowed("https://app.example.evil.example", allowed)
    ).toBe(false);
  });

  test("APP_URL contributes its origin only", () => {
    expect(declaredAppOrigin({ APP_URL: "https://app.example/base/" })).toBe(
      "https://app.example"
    );
    expect(declaredAppOrigin({ APP_URL: "not a url" })).toBeNull();
  });
});

describe("the WhatsApp sender cursor", () => {
  const account = "11111111-2222-4333-8444-555555555555";
  const message = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  test("round-trips and names its account", () => {
    const cursor = encodeSenderCursor({
      accountId: account,
      micros: "1762858800123456",
      messageId: message
    });

    expect(parseSenderCursor(cursor)).toEqual({
      accountId: account,
      micros: "1762858800123456",
      messageId: message
    });
    expect(senderCursorTimestampMs(cursor)).toBe(1762858800123);
  });

  test("malformed, injected or over-long cursors do not parse", () => {
    for (const bad of [
      "",
      "!",
      "wsp1.x.1.y",
      `wsp1.${account}.01.${message}`,
      `wsp1.${account}.1.${message}\nevent: x`,
      `wsp2.${account}.1.${message}`,
      `wsp1.${account}.1234567890123456789.${message}`
    ]) {
      expect(parseSenderCursor(bad)).toBeNull();
    }
  });

  test("the zero cursor parses and carries no timestamp", () => {
    expect(parseSenderCursor(zeroSenderCursor(account))?.micros).toBe("0");
    expect(senderCursorTimestampMs(zeroSenderCursor(account))).toBeNull();
  });

  test("path ids: only a uuid is a resource; everything else is not-found", () => {
    expect(parseSenderId(account.toUpperCase())).toBe(account);
    for (const bad of [undefined, "", "../x", "1 OR 1=1", `${account}x`]) {
      expect(parseSenderId(bad)).toBeNull();
    }
  });
});

void ok;
