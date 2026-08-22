/**
 * One JSON mutation, three projections — finding D12.
 *
 * There were three near-identical copies of the same `fetch` in
 * `src/lib/ui/`, and they had ALREADY drifted: `sendJson` and `sendJsonForData`
 * supported `extraHeaders`, bodyless requests and `DELETE`;
 * `sendJsonWithFieldErrors` supported none of it until Issue #596 added the
 * first by hand.
 *
 * It was ALSO argued as a byte saving, and that argument was wrong: both files
 * were already shared chunks shipped once each, so consolidating them recovered
 * nothing. The 425 B measured at the time came from an uncleaned `dist/`.
 *
 * What the consolidation must NOT do is merge the three public functions.
 * Their differing return shapes are a control, not an accident: `sendJson`'s
 * narrow `{ ok, errorCode }` is what stops thirty-odd admin screens painting
 * internal server detail onto the page (Issue #540). So the tests below assert
 * the shared behaviour once and the per-projection NARROWING three times.
 *
 * `fetch` is stubbed rather than mocked at module level — `mock.module` mutates
 * the live namespace for the rest of the process, which this repo has been bitten
 * by before.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  sendJson,
  sendJsonForData,
  sendJsonRequest
} from "../src/lib/ui/admin-form-client";
import { sendJsonWithFieldErrors } from "../src/lib/ui/admin-field-errors-client";

const realFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }) as unknown as typeof fetch;
}

function stubNetworkFailure(): void {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
}

function headersOf(call: Call): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

describe("the shared request core", () => {
  test("sends cookie credentials, so no screen needs a tenant header", () => {
    // `resolveAuthInputs` reads the tenant from the `awcms_tenant_id` cookie.
    // An admin form that had to set `X-AWCMS-Tenant-ID` by hand is a form that
    // will one day set the wrong one.
    stubFetch(200, { success: true });

    return sendJsonRequest("POST", "/api/v1/x", { a: 1 }).then(() => {
      expect(calls[0]!.init.credentials).toBe("same-origin");
    });
  });

  test("a bodyless request attaches neither a body nor a Content-Type", async () => {
    stubFetch(200, { success: true });

    await sendJsonRequest("DELETE", "/api/v1/roles/1");

    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.headers).toBeUndefined();
  });

  test("extraHeaders ride along but never override Content-Type", async () => {
    // The two copies disagreed about this: the field-errors one merged
    // `extraHeaders` OVER `Content-Type`, so a caller could have replaced it.
    // Nothing did, and this is the order both docblocks claimed.
    stubFetch(200, { success: true });

    await sendJsonRequest(
      "POST",
      "/api/v1/x",
      { a: 1 },
      {
        "Idempotency-Key": "abc",
        "Content-Type": "text/plain"
      }
    );

    const headers = headersOf(calls[0]!);
    expect(headers["Idempotency-Key"]).toBe("abc");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("a 200 whose body is not success:true is a failure", async () => {
    // Both halves are required. An endpoint that answers 200 with
    // `success: false` has failed, and treating the status alone as the verdict
    // would reload the page over an unapplied change.
    stubFetch(200, { success: false, error: { code: "NOPE" } });

    const result = await sendJsonRequest("POST", "/api/v1/x", {});

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("NOPE");
  });

  test("a body that is not JSON at all does not throw", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>502</html>", {
        status: 502
      })) as unknown as typeof fetch;

    const result = await sendJsonRequest("POST", "/api/v1/x", {});

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBeNull();
  });

  test("a network failure is an errorCode, never an exception", async () => {
    stubNetworkFailure();

    const result = await sendJsonRequest("POST", "/api/v1/x", {});

    expect(result).toEqual({
      ok: false,
      errorCode: "NETWORK_ERROR",
      payload: null
    });
  });
});

describe("the three projections narrow, and each narrowing is the point", () => {
  test("sendJson answers ONLY ok and errorCode", async () => {
    // Issue #540: thirty-odd call sites show a generic message keyed off
    // `errorCode`. If `data` or `details` reached them, one of them would
    // eventually render it.
    stubFetch(200, {
      success: true,
      data: { secret: "internal" },
      error: { details: [{ field: "x", message: "y" }] }
    });

    const result = await sendJson("POST", "/api/v1/x", {});

    expect(Object.keys(result).sort()).toEqual(["errorCode", "ok"]);
  });

  test("sendJsonForData returns data on success and NOTHING on failure", async () => {
    stubFetch(200, { success: true, data: { code: "one-time" } });

    const okResult = await sendJsonForData<{ code: string }>(
      "POST",
      "/api/v1/x",
      {}
    );
    expect(okResult.data).toEqual({ code: "one-time" });

    // The error half stays narrow: a failed call still cannot leak anything,
    // even when the server put something in `data` alongside the error.
    stubFetch(403, {
      success: false,
      data: { leaked: true },
      error: { code: "ACCESS_DENIED" }
    });

    const failed = await sendJsonForData<{ leaked: boolean }>(
      "POST",
      "/api/v1/x",
      {}
    );
    expect(failed.data).toBeNull();
    expect(failed.errorCode).toBe("ACCESS_DENIED");
  });

  test("sendJsonWithFieldErrors names fields, and only shape-checked ones", async () => {
    stubFetch(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        details: [
          { field: "contentText", message: "required" },
          { notAFieldError: true },
          "a bare string"
        ]
      }
    });

    const result = await sendJsonWithFieldErrors("POST", "/api/v1/x", {});

    // Shape-checked rather than cast: other endpoints put other things in
    // `details`, and a screen must not render `undefined` because one of them
    // did.
    expect(result.fieldErrors).toEqual([
      { field: "contentText", message: "required" }
    ]);
    expect(result.errorCode).toBe("VALIDATION_ERROR");
  });

  test("sendJsonWithFieldErrors returns no field errors on success", async () => {
    stubFetch(200, {
      success: true,
      error: { details: [{ field: "a", message: "b" }] }
    });

    const result = await sendJsonWithFieldErrors("POST", "/api/v1/x", {});

    expect(result.ok).toBe(true);
    expect(result.fieldErrors).toEqual([]);
  });

  test("all three agree on a network failure", async () => {
    stubNetworkFailure();

    const [narrow, withData, withFields] = await Promise.all([
      sendJson("POST", "/api/v1/x", {}),
      sendJsonForData("POST", "/api/v1/x", {}),
      sendJsonWithFieldErrors("POST", "/api/v1/x", {})
    ]);

    expect(narrow.errorCode).toBe("NETWORK_ERROR");
    expect(withData.errorCode).toBe("NETWORK_ERROR");
    expect(withFields.errorCode).toBe("NETWORK_ERROR");
    expect(withFields.fieldErrors).toEqual([]);
  });
});

describe("the dead one is gone", () => {
  test("postJson no longer exists, and nothing imports it", async () => {
    // It had zero callers while its docblock claimed to serve "the existing
    // create-form call sites" — a comment that made a wrapper look load-bearing
    // and stopped anyone deleting it.
    const source = await Bun.file("src/lib/ui/admin-form-client.ts").text();

    expect(source).not.toContain("postJson");

    for await (const file of new Bun.Glob("src/**/*.{ts,astro}").scan({
      cwd: process.cwd()
    })) {
      expect(await Bun.file(file).text(), file).not.toContain("postJson");
    }
  });

  test("the field-errors module no longer carries its own fetch", async () => {
    // The consolidation itself, asserted where it happened. This module used to
    // hold a second copy of the whole request — which is how it ended up
    // without `extraHeaders` until Issue #596 and without bodyless/`DELETE`
    // support at all.
    const source = await Bun.file(
      "src/lib/ui/admin-field-errors-client.ts"
    ).text();

    expect(source).toContain("sendJsonRequest(");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain('credentials: "same-origin"');
  });

  test("nothing outside the core re-checks the success envelope on a mutation", async () => {
    // `payload?.success === true` is the admin API's contract, and re-writing
    // it beside a hand-built mutation is how the three copies started.
    //
    // Four other files in this directory `fetch` with same-origin credentials
    // and are deliberately NOT folded in. `media-picker-client.ts` and
    // `term-picker-client.ts` read the envelope on a GET — a read of the same
    // contract, not a second copy of the request.
    // `language-switcher-client.ts` POSTs ANONYMOUSLY to a public endpoint and
    // decides by `response.ok` plus a cookie, never by the envelope; routing it
    // through the admin helper would tie a public control to a contract it does
    // not share. `push-subscription-client.ts` deliberately surfaces the
    // server's own `error.message` and reads `data.subscription.endpointMasked`
    // — the exact things `sendJson`'s narrow shape exists to withhold, so
    // folding it in would mean widening that shape for everyone.
    //
    // What this catches is the combination: a hand-built MUTATION that also
    // re-implements the success check. That is the shape all three copies had.
    const offenders: string[] = [];

    for await (const file of new Bun.Glob("src/lib/ui/*.ts").scan({
      cwd: process.cwd()
    })) {
      if (file === "src/lib/ui/admin-form-client.ts") continue;

      const source = await Bun.file(file).text();

      if (
        /success\s*[=!]==\s*true/.test(source) &&
        /method:\s*"(POST|PATCH|PUT|DELETE)"/.test(source)
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
