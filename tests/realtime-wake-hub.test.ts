/**
 * The wake-up hub (Issue #1171, ADR-0154 section 2 and 7), driven with an
 * injected clock and timer: no database, no wall clock.
 */
import { describe, expect, test } from "bun:test";

import {
  createWakeHub,
  MAX_WAKE_PAYLOAD_BYTES,
  parseWakeHint
} from "../src/lib/realtime/wake-hub";

const TOPIC = "inbox.status.progress";
const OTHER_TOPIC = "whatsapp.sender.progress";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const KNOWN = new Set([TOPIC, OTHER_TOPIC]);

function payload(tenantId: string, topic = TOPIC): string {
  return JSON.stringify({ t: tenantId, k: topic });
}

/** A hub with a manual clock: `advance` moves time and runs due timers. */
function fixture(throttleMs = 250) {
  let time = 1_000_000;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  const hub = createWakeHub({
    knownTopics: KNOWN,
    throttleMs,
    now: () => time,
    setTimer: (callback, ms) => {
      const id = nextId++;

      timers.push({ at: time + ms, run: callback, id });

      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);

      if (index >= 0) timers.splice(index, 1);
    }
  });

  return {
    hub,
    pendingTimers: () => timers.length,
    advance(ms: number) {
      time += ms;

      for (const due of timers
        .filter((t) => t.at <= time)
        .sort((a, b) => a.at - b.at)) {
        timers.splice(timers.indexOf(due), 1);
        due.run();
      }
    }
  };
}

