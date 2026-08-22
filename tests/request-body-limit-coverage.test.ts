/**
 * No route reads a request body without a ceiling — finding A4 of the
 * 17 August 2026 audit round.
 *
 * ## The one that was unauthenticated
 *
 * Twenty-five route files called `request.json()`, `.text()` or `.formData()`
 * directly. All three read the WHOLE body before returning anything, with no
 * bound. Twenty-four were behind a resolved session, so the exposure was a
 * caller spending its own authenticated quota.
 *
 * `data-lifecycle/dry-run.ts` was not. It calls `resolveAuthInputs`, which
 * checks that a tenant header and a token are PRESENT — it resolves neither —
 * and then read the body. Two arbitrary strings were enough to reach it.
 *
 * ## Why the middleware pre-check did not cover it
 *
 * `checkContentLengthCeiling` returns `true` when the header is ABSENT. A
 * chunked request declares no `Content-Length`, so the one case that needs a
 * ceiling is precisely the case that pre-check waves through. That is asserted
 * here rather than assumed, because it is the reason the finding exists and it
 * reads like a control.
 *
 * ## What is executed, not read
 *
 * The bounded readers are driven with real streaming `Request` objects that
 * declare no length — the exact shape the middleware cannot see — and the
 * assertion is that the read STOPS. A source-level check could not tell a
 * ceiling that works from one that is merely present.
 */
import { describe, expect, test } from "bun:test";

import {
  BODY_SIZE_TIER_BYTES,
  checkContentLengthCeiling,
  readFormBody,
  readJsonBody,
  readTextBody
} from "../src/lib/security/request-body-limit";
import { evaluateBodyLimits } from "../scripts/request-body-limit-check";

/**
 * A POST whose body arrives in chunks and declares no `Content-Length` — what
 * any HTTP client does when it does not know the size in advance, and what the
 * middleware's pre-check cannot judge.
 *
 * `pushed` counts what the producer actually emitted, so a test can assert the
 * reader stopped pulling rather than merely that it answered.
 */
function chunkedRequest(
  totalBytes: number,
  chunkSize = 64 * 1024
): { request: Request; pushed: () => number } {
  let pushed = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pushed >= totalBytes) {
        controller.close();
        return;
      }

      const size = Math.min(chunkSize, totalBytes - pushed);
      pushed += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    }
  });

  return {
    request: new Request("http://localhost/api/v1/thing", {
      method: "POST",
      body: stream,
      // @ts-expect-error — Node/Bun require this for a streaming body.
      duplex: "half"
    }),
    pushed: () => pushed
  };
}

describe("the middleware pre-check cannot see the case that matters", () => {
  test("a request declaring NO Content-Length passes it", () => {
    // Not a defect in `checkContentLengthCeiling` — it is documented as a cheap
    // global pre-check — but it is why a per-route ceiling is the enforcement,
    // and why "the middleware handles it" was never true for a chunked body.
    const { request } = chunkedRequest(1024);

    expect(request.headers.get("content-length")).toBeNull();
    expect(checkContentLengthCeiling(request)).toBe(true);
  });

  test("it does refuse an honestly-declared oversized body", () => {
    // NON-VACUOUS: the pre-check is not simply broken, it answers a narrower
    // question than the one this finding is about.
    const request = new Request("http://localhost/api/v1/thing", {
      method: "POST",
      headers: { "content-length": String(64 * 1024 * 1024) },
      body: "x"
    });

    expect(checkContentLengthCeiling(request)).toBe(false);
  });
});

