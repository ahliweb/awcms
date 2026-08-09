/**
 * The push HTTP surface (Issue #466).
 *
 * Two kinds of assertion here, and the split is deliberate.
 *
 * The VALIDATOR is pure, so it is exercised directly with real inputs — the
 * cheapest and strongest evidence available.
 *
 * The ROUTES are not testable end to end without a database and a session, and
 * the properties that matter most about them are structural: that the recipient
 * of a notification is never read from the request, that ownership is a WHERE
 * clause rather than a post-hoc comparison, that a machine credential is
 * refused before any database work. Those are asserted against source text, and
 * each such assertion is written to fail when the property is removed rather
 * than when the wording changes — the trap this repo has hit three times, where
 * a check matched the very comment explaining what the code no longer does.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_PUSH_ENDPOINT_LENGTH,
  validateSubscriptionInput
} from "../src/modules/push-delivery/domain/subscription-input";
import { isPushRecordId } from "../src/modules/push-delivery/domain/push-record-id";
import { PUSH_MESSAGE_STATUSES } from "../src/modules/push-delivery/application/push-diagnostics";
import { pushDeliveryModule } from "../src/modules/push-delivery/module";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";
import { stripComments } from "../scripts/access-chokepoint-check";

/** 65 bytes, base64url — an uncompressed P-256 point's size, not a real key. */
const VALID_P256DH = Buffer.alloc(65, 7).toString("base64url");
/** 16 bytes, base64url — RFC 8291 §3.2 auth secret size. */
const VALID_AUTH = Buffer.alloc(16, 9).toString("base64url");

const VALID_WEB_PUSH = {
  transport: "web_push",
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abcdef",
  keys: { p256dh: VALID_P256DH, auth: VALID_AUTH }
};

function errorFields(body: unknown): string[] {
  const result = validateSubscriptionInput(body);

  return result.valid ? [] : result.errors.map((error) => error.field);
}

describe("registration payload validation", () => {
  test("accepts the browser's own PushSubscription.toJSON() shape", () => {
    const result = validateSubscriptionInput(VALID_WEB_PUSH);

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.transport).toBe("web_push");
    expect(result.value.p256dhKey).toBe(VALID_P256DH);
    expect(result.value.authSecret).toBe(VALID_AUTH);
  });

  test("accepts an fcm registration token with no keys", () => {
    const result = validateSubscriptionInput({
      transport: "fcm",
      endpoint: "cXVpdGVhbG9uZ29wYXF1ZXRva2Vu:APA91bExample"
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.p256dhKey).toBeUndefined();
    expect(result.value.authSecret).toBeUndefined();
  });

  test("rejects an http: endpoint", () => {
    // RFC 8030 §6 defines the endpoint as an https: URL. Over http: the VAPID
    // authorization header travels in the clear even though the payload does
    // not, so accepting one would hand out a signed bearer assertion.
    expect(
      errorFields({ ...VALID_WEB_PUSH, endpoint: "http://push.example/x" })
    ).toContain("endpoint");
  });

  test("rejects an endpoint whose host is a literal private address", () => {
    // The DNS-dependent half of this question is answered by `ssrfSafeFetch` at
    // send time, because a DNS answer given here would be stale by then. This
    // half needs no resolver and is therefore refused at the door: no push
    // service issues `https://10.0.0.5/...`, and an authenticated caller
    // registering one is aiming the dispatcher at the inside of the network.
    for (const host of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "[::1]"]) {
      expect(
        errorFields({ ...VALID_WEB_PUSH, endpoint: `https://${host}/wpush/x` })
      ).toContain("endpoint");
    }
  });

  test("a public host is still accepted — the check is not a blanket refusal", () => {
    expect(
      validateSubscriptionInput({
        ...VALID_WEB_PUSH,
        endpoint: "https://fcm.googleapis.com/wp/abc"
      }).valid
    ).toBe(true);
  });

  test("rejects key material that is not the RFC 8291 size", () => {
    expect(
      errorFields({
        ...VALID_WEB_PUSH,
        keys: {
          p256dh: Buffer.alloc(64, 1).toString("base64url"),
          auth: VALID_AUTH
        }
      })
    ).toContain("keys.p256dh");

    expect(
      errorFields({
        ...VALID_WEB_PUSH,
        keys: {
          p256dh: VALID_P256DH,
          auth: Buffer.alloc(12, 1).toString("base64url")
        }
      })
    ).toContain("keys.auth");
  });

  test("rejects a web_push registration with no keys at all", () => {
    // The DB CHECK would refuse this too, but as a 500 from a constraint
    // violation rather than a 422 naming the field.
    const { keys: _dropped, ...withoutKeys } = VALID_WEB_PUSH;

    expect(errorFields(withoutKeys)).toEqual(["keys.p256dh", "keys.auth"]);
  });

  test("rejects an fcm registration that carries keys", () => {
    // Not silently dropped: a client sending both has confused its two
    // registration paths, and storing the row anyway produces a subscription
    // that cannot deliver while the response says it was created.
    expect(
      errorFields({
        transport: "fcm",
        endpoint: "token",
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH }
      })
    ).toContain("keys");
  });

  test("rejects an unknown transport", () => {
    expect(errorFields({ ...VALID_WEB_PUSH, transport: "apns" })).toContain(
      "transport"
    );
  });

  test("rejects an endpoint past the length bound", () => {
    const tooLong = `https://push.example/${"a".repeat(MAX_PUSH_ENDPOINT_LENGTH)}`;

    expect(errorFields({ ...VALID_WEB_PUSH, endpoint: tooLong })).toContain(
      "endpoint"
    );
  });

  test("rejects a non-object body without throwing", () => {
    for (const body of [null, "string", 42, ["array"]]) {
      expect(validateSubscriptionInput(body).valid).toBe(false);
    }
  });
});