describe("parseWakeHint: the payload is untrusted input", () => {
  test("accepts exactly a tenant id and a known topic", () => {
    expect(parseWakeHint(payload(TENANT_A), KNOWN)).toEqual({
      tenantId: TENANT_A,
      topic: TOPIC
    });
  });

  test.each([
    ["not json", "{nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a string", '"x"'],
    ["a missing key", JSON.stringify({ t: TENANT_A })],
    [
      "an extra key (a row id or any other field is refused, not ignored)",
      JSON.stringify({ t: TENANT_A, k: TOPIC, r: "row-1" })
    ],
    ["a non-uuid tenant", JSON.stringify({ t: "tenant-a", k: TOPIC })],
    [
      "an uppercase uuid",
      JSON.stringify({ t: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", k: TOPIC })
    ],
    ["an unknown topic", JSON.stringify({ t: TENANT_A, k: "other.topic" })],
    ["a numeric topic", JSON.stringify({ t: TENANT_A, k: 1 })],
    [
      "an oversized payload",
      JSON.stringify({ t: TENANT_A, k: TOPIC, pad: "x".repeat(300) })
    ]
  ])("refuses %s", (_name, raw) => {
    expect(parseWakeHint(raw, KNOWN)).toBeNull();
  });

  test("the ceiling is far below PostgreSQL's 8000-byte NOTIFY limit", () => {
    expect(MAX_WAKE_PAYLOAD_BYTES).toBeLessThan(1000);
    expect(payload(TENANT_A).length).toBeLessThan(MAX_WAKE_PAYLOAD_BYTES);
  });
});

describe("tenant and topic isolation", () => {
  test("a hint wakes only the subscribers of its own tenant and topic", () => {
    const { hub } = fixture();
    const woken: string[] = [];

    hub.subscribe(TENANT_A, TOPIC, () => woken.push("A/inbox"));
    hub.subscribe(TENANT_B, TOPIC, () => woken.push("B/inbox"));
    hub.subscribe(TENANT_A, OTHER_TOPIC, () => woken.push("A/whatsapp"));

    expect(hub.dispatch(payload(TENANT_A))).toBe("delivered");
    expect(woken).toEqual(["A/inbox"]);
  });

  test("a hint for a tenant with no stream here is dropped and leaves no state", () => {
    const { hub } = fixture();

    expect(hub.dispatch(payload(TENANT_B))).toBe("no_subscriber");
    expect(hub.subscriberCount()).toBe(0);
  });

  test("a malformed payload wakes nobody", () => {
    const { hub } = fixture();
    let woken = 0;

    hub.subscribe(TENANT_A, TOPIC, () => (woken += 1));

    expect(hub.dispatch("garbage")).toBe("malformed");
    expect(hub.dispatch(JSON.stringify({ t: TENANT_A, k: "x.y" }))).toBe(
      "malformed"
    );
    expect(woken).toBe(0);
  });

  test("unsubscribing stops delivery and releases the key", () => {
    const { hub } = fixture();
    let woken = 0;
    const unsubscribe = hub.subscribe(TENANT_A, TOPIC, () => (woken += 1));

    unsubscribe();

    expect(hub.dispatch(payload(TENANT_A))).toBe("no_subscriber");
    expect(woken).toBe(0);
    expect(hub.subscriberCount()).toBe(0);
  });

  test("a throwing subscriber does not starve the others", () => {
    const { hub } = fixture();
    let woken = 0;

    hub.subscribe(TENANT_A, TOPIC, () => {
      throw new Error("boom");
    });
    hub.subscribe(TENANT_A, TOPIC, () => (woken += 1));
    hub.dispatch(payload(TENANT_A));

    expect(woken).toBe(1);
  });
});

describe("throttle: a burst costs two wakes, and the last write is never unannounced", () => {
  test("the first hint wakes at once; the rest collapse into one trailing wake", () => {
    const { hub, advance, pendingTimers } = fixture(250);
    let woken = 0;

    hub.subscribe(TENANT_A, TOPIC, () => (woken += 1));

    for (let i = 0; i < 50; i += 1) hub.dispatch(payload(TENANT_A));

    expect(woken).toBe(1);
    expect(pendingTimers()).toBe(1);

    advance(249);
    expect(woken).toBe(1);

    advance(1);
    expect(woken).toBe(2);
    expect(pendingTimers()).toBe(0);
  });

  test("after the window a new hint wakes immediately again", () => {
    const { hub, advance } = fixture(250);
    let woken = 0;

    hub.subscribe(TENANT_A, TOPIC, () => (woken += 1));
    hub.dispatch(payload(TENANT_A));
    advance(300);
    hub.dispatch(payload(TENANT_A));

    expect(woken).toBe(2);
  });

  test("throttle state is per tenant and topic: a busy tenant does not delay a quiet one", () => {
    const { hub } = fixture(250);
    const woken: string[] = [];

    hub.subscribe(TENANT_A, TOPIC, () => woken.push("A"));
    hub.subscribe(TENANT_B, TOPIC, () => woken.push("B"));
    hub.dispatch(payload(TENANT_A));
    hub.dispatch(payload(TENANT_A));
    hub.dispatch(payload(TENANT_B));

    expect(woken).toEqual(["A", "B"]);
  });

  test("the last unsubscribe cancels a pending trailing wake", () => {
    const { hub, pendingTimers } = fixture(250);
    const unsubscribe = hub.subscribe(TENANT_A, TOPIC, () => undefined);

    hub.dispatch(payload(TENANT_A));
    hub.dispatch(payload(TENANT_A));
    expect(pendingTimers()).toBe(1);

    unsubscribe();
    expect(pendingTimers()).toBe(0);
  });
});

describe("wakeAll: the catch-up after a listener reconnect", () => {
  test("wakes every subscriber of every tenant now, ignoring the throttle", () => {
    const { hub } = fixture(250);
    const woken: string[] = [];

    hub.subscribe(TENANT_A, TOPIC, () => woken.push("A"));
    hub.subscribe(TENANT_B, OTHER_TOPIC, () => woken.push("B"));
    hub.dispatch(payload(TENANT_A));
    hub.wakeAll();

    expect(woken).toEqual(["A", "A", "B"]);
  });
});
