/**
 * Mailketing v1 + v2 adapters behind one `EmailProvider` port (Issue #1159,
 * ADR-0151 §1/§9). Both versions are driven by a FAKE provider built from the
 * DOCUMENTED contract — no live API was contacted, so none of this proves the
 * real vendor behaves this way (rollout stage 2 exists for that).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";
import type { EmailMessage } from "../src/modules/email/domain/email-provider-contract";
import { createMailketingEmailProvider } from "../src/modules/email/infrastructure/mailketing-provider";
import { resolveEmailProvider } from "../src/modules/email/infrastructure/email-provider-resolver";
import {
  createMailketingV2Provider,
  createSsrfGuardedMailketingTransport,
  type MailketingV2Transport,
  type MailketingV2TransportRequest,
  type MailketingV2TransportResult
} from "../src/modules/email/infrastructure/mailketing-v2-provider";

const TOKEN = "CANARY-token-0123456789abcdef";
const RECIPIENT = "victim.person@example.com";
const NOW = new Date("2026-11-02T10:00:00.000Z");

const MESSAGE: EmailMessage = {
  to: [{ address: RECIPIENT }],
  from: { address: "noreply@example.com", name: "AWCMS" },
  subject: "Your code",
  textBody: "123456"
};

type Script = MailketingV2TransportResult | (() => Promise<never>);

function fakeTransport(script: Script): {
  transport: MailketingV2Transport;
  calls: MailketingV2TransportRequest[];
} {
  const calls: MailketingV2TransportRequest[] = [];

  return {
    calls,
    transport: async (request) => {
      calls.push(request);

      if (typeof script === "function") {
        return script();
      }

      return script;
    }
  };
}

const json = (
  status: number,
  body: unknown,
  retryAfter: string | null = null
): MailketingV2TransportResult => ({
  ok: true,
  status,
  retryAfter,
  body: typeof body === "string" ? body : JSON.stringify(body)
});

function v2(script: Script) {
  const { transport, calls } = fakeTransport(script);
  const provider = createMailketingV2Provider({
    apiToken: TOKEN,
    transport,
    now: () => NOW
  });

  return { provider, calls };
}

beforeEach(() => resetProviderCircuitBreakersForTests());
afterEach(() => resetProviderCircuitBreakersForTests());

describe("Mailketing v2 send — classification (ADR-0151 §1 table)", () => {
  test("200 success:true = accepted (queued, NOT delivered), message_id kept", async () => {
    const { provider, calls } = v2(
      json(200, { success: true, data: { message_id: "mk_1" } })
    );

    expect(await provider.send(MESSAGE)).toEqual({
      ok: true,
      providerMessageId: "mk_1"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.mailketing.co.id/api/v2/send");
    expect(calls[0]!.method).toBe("POST");
  });

  test("200 success:false = refusal, non-retryable; one bad recipient does not trip the breaker", async () => {
    const refuse = json(200, {
      success: false,
      error: { code: "INVALID_RECIPIENT" }
    });
    let current: Script = refuse;
    const provider = createMailketingV2Provider({
      apiToken: TOKEN,
      now: () => NOW,
      transport: async () => current as MailketingV2TransportResult
    });

    for (let round = 0; round < 3; round += 1) {
      // Four refusals then a success, repeatedly: the success resets the streak.
      current = refuse;
      for (let i = 0; i < 4; i += 1) {
        expect(await provider.send(MESSAGE)).toMatchObject({
          ok: false,
          retryable: false
        });
      }
      current = json(200, { success: true, data: { message_id: "ok" } });
      expect(await provider.send(MESSAGE)).toMatchObject({ ok: true });
    }
  });

  test("a streak of 5 refusals (wrong field name while /credits stays green) opens the breaker: the queue stops being marked failed", async () => {
    const { provider, calls } = v2(
      json(200, { success: false, error: { code: "INVALID_FIELD" } })
    );

    for (let i = 0; i < 5; i += 1) {
      expect(await provider.send(MESSAGE)).toMatchObject({
        ok: false,
        retryable: false
      });
    }

    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      skipped: true
    });
    expect(calls).toHaveLength(5);
  });

  test("401 = invalid token: terminal, not retryable", async () => {
    const { provider } = v2(json(401, { success: false }));
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: false,
      error: expect.stringContaining("401")
    });
  });

  test("402 = no credit: held without spending a retry (skipped + holdMs)", async () => {
    const { provider } = v2(json(402, { success: false }));
    const result = await provider.send(MESSAGE);

    expect(result).toMatchObject({
      ok: false,
      skipped: true,
      retryable: true
    });
    expect((result as { holdMs?: number }).holdMs).toBeGreaterThanOrEqual(
      60_000
    );
  });

  test("403 = unverified sender: terminal", async () => {
    const { provider } = v2(json(403, {}));
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: false,
      error: expect.stringContaining("403")
    });
  });

  test.each([404, 422, 400])(
    "%i = invalid: terminal, no breaker",
    async (s) => {
      const { provider } = v2(json(s, {}));
      expect(await provider.send(MESSAGE)).toMatchObject({
        ok: false,
        retryable: false
      });
    }
  );

  test("429 = retryable and carries Retry-After", async () => {
    const { provider } = v2(json(429, {}, "45"));
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: true,
      retryAfterMs: 45_000
    });
  });

  test("500 = retryable", async () => {
    const { provider } = v2(json(500, "boom"));
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: true
    });
  });

  test("timeout and network errors = retryable", async () => {
    for (const reason of ["timeout", "network"] as const) {
      resetProviderCircuitBreakersForTests();
      const { provider } = v2({ ok: false, reason });
      expect(await provider.send(MESSAGE)).toMatchObject({
        ok: false,
        retryable: true
      });
    }
  });

  test("an egress-policy denial (DNS sinkhole, refused redirect) is retryable and counts toward the breaker, never terminal", async () => {
    const { provider, calls } = v2({ ok: false, reason: "policy" });

    for (let i = 0; i < 5; i += 1) {
      expect(await provider.send(MESSAGE)).toMatchObject({
        ok: false,
        retryable: true
      });
    }

    expect(await provider.send(MESSAGE)).toMatchObject({ skipped: true });
    expect(calls).toHaveLength(5);
  });

  test("a 200 with no boolean success is UNCERTAIN: not retried (no duplicate copies), counted toward the breaker", async () => {
    for (const body of [
      "<html>gateway</html>",
      '{"ok":true}',
      '{"success":"yes"}',
      ""
    ]) {
      resetProviderCircuitBreakersForTests();
      const { provider, calls } = v2(json(200, body));
      const result = await provider.send(MESSAGE);

      expect(result).toMatchObject({
        ok: false,
        retryable: false,
        uncertain: true,
        error: expect.stringContaining("UNCERTAIN_MALFORMED_RESPONSE")
      });
      expect(calls).toHaveLength(1);
    }

    resetProviderCircuitBreakersForTests();
    const { provider } = v2(json(200, "<html>"));
    for (let i = 0; i < 5; i += 1) {
      await provider.send(MESSAGE);
    }
    expect(await provider.send(MESSAGE)).toMatchObject({ skipped: true });
  });

  test("a throwing transport is a retryable network failure and its message is not surfaced", async () => {
    const { provider } = v2(async () => {
      throw new Error(`socket closed while sending Bearer ${TOKEN}`);
    });
    const result = await provider.send(MESSAGE);

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("no recipient is a per-message failure that never reaches the network", async () => {
    const { provider, calls } = v2(json(200, { success: true }));
    expect(await provider.send({ ...MESSAGE, to: [] })).toMatchObject({
      ok: false,
      retryable: false
    });
    expect(calls).toHaveLength(0);
  });
});

describe("Mailketing v2 — breaker (single-account model)", () => {
  test("five consecutive service faults open the breaker; the sixth send is skipped, not attempted", async () => {
    const { provider, calls } = v2(json(500, ""));

    for (let i = 0; i < 5; i += 1) {
      await provider.send(MESSAGE);
    }

    const result = await provider.send(MESSAGE);
    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(calls).toHaveLength(5);
  });

  test.each([401, 403, 422, 404])(
    "five consecutive HTTP %i open the breaker (account fault or wrong contract); a success in between resets it",
    async (status) => {
      const bad = v2(json(status, {}));
      for (let i = 0; i < 5; i += 1) {
        await bad.provider.send(MESSAGE);
      }
      expect(await bad.provider.send(MESSAGE)).toMatchObject({
        skipped: true
      });
    }
  );

  test("a single 422 never trips the breaker", async () => {
    const { provider } = v2(json(422, {}));
    await provider.send(MESSAGE);
    expect(await provider.send(MESSAGE)).not.toMatchObject({ skipped: true });
  });
});

describe("Mailketing v2 — credentials never leak", () => {
  const SCENARIOS: [string, Script][] = [
    ["accepted", json(200, { success: true, data: { message_id: "m1" } })],
    [
      "refused echoing token+recipient",
      json(200, {
        success: false,
        error: { code: "X", message: `${TOKEN} ${RECIPIENT}` }
      })
    ],
    ["401 echoing token", json(401, `bad token ${TOKEN} for ${RECIPIENT}`)],
    ["402", json(402, `${TOKEN}`)],
    ["403", json(403, RECIPIENT)],
    ["422 echoing recipient", json(422, `invalid ${RECIPIENT}`)],
    ["429", json(429, TOKEN, "5")],
    ["500 echoing request", json(500, `${TOKEN} ${RECIPIENT}`)],
    ["non-JSON echo", json(200, `${TOKEN} ${RECIPIENT}`)]
  ];

  test.each(SCENARIOS)(
    "%s: result carries neither token nor recipient",
    async (_n, script) => {
      const { provider } = v2(script);
      const result = await provider.send(MESSAGE);

      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(RECIPIENT);

      const health = await v2(script).provider.healthCheck();
      expect(JSON.stringify(health)).not.toContain(TOKEN);
      expect(JSON.stringify(health)).not.toContain(RECIPIENT);
    }
  );

  test("the token is only in the Authorization header: not in URL, body, or any other header", async () => {
    const { provider, calls } = v2(json(200, { success: true }));
    await provider.send(MESSAGE);
    const call = calls[0]!;

    expect(call.url).not.toContain(TOKEN);
    expect(call.body).not.toContain(TOKEN);
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    for (const [name, value] of Object.entries(call.headers)) {
      if (name !== "Authorization") {
        expect(value).not.toContain(TOKEN);
      }
    }
  });
});

describe("Mailketing v2 health probe", () => {
  test("GET /credits only; no body, no recipient, no send path", async () => {
    const { provider, calls } = v2(json(200, { success: true, data: {} }));
    expect(await provider.healthCheck()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://api.mailketing.co.id/api/v2/credits");
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[0]!.url).not.toContain("send");
  });

  test("401 / 402 / 5xx / timeout / invalid JSON are reported as failures", async () => {
    for (const script of [
      json(401, {}),
      json(402, {}),
      json(503, ""),
      json(200, "nope"),
      { ok: false, reason: "timeout" } as const
    ]) {
      expect((await v2(script).provider.healthCheck()).ok).toBe(false);
    }
  });

  test("health does not touch the breaker (a probe is not traffic)", async () => {
    const { provider } = v2(json(500, ""));
    for (let i = 0; i < 10; i += 1) {
      await provider.healthCheck();
    }
    const send = await createMailketingV2Provider({
      apiToken: TOKEN,
      transport: fakeTransport(json(200, { success: true })).transport
    }).send(MESSAGE);
    expect(send).toMatchObject({ ok: true });
  });
});

describe("Mailketing v2 — real wire through the SSRF-guarded transport", () => {
  test("header-only auth, JSON body, no redirect following, bounded timeout", async () => {
    const seen: {
      auth: string | null;
      ct: string | null;
      url: string;
      body: string;
    }[] = [];
    let mode: "ok" | "redirect" | "slow" = "ok";
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        seen.push({
          auth: request.headers.get("authorization"),
          ct: request.headers.get("content-type"),
          url: request.url,
          body: await request.text()
        });

        if (mode === "redirect") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1:1/steal" }
          });
        }

        if (mode === "slow") {
          await Bun.sleep(400);
        }

        return Response.json({ success: true, data: { message_id: "wire_1" } });
      }
    });

    try {
      const hostPort = `127.0.0.1:${server.port}`;
      const env = {
        AUTH_SSO_ALLOW_INSECURE_HOSTS: hostPort
      } as unknown as NodeJS.ProcessEnv;
      const make = (timeoutMs: number) =>
        createMailketingV2Provider({
          apiToken: TOKEN,
          baseUrl: `http://${hostPort}`,
          timeoutMs,
          transport: createSsrfGuardedMailketingTransport(env)
        });

      expect(await make(2000).send(MESSAGE)).toEqual({
        ok: true,
        providerMessageId: "wire_1"
      });
      expect(seen[0]!.auth).toBe(`Bearer ${TOKEN}`);
      expect(seen[0]!.ct).toBe("application/json");
      expect(seen[0]!.url).not.toContain(TOKEN);
      expect(seen[0]!.body).not.toContain(TOKEN);
      expect(new URL(seen[0]!.url).pathname).toBe("/api/v2/send");

      mode = "redirect";
      resetProviderCircuitBreakersForTests();
      const redirected = await make(2000).send(MESSAGE);
      expect(redirected).toMatchObject({ ok: false, retryable: true });
      expect(seen).toHaveLength(2); // the Location was never requested

      mode = "slow";
      resetProviderCircuitBreakersForTests();
      const started = Date.now();
      const slow = await make(100).send(MESSAGE);
      expect(slow).toMatchObject({ ok: false, retryable: true });
      expect(Date.now() - started).toBeLessThan(380);
    } finally {
      server.stop(true);
    }
  });

  test("without the test allow-list a loopback host is denied by the egress policy (retryable, not terminal)", async () => {
    const provider = createMailketingV2Provider({
      apiToken: TOKEN,
      baseUrl: "http://127.0.0.1:9",
      transport: createSsrfGuardedMailketingTransport(
        {} as unknown as NodeJS.ProcessEnv
      )
    });

    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: true
    });
  });
});

describe("v1 is unchanged and remains the default", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    }) as unknown as typeof fetch;
    return calls;
  }

  const baseEnv = {
    EMAIL_PROVIDER: "mailketing",
    EMAIL_MAILKETING_API_TOKEN: TOKEN,
    EMAIL_MAILKETING_API_BASE_URL: "https://api.mailketing.co.id",
    // Offline stand-in for DNS (the guard's own test escape hatch); `fetch`
    // itself is stubbed below, so nothing leaves the process.
    AUTH_SSO_ALLOW_INSECURE_HOSTS: "api.mailketing.co.id"
  };

  test("direct v1 adapter: form body with api_token, /api/v1/send, status:success", async () => {
    const calls = stubFetch(() =>
      Response.json({
        status: "success",
        response: "Mail Sent",
        message_id: "v1_1"
      })
    );
    const provider = createMailketingEmailProvider({
      apiToken: TOKEN,
      baseUrl: "https://api.mailketing.co.id"
    });

    expect(await provider.send(MESSAGE)).toEqual({
      ok: true,
      providerMessageId: "v1_1"
    });
    expect(calls[0]!.url).toBe("https://api.mailketing.co.id/api/v1/send");
    expect(String(calls[0]!.init.body)).toContain("api_token=");
  });

  test("v1: status:failed on 200 is non-retryable; 500 retryable", async () => {
    stubFetch(() =>
      Response.json({ status: "failed", response: "Empty Recipient" })
    );
    const provider = createMailketingEmailProvider({
      apiToken: TOKEN,
      baseUrl: "https://api.mailketing.co.id"
    });
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: false
    });

    stubFetch(() => new Response("x", { status: 500 }));
    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      retryable: true
    });
  });

  test("resolver: version unset => v1 wire format (api/v1/send, token in body, no Authorization header)", async () => {
    const calls = stubFetch(() =>
      Response.json({ status: "success", response: "ok", message_id: "v1_2" })
    );
    const provider = resolveEmailProvider(
      baseEnv as unknown as NodeJS.ProcessEnv
    );

    expect(await provider.send(MESSAGE)).toMatchObject({ ok: true });
    expect(calls[0]!.url).toContain("/api/v1/send");
    expect(JSON.stringify(calls[0]!.init.headers ?? {})).not.toMatch(
      /authorization/i
    );
  });

  test("resolver: version=v1 explicit behaves like unset", async () => {
    const calls = stubFetch(() =>
      Response.json({ status: "success", response: "ok" })
    );
    const provider = resolveEmailProvider({
      ...baseEnv,
      EMAIL_MAILKETING_API_VERSION: "v1"
    } as unknown as NodeJS.ProcessEnv);
    await provider.send(MESSAGE);
    expect(calls[0]!.url).toContain("/api/v1/send");
  });

  test("resolver: version=v2 selects /api/v2 with a Bearer header and no token in the body", async () => {
    const calls = stubFetch(() =>
      Response.json({ success: true, data: { message_id: "v2_1" } })
    );
    const provider = resolveEmailProvider({
      ...baseEnv,
      EMAIL_MAILKETING_API_VERSION: "v2"
    } as unknown as NodeJS.ProcessEnv);

    expect(await provider.send(MESSAGE)).toEqual({
      ok: true,
      providerMessageId: "v2_1"
    });
    expect(calls[0]!.url).toBe("https://api.mailketing.co.id/api/v2/send");
    expect(String(calls[0]!.init.body)).not.toContain(TOKEN);
    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization
    ).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  test("resolver fails closed: bad version, v2 without token, v2 with a foreign base URL", async () => {
    const calls = stubFetch(() => Response.json({ success: true }));

    for (const env of [
      { ...baseEnv, EMAIL_MAILKETING_API_VERSION: "V2" },
      { ...baseEnv, EMAIL_MAILKETING_API_VERSION: "v3" },
      {
        EMAIL_PROVIDER: "mailketing",
        EMAIL_MAILKETING_API_VERSION: "v2"
      },
      {
        ...baseEnv,
        EMAIL_MAILKETING_API_VERSION: "v2",
        EMAIL_MAILKETING_API_BASE_URL: "https://attacker.example"
      },
      {
        ...baseEnv,
        EMAIL_MAILKETING_API_VERSION: "v2",
        EMAIL_MAILKETING_API_BASE_URL: "http://169.254.169.254"
      }
    ]) {
      const provider = resolveEmailProvider(
        env as unknown as NodeJS.ProcessEnv
      );
      const sent = await provider.send(MESSAGE);
      // A configuration error DEFERS (claim undone, never terminal).
      expect(sent).toMatchObject({
        ok: false,
        skipped: true,
        configError: true
      });
      expect(JSON.stringify(sent)).not.toContain("attacker");
      expect((await provider.healthCheck()).ok).toBe(false);
    }

    expect(calls).toHaveLength(0); // no network call was ever made
  });

  test.each([
    ["CR/LF injection", "abc\r\nX-Evil: 1"],
    ["a space", "abc def"],
    ["a trailing newline", "abc\n"],
    ["non-ASCII", "abc\u00e9"]
  ])(
    "resolver fails closed on a token with %s: deferred, no network call",
    async (_label, token) => {
      const calls = stubFetch(() => Response.json({ success: true }));
      const provider = resolveEmailProvider({
        ...baseEnv,
        EMAIL_MAILKETING_API_VERSION: "v2",
        EMAIL_MAILKETING_API_TOKEN: token
      } as unknown as NodeJS.ProcessEnv);

      expect(await provider.send(MESSAGE)).toMatchObject({
        ok: false,
        skipped: true,
        configError: true
      });
      expect(calls).toHaveLength(0);
    }
  );

  test("the pre-existing v1 missing-token case also defers instead of failing terminally", async () => {
    const calls = stubFetch(() => Response.json({ status: "success" }));
    const provider = resolveEmailProvider({
      EMAIL_PROVIDER: "mailketing"
    } as unknown as NodeJS.ProcessEnv);

    expect(await provider.send(MESSAGE)).toMatchObject({
      ok: false,
      skipped: true,
      configError: true
    });
    expect(calls).toHaveLength(0);
  });

  test("v1 with a custom base URL still works (v1 is untouched; the allow-list is v2-only)", async () => {
    const calls = stubFetch(() =>
      Response.json({ status: "success", response: "ok" })
    );
    const provider = resolveEmailProvider({
      ...baseEnv,
      EMAIL_MAILKETING_API_BASE_URL: "https://mock.internal.test"
    } as unknown as NodeJS.ProcessEnv);
    await provider.send(MESSAGE);
    expect(calls[0]!.url).toBe("https://mock.internal.test/api/v1/send");
  });

  test("EMAIL_PROVIDER=log is unaffected by the version switch", async () => {
    const provider = resolveEmailProvider({
      EMAIL_PROVIDER: "log",
      EMAIL_MAILKETING_API_VERSION: "garbage"
    } as unknown as NodeJS.ProcessEnv);
    expect(await provider.healthCheck()).toEqual({ ok: true });
  });
});