describe("path parameters are shape-checked before they reach Postgres", () => {
  test("a uuid passes, anything else does not", () => {
    expect(isPushRecordId("0f9e5a3c-1b2d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(true);
    // Without this guard each of these reaches Postgres as a uuid literal and
    // comes back as 22P02 — a thrown error inside `withTenant`, so a malformed
    // path segment is reported as a 500.
    for (const value of ["", "not-a-uuid", "12345", undefined]) {
      expect(isPushRecordId(value)).toBe(false);
    }
  });
});

describe("the recipient of a notification is never taken from the request", () => {
  const testRoute = readFileSync("src/pages/api/v1/push/test.ts", "utf8");
  const registerRoute = readFileSync(
    "src/pages/api/v1/push/subscriptions/index.ts",
    "utf8"
  );

  test("the probe sends to the authenticated caller and to nobody else", () => {
    // The whole security argument for this endpoint. A recipient parameter
    // would make it an arbitrary-notification surface: system-branded text,
    // chosen by the sender, on a colleague's lock screen.
    expect(testRoute).toContain("[auth.context.tenantUserId]");

    // Asserted against the CODE, not the file: the first draft of this test
    // searched the whole source for /recipient/i and matched its own docblock —
    // the explanation of why there is no recipient parameter read as proof that
    // there was one. This repo has hit that shape three times, and it is always
    // the fix that plants the false positive, because a fix explains itself.
    const code = stripComments(testRoute);

    for (const inputSource of [
      "readJsonBody",
      "searchParams",
      "params.",
      "prepare"
    ]) {
      expect(code).not.toContain(inputSource);
    }
  });

  test("registration binds the device to the resolved session, not to a body field", () => {
    expect(registerRoute).toContain(
      "tenantUserId: principal.context.tenantUserId"
    );
    // `validation.value` is spread into the same object literal, so this is the
    // assertion that the spread cannot introduce a caller-chosen owner: the
    // validator's output type has no such field, and neither does its parser.
    const validator = readFileSync(
      "src/modules/push-delivery/domain/subscription-input.ts",
      "utf8"
    );

    expect(validator).not.toContain("tenantUserId");
  });

  test("the probe's title and body are literals in the route", () => {
    expect(testRoute).toContain('title: "Push notification test"');
    expect(testRoute).not.toContain("body: prepared");
  });
});

describe("ownership is enforced in the statement, not after a read", () => {
  const directory = readFileSync(
    "src/modules/push-delivery/application/subscription-directory.ts",
    "utf8"
  );

  test("revocation matches tenant_user_id inside the UPDATE", () => {
    // A fetch-then-compare would leave a window between the two, and would also
    // have to decide what to say about a row it read but may not touch — which
    // is how an existence oracle gets built by accident.
    expect(directory).toContain("AND tenant_user_id = ${tenantUserId}");
    expect(directory).toContain("AND status = 'active'");
  });

  test("revocation destroys the stored endpoint", () => {
    // The distinction from `disablePushSubscription`: that one records what the
    // push service said and keeps the (dead) endpoint as evidence. This one
    // records what the PERSON said, about an endpoint that may still be live.
    expect(directory).toContain("endpoint = ${REVOKED_ENDPOINT_TOMBSTONE}");
  });

  test("re-registration restores the endpoint a revocation destroyed", () => {
    // Without `endpoint = EXCLUDED.endpoint` in the upsert, a device that
    // re-subscribed would come back `active` still pointing at the tombstone:
    // visible in the console, undeliverable in fact.
    const upsert = directory.slice(
      directory.indexOf("ON CONFLICT ON CONSTRAINT"),
      directory.indexOf("RETURNING id, tenant_user_id")
    );

    expect(upsert).toContain("endpoint = EXCLUDED.endpoint");
    expect(upsert).toContain("status = 'active'");
  });
});

describe("a machine credential is refused before any database work", () => {
  test.each([["subscriptions/index.ts"], ["subscriptions/[id].ts"]])(
    "push/%s",
    (route) => {
      // A machine credential has no browser and no device. Refused in
      // `beforeTransaction`, which runs before `withTenant` opens a connection,
      // and answered with the ordinary 401 so the endpoint cannot classify a
      // bearer somebody is holding.
      const source = readFileSync(`src/pages/api/v1/push/${route}`, "utf8");

      expect(source).toContain("beforeTransaction");
      expect(source).toContain("isMachineCredentialToken(token)");
    }
  );
});

describe("the self-service routes carry the suspension check the chokepoint would have", () => {
  test("registration refuses a suspended tenant", () => {
    // ADR-0073 made suspension a SERVICE status. Guarded routes get it from
    // `authorizeInTransaction`; these three do not go through it, so the one
    // class of endpoint that skips the guard must not become the one place a
    // suspended tenant can still add outbound capacity.
    const source = readFileSync(
      "src/pages/api/v1/push/subscriptions/index.ts",
      "utf8"
    );

    expect(source).toContain("isTenantServiceStopped(principal.tenantStatus)");
    expect(source).toContain("TENANT_SUSPENDED");
  });
});

describe("the diagnostics surface cannot reach the raw endpoint", () => {
  test("only the subscription directory names the raw column", () => {
    // The rule the module's README states, asserted rather than trusted: this
    // is the file that hands an endpoint to a provider, and it is the only one
    // allowed to select it.
    const diagnostics = readFileSync(
      "src/modules/push-delivery/application/push-diagnostics.ts",
      "utf8"
    );

    expect(diagnostics).toContain("endpoint_masked");
    expect(diagnostics).not.toMatch(/SELECT[^;]*\bendpoint\b(?!_masked)/s);
  });

  test("the message projection omits the notification body", () => {
    // Category, status and error are what diagnose a delivery. The body is the
    // one field here that carries user-facing content, and a console is read by
    // people who are not its recipient.
    const diagnostics = readFileSync(
      "src/modules/push-delivery/application/push-diagnostics.ts",
      "utf8"
    );
    const projection = diagnostics.slice(
      diagnostics.indexOf("type MessageRow"),
      diagnostics.indexOf("export async function listRecentPushAttempts")
    );

    expect(projection).toContain("m.title");
    expect(projection).not.toContain("m.body");
  });

  test("every queue status is enumerated in code, so an empty bucket is still reported", () => {
    // A summary built only from the rows present makes "no failures" and
    // "failures nobody asked about" render identically.
    expect([...PUSH_MESSAGE_STATUSES].sort()).toEqual([
      "cancelled",
      "failed",
      "queued",
      "retry_wait",
      "sending",
      "sent"
    ]);
  });
});

describe("the permission set matches what is actually guarded", () => {
  const declared = (pushDeliveryModule.permissions ?? []).map(
    (permission) => `${permission.activityCode}.${permission.action}`
  );

  test("three permissions, and none of them is about one's own device", () => {
    expect(declared.sort()).toEqual([
      "diagnostics.check",
      "diagnostics.read",
      "messages.cancel"
    ]);
    // The absence is the point: a `subscriptions.create` permission would put a
    // wall in front of the feature, and an action nothing seeds denies even the
    // owner while the calling code reads as correctly guarded.
    expect(declared.some((key) => key.startsWith("subscriptions."))).toBe(
      false
    );
  });

  test("each one is seeded by the migration that claims to seed them", () => {
    const migration = readFileSync(
      "sql/094_awcms_push_delivery_permissions.sql",
      "utf8"
    );

    for (const permission of pushDeliveryModule.permissions ?? []) {
      expect(migration).toContain(
        `('push_delivery', '${permission.activityCode}', '${permission.action}'`
      );
    }
  });

  test("all three are ledgered as screenless, and the ledger names the module", () => {
    // A one-way ledger: giving these a screen and leaving the lines here turns
    // `admin:screen-coverage:check` RED, which is what keeps the count honest.
    for (const permission of pushDeliveryModule.permissions ?? []) {
      expect(NOT_YET_SCREENED).toContain(
        `push_delivery.${permission.activityCode}.${permission.action}`
      );
    }
  });
});
