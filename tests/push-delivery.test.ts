/**
 * Issue #465 (epic #463, ADR-0074) — the push outbox, without a database.
 *
 * Two of these deserve saying out loud, because they are the ones that would
 * otherwise be "covered" by a test that cannot fail:
 *
 * - `validatePushTargetPath` is a SECURITY check, not input tidying. A push
 *   notification is rendered outside the page and its click navigates wherever
 *   the payload says, so a queue row that could carry an absolute URL would be
 *   a stored open-redirect arriving with this origin's own name and icon. The
 *   cases below are the five shapes a `startsWith("/")` check waves through.
 * - the retention descriptors are asserted to be `delegated` AND the purge is
 *   asserted to name terminal statuses. Either alone passes while the queue
 *   quietly deletes undelivered work: `generic` would delete by age with no
 *   status predicate at all, and a delegated purge that forgot the predicate
 *   would do the same thing by hand.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { pushDeliveryModule } from "../src/modules/push-delivery/module";
import {
  hashPushEndpoint,
  maskPushEndpoint,
  normalizePushEndpoint
} from "../src/modules/push-delivery/domain/push-endpoint";
import {
  PUSH_MAX_RETRY_DELAY_MINUTES,
  evaluatePushRetry
} from "../src/modules/push-delivery/domain/push-retry";
import { validatePushTargetPath } from "../src/modules/push-delivery/domain/push-target-path";
import {
  KNOWN_PUSH_PROVIDERS,
  PUSH_CIRCUIT_BREAKER_KEY,
  isKnownPushProvider,
  isPushEnabled,
  resolvePushSendMaxRetries
} from "../src/modules/push-delivery/domain/push-config";
import { createLogPushProvider } from "../src/modules/push-delivery/infrastructure/log-push-provider";
import { resolvePushProvider } from "../src/modules/push-delivery/infrastructure/push-provider-resolver";

const WEB_PUSH_ENDPOINT =
  "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHqRs-TOKEN-MATERIAL-x9f2";

describe("targetPath is a same-origin path or it is not stored", () => {
  test.each([
    ["https://evil.test/x", "absolute URL with an authority"],
    ["//evil.test/x", "protocol-relative — resolves to another ORIGIN"],
    ["/\\evil.test", "backslash, normalised to `/` by several browsers"],
    ["javascript:alert(1)", "scheme, which startsWith('/') also misses"],
    ["data:text/html,x", "data URL"],
    ["admin/users", "relative — no leading slash"],
    ["", "empty"]
  ])("rejects %j (%s)", (candidate) => {
    expect(validatePushTargetPath(candidate).valid).toBe(false);
  });

  test.each([
    "/admin/approvals",
    "/admin/approvals?tab=pending",
    "/admin/approvals#row-3",
    "/"
  ])("accepts %j", (candidate) => {
    const result = validatePushTargetPath(candidate);

    expect(result.valid).toBe(true);
  });

  test("traversal is RESOLVED, not merely allowed through", () => {
    // The round-trip is what earns this: `/a/../../b` is same-origin, so it is
    // not rejected — but it is stored normalised, so the value in the row is
    // the destination it actually resolves to rather than one that has to be
    // re-resolved identically by a service worker later.
    const result = validatePushTargetPath("/admin/../../b");

    expect(result).toEqual({ valid: true, path: "/b" });
  });
});

describe("endpoints are handled as credentials", () => {
  test("the mask keeps the push SERVICE visible and the token material hidden", () => {
    const masked = maskPushEndpoint(WEB_PUSH_ENDPOINT);

    // Asserted as EXACT equality rather than `startsWith("https://fcm.googleapis.com")`.
    // Two reasons, and the second is why the first was not enough:
    //   - equality pins the whole shape (origin + separator + tail length), so
    //     it cannot be satisfied by a mask that happens to begin correctly and
    //     then leaks the rest;
    //   - a `startsWith` against a host prefix is the shape CodeQL flags as
    //     `js/incomplete-url-substring-sanitization`, because in PRODUCTION code
    //     `https://fcm.googleapis.com` may be followed by an arbitrary host
    //     (`…com.evil.test`). It was harmless here — a masked string, not a
    //     sanitizer — but writing the check a way that is only safe because of
    //     where it sits teaches the pattern, and the exact assertion is better
    //     anyway.
    expect(masked).toBe("https://fcm.googleapis.com/…L-x9f2");
    // The part that authenticates never appears.
    expect(masked).not.toContain("APA91bHqRs");
    expect(masked.length).toBeLessThan(WEB_PUSH_ENDPOINT.length);
  });

  test("a value too short to mask is hidden ENTIRELY, not revealed", () => {
    // "Mask less when the value is odd" is exactly the wrong instinct, so the
    // short branch is asserted rather than left to reviewer goodwill.
    expect(maskPushEndpoint("short")).toBe("*****");
  });

  test("normalisation trims and NOTHING else", () => {
    // Lower-casing an FCM token would corrupt it; these values are opaque and
    // issued by somebody else.
    expect(normalizePushEndpoint(`  ${WEB_PUSH_ENDPOINT}  `)).toBe(
      WEB_PUSH_ENDPOINT
    );
    expect(normalizePushEndpoint("AbC")).toBe("AbC");
  });

  test("the hash is stable and case-sensitive — it is the dedupe key", () => {
    expect(hashPushEndpoint(WEB_PUSH_ENDPOINT)).toBe(
      hashPushEndpoint(WEB_PUSH_ENDPOINT)
    );
    expect(hashPushEndpoint("AbC")).not.toBe(hashPushEndpoint("abc"));
  });
});

describe("retry policy", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  test("stops exactly at the ceiling", () => {
    expect(evaluatePushRetry(3, 3, now).eligible).toBe(false);
    expect(evaluatePushRetry(2, 3, now).eligible).toBe(true);
  });

  test("backoff is capped — a push delivered an hour late is worse than none", () => {
    const evaluation = evaluatePushRetry(20, 50, now);
    const delayMinutes =
      (evaluation.nextAttemptAt!.getTime() - now.getTime()) / 60_000;

    expect(delayMinutes).toBe(PUSH_MAX_RETRY_DELAY_MINUTES);
  });
});

describe("configuration refuses to promise what does not exist", () => {
  test("the accepted list is EXACTLY the adapters that exist", () => {
    // Naming an adapter before it exists lets a deployment pass
    // `config:validate` and then fail at resolve time, which is the worst place
    // to learn it.
    //
    // This assertion was written as "`fcm`/`web_push` are NOT accepted yet" and
    // has now been edited twice, once per adapter, which is exactly what it is
    // for: the list cannot grow ahead of the code without somebody changing
    // this line in the same PR.
    //
    // Now that the list is complete, the enumeration is pinned rather than the
    // negatives — a spelling that keeps working when the next adapter arrives
    // instead of expiring into "assert two things that are both true".
    expect([...KNOWN_PUSH_PROVIDERS]).toEqual(["log", "fcm", "web_push"]);

    for (const provider of KNOWN_PUSH_PROVIDERS) {
      expect(isKnownPushProvider(provider)).toBe(true);
    }

    expect(isKnownPushProvider("apns")).toBe(false);
    expect(isKnownPushProvider(undefined)).toBe(false);
  });

  test("enabled means exactly the string `true`", () => {
    expect(isPushEnabled({ PUSH_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(
      true
    );
    expect(isPushEnabled({ PUSH_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(
      false
    );
    expect(isPushEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("a nonsense retry ceiling falls back instead of disabling retries", () => {
    expect(
      resolvePushSendMaxRetries({
        PUSH_SEND_MAX_RETRIES: ""
      } as NodeJS.ProcessEnv)
    ).toBe(3);
    // Zero is a legitimate choice ("never retry") and must survive.
    expect(
      resolvePushSendMaxRetries({
        PUSH_SEND_MAX_RETRIES: "0"
      } as NodeJS.ProcessEnv)
    ).toBe(0);
  });
});

describe("provider resolution degrades instead of throwing", () => {
  test("an unknown provider yields a NON-retryable failure", async () => {
    // Retryable would burn every queued row's retry budget against a condition
    // only an operator can change, then bury the real cause under an exhausted
    // retry count.
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "nope"
    } as NodeJS.ProcessEnv);
    const result = await provider.send(
      { transport: "fcm", endpoint: "x", endpointMasked: "x" },
      { title: "t", body: "b" }
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryable).toBe(false);
  });

  test("the dispatcher reads the SHARED breaker key, not its own literal", () => {
    // A mismatch between the reader and the (future) recorder is silent in the
    // worst way: the dispatcher would consult a breaker nothing ever trips, so
    // it would report `breakerOpen: false` forever while the provider was down.
    // `email` carries the same coupling as two matching literals.
    const source = readFileSync(
      "src/modules/push-delivery/application/push-dispatch.ts",
      "utf8"
    );

    expect(source).toContain(
      "getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY)"
    );
    expect(source).not.toContain('getProviderCircuitBreaker("');
    expect(PUSH_CIRCUIT_BREAKER_KEY).toBe("push-delivery");
  });

  test("the log adapter claims BOTH transports", async () => {
    // A log adapter that claimed one would make half the queue unroutable in
    // development for a reason unrelated to the code under test.
    const provider = createLogPushProvider();

    expect([...provider.supportedTransports].sort()).toEqual([
      "fcm",
      "web_push"
    ]);
    expect((await provider.healthCheck()).ok).toBe(true);
  });
});

describe("retention cannot silently delete undelivered work", () => {
  const descriptors = pushDeliveryModule.dataLifecycle ?? [];

  test("all three tables carry a descriptor from the day they exist", () => {
    // `TABLES_PREDATING_THE_RULE` is closed to new tables and
    // `BOUNDED_BY_DESIGN` is empty, so there was never an option to defer this.
    expect(descriptors.map((d) => d.tableName).sort()).toEqual([
      "awcms_push_delivery_attempts",
      "awcms_push_messages",
      "awcms_push_subscriptions"
    ]);
  });

  test("every descriptor is `delegated` — `generic` deletes by age with no status predicate", () => {
    for (const descriptor of descriptors) {
      expect(descriptor.executionMode).toBe("delegated");
      expect(descriptor.existingAdopter?.purgeFunctionRef).toContain(
        "push-queue-purge.ts#purgePushQueue"
      );
    }
  });

  test("the queue and subscription sweeps are keyed on `updated_at`, not `created_at`", () => {
    // `created_at` would measure a long-retried message from before its last
    // attempt, deleting it while it was still being worked on.
    const byTable = new Map(descriptors.map((d) => [d.tableName, d]));

    expect(byTable.get("awcms_push_messages")!.cursorColumn).toBe("updated_at");
    expect(byTable.get("awcms_push_subscriptions")!.cursorColumn).toBe(
      "updated_at"
    );
  });

  test("the purge NAMES the terminal statuses — the descriptor cannot express it", () => {
    // This is the assertion that makes the one above worth having. The
    // descriptor type has no status field, so "delegated" only moves the
    // responsibility here; if the delegated implementation forgets the
    // predicate it deletes pending work exactly as the generic engine would.
    const source = readFileSync(
      "src/modules/push-delivery/application/push-queue-purge.ts",
      "utf8"
    );

    expect(source).toContain("status IN ('sent', 'failed', 'cancelled')");
    expect(source).toContain("s.status = 'disabled'");
    // And never the other way round: a DELETE mentioning a live status would be
    // deleting work in flight.
    expect(source).not.toContain("'queued'");
    expect(source).not.toContain("'retry_wait'");
  });

  test("a legal hold is checked per descriptor, all three of them", () => {
    const source = readFileSync(
      "src/modules/push-delivery/application/push-queue-purge.ts",
      "utf8"
    );

    for (const key of [
      "PUSH_ATTEMPTS_LIFECYCLE_KEY",
      "PUSH_MESSAGES_LIFECYCLE_KEY",
      "PUSH_SUBSCRIPTIONS_LIFECYCLE_KEY"
    ]) {
      expect(source).toContain(
        `isDescriptorHeld(\n          tx,\n          tenantId,\n          ${key}`
      );
    }
  });
});

describe("the module reached a complete surface in three steps", () => {
  test("API, permissions and navigation are all declared, and it is active", () => {
    // This assertion has been rewritten twice, and the sequence is the record
    // of how the module was allowed to ship incomplete without pretending
    // otherwise: it first asserted all three were ABSENT (a queue with no way
    // to reach it), then that navigation alone was missing (endpoints, no
    // console). ADR-0021 criterion 1 is what forced each step to be honest —
    // an `active` module with no admin screen is refused with zero exceptions,
    // so `experimental` was the only truthful status until the screen existed.
    // `tests/admin-push-notifications-page-contract.test.ts` owns the details.
    expect(pushDeliveryModule.api?.basePath).toBe("/api/v1/push");
    expect(pushDeliveryModule.permissions).toBeDefined();
    expect(pushDeliveryModule.navigation).toHaveLength(1);
    expect(pushDeliveryModule.status).toBe("active");
  });

  test("both jobs are declared and both are safe on an offline/LAN deployment", () => {
    const commands = (pushDeliveryModule.jobs ?? []).map((j) => j.command);

    expect(commands).toEqual([
      "bun run push:dispatch",
      "bun run push:queue:purge"
    ]);
    for (const job of pushDeliveryModule.jobs ?? []) {
      expect(job.safeInOfflineLan).toBe(true);
    }
  });
});
