/**
 * StarSender contract fixtures (Issue #1142).
 *
 * PROVENANCE, stated so nobody mistakes these for captured traffic: the SUCCESS
 * body is copied from the public documentation page
 * https://docs.starsender.online/docs/message-api/kirim-pesan/ (read 3 November
 * 2026). That page documents NO error response, so every failure body below is a
 * plausible shape written for this test, chosen to exercise a branch of the
 * classifier (a `success: false` at HTTP 200, a disconnected device, malformed
 * JSON). NONE of this has been verified against the live API: the fields and the
 * wording are assumptions until someone with a StarSender test device runs the
 * checklist in docs/awcms/starsender-adapter-runbook.md.
 *
 * Every secret-looking value is a canary, not a credential.
 */
export const DEVICE_KEY_A = "CANARY-device-key-A-7f3c9a1e";
export const DEVICE_KEY_B = "CANARY-device-key-B-2d8e4b60";

export type HttpAnswer = { status: number; body: string } | { reason: string };

export type Expectation = {
  ok: boolean;
  failureCode?: string;
  retryable?: boolean;
};

export type Fixture = {
  name: string;
  answer: HttpAnswer;
  expect: Expectation;
};

export const FIXTURES: readonly Fixture[] = [
  {
    name: "success (documented body): accepted by StarSender, not delivered",
    answer: {
      status: 200,
      body: '{"success":true,"data":{},"message":"Success sent message"}'
    },
    expect: { ok: true }
  },
  {
    name: "rejected: HTTP 200 with success:false is a failure, not an acceptance",
    answer: {
      status: 200,
      body: '{"success":false,"data":{},"message":"Invalid number"}'
    },
    expect: { ok: false, failureCode: "rejected", retryable: false }
  },
  {
    name: "rejected: HTTP 200 with success:false that echoes the number and key",
    answer: {
      status: 200,
      body: `{"success":false,"message":"Cannot send to 6281234567890 with ${DEVICE_KEY_A}"}`
    },
    expect: { ok: false, failureCode: "rejected", retryable: false }
  },
  {
    name: "rate limited: HTTP 429",
    answer: {
      status: 429,
      body: '{"success":false,"message":"Too many requests"}'
    },
    expect: { ok: false, failureCode: "rate_limited", retryable: true }
  },
  {
    name: "rate limited: HTTP 200 success:false naming a limit",
    answer: {
      status: 200,
      body: '{"success":false,"message":"Rate limit exceeded, try later"}'
    },
    expect: { ok: false, failureCode: "rate_limited", retryable: true }
  },
  {
    name: "transient 5xx: HTTP 503",
    answer: { status: 503, body: "<html>Service Unavailable</html>" },
    expect: { ok: false, failureCode: "provider_error", retryable: true }
  },
  {
    name: "transient 5xx: HTTP 500 with a JSON error",
    answer: {
      status: 500,
      body: '{"success":false,"message":"Internal error"}'
    },
    expect: { ok: false, failureCode: "provider_error", retryable: true }
  },
  {
    name: "timeout: the request may have been processed, so NOT retried",
    answer: { reason: "outbound request refused: request_failed" },
    expect: { ok: false, failureCode: "outcome_unknown", retryable: false }
  },
  {
    name: "response too large: also an unknown outcome",
    answer: { reason: "outbound request refused: response_too_large" },
    expect: { ok: false, failureCode: "outcome_unknown", retryable: false }
  },
  {
    name: "DNS failure: the request never left, safe to retry",
    answer: { reason: "outbound request refused: dns_resolution_failed" },
    expect: { ok: false, failureCode: "network_error", retryable: true }
  },
  {
    name: "address blocked by the SSRF guard: configuration, not retried",
    answer: { reason: "outbound request refused: blocked_address" },
    expect: { ok: false, failureCode: "endpoint_refused", retryable: false }
  },
  {
    name: "redirect: refused, never followed",
    answer: { reason: "outbound request refused: too_many_redirects" },
    expect: { ok: false, failureCode: "unexpected_redirect", retryable: false }
  },
  {
    name: "malformed response: HTTP 200 that is not JSON is NOT an acceptance",
    answer: { status: 200, body: "OK" },
    expect: { ok: false, failureCode: "malformed_response", retryable: false }
  },
  {
    name: "malformed response: JSON without a boolean success",
    answer: { status: 200, body: '{"status":"ok"}' },
    expect: { ok: false, failureCode: "malformed_response", retryable: false }
  },
  {
    name: "malformed response: success is the string 'true'",
    answer: { status: 200, body: '{"success":"true"}' },
    expect: { ok: false, failureCode: "malformed_response", retryable: false }
  },
  {
    name: "malformed response: message is not a string",
    answer: { status: 200, body: '{"success":true,"message":{"a":1}}' },
    expect: { ok: false, failureCode: "malformed_response", retryable: false }
  },
  {
    name: "malformed response: a JSON array",
    answer: { status: 200, body: "[true]" },
    expect: { ok: false, failureCode: "malformed_response", retryable: false }
  },
  {
    name: "credential mismatch: HTTP 401",
    answer: { status: 401, body: '{"success":false,"message":"Unauthorized"}' },
    expect: { ok: false, failureCode: "unauthorized", retryable: false }
  },
  {
    name: "credential mismatch: HTTP 403",
    answer: { status: 403, body: "" },
    expect: { ok: false, failureCode: "unauthorized", retryable: false }
  },
  {
    name: "disconnected device: HTTP 200 success:false (English)",
    answer: {
      status: 200,
      body: '{"success":false,"message":"Device is not connected"}'
    },
    expect: { ok: false, failureCode: "device_disconnected", retryable: true }
  },
  {
    name: "disconnected device: HTTP 400 (Indonesian)",
    answer: {
      status: 400,
      body: '{"success":false,"message":"Perangkat terputus, silakan scan ulang"}'
    },
    expect: { ok: false, failureCode: "device_disconnected", retryable: true }
  },
  {
    name: "other client error: terminal rejection",
    answer: { status: 422, body: '{"success":false,"message":"bad field"}' },
    expect: { ok: false, failureCode: "rejected", retryable: false }
  }
];