describe("the bounded readers stop, and stop EARLY", () => {
  const limit = BODY_SIZE_TIER_BYTES.default;

  test("readJsonBody refuses an unbounded chunked body", async () => {
    const { request, pushed } = chunkedRequest(limit * 8);
    const result = await readJsonBody(request);

    expect(result.tooLarge).toBe(true);
    if (!result.tooLarge) return;
    expect(result.limitBytes).toBe(limit);

    // The property that matters: it did not buffer the whole thing first. A
    // ceiling applied AFTER the read is not a ceiling.
    expect(pushed()).toBeLessThan(limit * 2);
  });

  test("readTextBody refuses it too", async () => {
    const { request, pushed } = chunkedRequest(limit * 8);
    const result = await readTextBody(request);

    expect(result.tooLarge).toBe(true);
    expect(pushed()).toBeLessThan(limit * 2);
  });

  test("readFormBody refuses it too", async () => {
    const { request, pushed } = chunkedRequest(limit * 8);
    const result = await readFormBody(request);

    expect(result.tooLarge).toBe(true);
    expect(pushed()).toBeLessThan(limit * 2);
  });

  test("a body inside the limit is still read whole", async () => {
    // NON-VACUOUS again: a reader that refused everything would satisfy every
    // assertion above.
    const request = new Request("http://localhost/api/v1/thing", {
      method: "POST",
      body: JSON.stringify({ hello: "world" })
    });

    const result = await readJsonBody<{ hello: string }>(request);

    expect(result.tooLarge).toBe(false);
    if (result.tooLarge) return;
    expect(result.malformed).toBe(false);
    expect(result.value).toEqual({ hello: "world" });
  });
});

describe("empty and malformed are told apart", () => {
  test("an empty body is `null`, not malformed", async () => {
    const request = new Request("http://localhost/api/v1/thing", {
      method: "POST"
    });

    const result = await readJsonBody(request);

    expect(result.tooLarge).toBe(false);
    if (result.tooLarge) return;
    expect(result.malformed).toBe(false);
    expect(result.value).toBeNull();
  });

  test("bytes that are not JSON are malformed, not empty", async () => {
    // Collapsing these two into one `null` — which this reader used to do —
    // turns a route's "Request body must be valid JSON" 400 into a
    // field-validation 400 with a different sentence, or into a silent accept
    // where an empty body is legitimate. Several converted routes answer
    // differently for each, so the distinction is load-bearing rather than
    // tidy.
    const request = new Request("http://localhost/api/v1/thing", {
      method: "POST",
      body: "{not json"
    });

    const result = await readJsonBody(request);

    expect(result.tooLarge).toBe(false);
    if (result.tooLarge) return;
    expect(result.malformed).toBe(true);
    expect(result.value).toBeNull();
  });

  test("readFormBody parses urlencoded pairs", async () => {
    const request = new Request("http://localhost/api/v1/thing", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "locale=id&return_to=%2Fadmin"
    });

    const result = await readFormBody(request);

    expect(result.tooLarge).toBe(false);
    if (result.tooLarge) return;
    expect(result.value.get("locale")).toBe("id");
    expect(result.value.get("return_to")).toBe("/admin");
    // Absent stays `null`, which is what the two converted routes branch on.
    expect(result.value.get("missing")).toBeNull();
  });
});

describe("the gate that keeps the next route bounded", () => {
  test("a raw read is reported", () => {
    const result = evaluateBodyLimits(
      [
        {
          path: "src/pages/api/v1/thing/index.ts",
          content: "const body = await request.json();"
        }
      ],
      []
    );

    expect(result.unbounded).toEqual(["src/pages/api/v1/thing/index.ts"]);
  });

  test("all three readers are caught, not only json", () => {
    for (const call of [
      "await request.text()",
      "await request.formData()",
      "await request . json ()"
    ]) {
      const result = evaluateBodyLimits(
        [{ path: "src/pages/api/v1/thing.ts", content: `const b = ${call};` }],
        []
      );

      expect(result.unbounded).toEqual(["src/pages/api/v1/thing.ts"]);
    }
  });

  test("a docblock explaining the bounded reader is not a call", () => {
    // Several converted routes carry exactly this paragraph, so a gate that
    // could not tell prose from code would have failed the very change that
    // fixed the finding.
    const result = evaluateBodyLimits(
      [
        {
          path: "src/pages/api/v1/thing.ts",
          content: [
            "/**",
            " * `await request.json()` waits on the CLIENT, so it is read before the",
            " * transaction opens — see readJsonBody.",
            " */",
            "// request.text() — also not a call",
            "const body = await readJsonBody(request);"
          ].join("\n")
        }
      ],
      []
    );

    expect(result.unbounded).toEqual([]);
  });

  test("the exemption list may only shrink", () => {
    const result = evaluateBodyLimits(
      [{ path: "src/pages/api/v1/thing.ts", content: "readJsonBody(request)" }],
      ["src/pages/api/v1/thing.ts"]
    );

    expect(result.stale).toEqual(["src/pages/api/v1/thing.ts"]);
  });
});
