/**
 * Contract and static checks for `website_engagement` (Issue #1153, ADR-0155):
 * the event seam, the registries, the migrations' RLS/grant shape, the OpenAPI
 * public operation, and every public-handler refusal that must happen BEFORE
 * any database work (proved with a database that throws if it is touched).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resetRateLimitForTests } from "../src/lib/security/rate-limit";
import { listModules } from "../src/modules";
import { handlePublicSubmission } from "../src/modules/website-engagement/application/public-intake-handler";
import {
  checkSourceRules,
  runChallenge
} from "../src/modules/website-engagement/application/submission-intake";
import { validateDomainEventPayload } from "../src/modules/domain-event-runtime/domain/envelope";
import {
  DOMAIN_EVENT_TYPE_REGISTRY,
  WEBSITE_ENGAGEMENT_EVENT_VERSION as REGISTRY_VERSION,
  WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE as REGISTRY_RECEIVED,
  WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE as REGISTRY_WITHDRAWN
} from "../src/modules/domain-event-runtime/domain/event-type-registry";
import {
  buildSubmissionReceivedPayload,
  buildSubmissionWithdrawnPayload
} from "../src/modules/website-engagement/domain/engagement-events";
import { publicMessage } from "../src/modules/website-engagement/domain/public-messages";
import { validateSubmissionRequest } from "../src/modules/website-engagement/domain/submission-request";
import {
  WEBSITE_ENGAGEMENT_EVENT_VERSION,
  WEBSITE_ENGAGEMENT_MODULE_KEY,
  WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
  WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE
} from "../src/modules/website-engagement/domain/website-engagement-constants";
import { websiteEngagementModule } from "../src/modules/website-engagement/module";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

const TENANT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const SECRET = "A".repeat(43);
const TOKEN = `wes1.${TENANT}.${SOURCE}.${SECRET}`;
const ENCRYPTION_RING = `e1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64")}`;
const HASH_RING = `h1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 5) % 251)
).toString("base64")}`;

/** A database that fails the test the moment anything touches it. */
const THROWING_SQL = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "the database was touched before the check that should precede it"
      );
    },
    apply() {
      throw new Error(
        "the database was touched before the check that should precede it"
      );
    }
  }
) as unknown as Bun.SQL;

function post(
  body: unknown,
  options: {
    query?: string;
    headers?: Record<string, string>;
    rawBody?: string;
  } = {}
) {
  const url = new URL(
    `https://cms.example/api/v1/website-engagement/submissions${options.query ?? ""}`
  );
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://shop.example.id",
      ...options.headers
    },
    body: options.rawBody ?? JSON.stringify(body)
  });

  return handlePublicSubmission(
    {
      request,
      url,
      clientAddress: "203.0.113.9",
      locals: {}
    } as never,
    THROWING_SQL
  );
}

function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceToken: TOKEN,
    eventId: "evt-12345678",
    kind: "contact",
    contact: { email: "a@b.co", message: "hello" },
    consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" },
    ...overrides
  };
}

describe("website_engagement event contract", () => {
  const facts = {
    submissionId: "33333333-3333-4333-8333-333333333333",
    sourceId: SOURCE,
    sourceCode: "main-site",
    clientEventId: "evt-12345678",
    kind: "contact" as const,
    interactionType: null,
    topic: "pricing",
    locale: "id",
    occurredAt: new Date("2026-11-02T10:00:00Z"),
    receivedAt: new Date("2026-11-02T10:00:01Z"),
    originHost: "shop.example.id",
    originVia: "origin" as const,
    challenge: "turnstile_verified" as const,
    consent: {
      purposes: ["respond_to_inquiry" as const],
      copyVersion: "v1",
      pagePath: "/kontak",
      consentAt: new Date("2026-11-02T10:00:01Z")
    },
    attribution: {
      landingPath: "/produk",
      referrerHost: "google.com",
      utmSource: "newsletter",
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null
    },
    identifiers: ["email" as const, "phone" as const],
    privacyClass: "personal" as const
  };

  test("the received event is a valid, versioned, PII-free envelope payload", () => {
    const payload = buildSubmissionReceivedPayload(facts);

    expect(validateDomainEventPayload(payload)).toEqual({ valid: true });
    expect(payload.contractVersion).toBe("1");
    expect(payload.privacyClass).toBe("personal");
    expect(payload.identifiers).toEqual(["email", "phone"]);
    expect(payload.provenance).toEqual({
      sourceAuthenticated: true,
      originVerified: true,
      originHost: "shop.example.id",
      originVia: "origin",
      challenge: "turnstile_verified"
    });
    expect(payload.attribution).toEqual({
      landingPath: "/produk",
      referrerHost: "google.com",
      utmSource: "newsletter"
    });

    const keys = JSON.stringify(payload).match(/"[A-Za-z]+":/g) ?? [];

    for (const forbidden of [
      "email",
      "phone",
      "name",
      "message",
      "token",
      "ip"
    ]) {
      expect(keys).not.toContain(`"${forbidden}":`);
    }
  });

  test("the withdrawn event is valid and carries a coded reason, never free text", () => {
    const payload = buildSubmissionWithdrawnPayload({
      submissionId: facts.submissionId,
      sourceId: SOURCE,
      sourceCode: "main-site",
      reason: "data_subject_request",
      withdrawnAt: new Date("2026-11-02T11:00:00Z"),
      privacyClass: "personal"
    });

    expect(validateDomainEventPayload(payload)).toEqual({ valid: true });
    expect(payload.reason).toBe("data_subject_request");
  });

  test("the registry literals equal the module's, are registered, and are declared by the module", () => {
    expect(REGISTRY_RECEIVED).toBe(
      WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE
    );
    expect(REGISTRY_WITHDRAWN).toBe(
      WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE
    );
    expect(REGISTRY_VERSION).toBe(WEBSITE_ENGAGEMENT_EVENT_VERSION);

    const registered = DOMAIN_EVENT_TYPE_REGISTRY.map(
      (entry) => entry.eventType
    );

    expect(registered).toContain(REGISTRY_RECEIVED);
    expect(registered).toContain(REGISTRY_WITHDRAWN);
    expect(websiteEngagementModule.events?.publishes).toEqual([
      REGISTRY_RECEIVED,
      REGISTRY_WITHDRAWN
    ]);
  });

  test("AsyncAPI declares both channels, both operations and both payload schemas", () => {
    const spec = read("asyncapi/awcms-domain-events.asyncapi.yaml");

    for (const channel of [REGISTRY_RECEIVED, REGISTRY_WITHDRAWN]) {
      expect(spec).toContain(`  ${channel}:\n    address: ${channel}`);
    }

    expect(spec).toContain("publishWebsiteEngagementSubmissionReceived:");
    expect(spec).toContain("publishWebsiteEngagementSubmissionWithdrawn:");
    expect(spec).toContain("WebsiteEngagementSubmissionReceived:");
    expect(spec).toContain("WebsiteEngagementSubmissionWithdrawn:");
  });

  test("the module is registered, intake-only and declares no navigation without a page", () => {
    expect(listModules().map((module) => module.key)).toContain(
      WEBSITE_ENGAGEMENT_MODULE_KEY
    );
    expect(websiteEngagementModule.type).toBe("system");
    expect(websiteEngagementModule.navigation ?? []).toEqual([]);
    expect(websiteEngagementModule.dataLifecycle?.[0]?.tableName).toBe(
      "awcms_engagement_submissions"
    );
    expect(
      websiteEngagementModule.dataLifecycle?.[0]?.legalHold.applicable
    ).toBe(true);
  });
});

describe("website_engagement migrations 325-327", () => {
  const schema = read("sql/325_awcms_website_engagement_schema.sql");
  const permissions = read("sql/326_awcms_website_engagement_permissions.sql");
  const guards = read("sql/327_awcms_website_engagement_integrity_guards.sql");
  const tables = [
    "awcms_engagement_sources",
    "awcms_engagement_source_domains",
    "awcms_engagement_submissions"
  ];

  test("every table is tenant-scoped with RLS FORCE and a tenant-isolation policy that also checks writes", () => {
    for (const table of tables) {
      expect(schema).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`
      );
      expect(schema).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`
      );
      expect(schema).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_tenant_isolation\\s+ON ${table}\\s+USING \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)\\s+WITH CHECK \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)`
        )
      );
      expect(schema).toContain(`REVOKE ALL ON ${table} FROM awcms_worker;`);
    }
  });

  test("the worker can purge submissions and read nothing else of them; the app cannot delete evidence", () => {
    expect(schema).toContain(
      "GRANT SELECT (id, tenant_id, received_at) ON awcms_engagement_submissions TO awcms_worker;"
    );
    expect(schema).toContain(
      "GRANT DELETE ON awcms_engagement_submissions TO awcms_worker;"
    );
    expect(schema).toContain(
      "REVOKE DELETE, TRUNCATE ON awcms_engagement_submissions FROM awcms_app;"
    );
    expect(schema).toContain(
      "REVOKE DELETE, TRUNCATE ON awcms_engagement_sources FROM awcms_app;"
    );
    expect(schema).not.toMatch(
      /GRANT[^;]*(contact_encrypted|email_hash|token_hash)[^;]*TO awcms_worker/
    );
  });

  test("no visitor IP, fingerprint, cookie or user agent column exists", () => {
    const columns = schema
      .split("\n")
      .filter((line) =>
        /^\s{2}[a-z_]+ (uuid|text|timestamptz|boolean|integer|text\[\])/.test(
          line
        )
      )
      .map((line) => line.trim().split(" ")[0]!);

    for (const column of columns) {
      expect(column).not.toMatch(
        /(^|_)(ip|fingerprint|cookie|user_agent|ua)(_|$)/
      );
    }
  });

  test("the replay key, the consent shape and the token-hash shape are database constraints", () => {
    expect(schema).toContain("UNIQUE (tenant_id, source_id, event_id)");
    expect(schema).toContain(
      "consent_purposes @> ARRAY['respond_to_inquiry']::text[]"
    );
    expect(schema).toContain("token_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$'");
    expect(schema).toContain("awcms_engagement_submissions_received_at_idx");
  });

  test("numbered 325-327, no BEGIN/COMMIT, and the permissions seed equals the module descriptor", () => {
    for (const sql of [schema, permissions, guards]) {
      expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT);/im);
    }

    const seeded = [
      ...permissions.matchAll(
        /\('website_engagement', '([a-z_]+)', '([a-z_]+)'/g
      )
    ]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort();
    const declared = (websiteEngagementModule.permissions ?? [])
      .map((permission) => `${permission.activityCode}.${permission.action}`)
      .sort();

    expect(seeded).toEqual(declared);
    expect(declared).toEqual([
      "sources.manage",
      "sources.read",
      "submissions.read",
      "submissions.reveal",
      "submissions.withdraw"
    ]);
  });

  test("the guards pin their search path and make evidence append-only", () => {
    expect(
      (guards.match(/SET search_path = public, pg_temp/g) ?? []).length
    ).toBe(3);
    expect(guards).toContain("only its withdrawal may change");
    expect(guards).toContain("a withdrawal is one-way");
    expect(guards).toContain(
      "a website source may only list a live domain of its own tenant"
    );
  });
});

describe("website_engagement OpenAPI", () => {
  const spec = read("openapi/awcms-public-api.openapi.yaml");

  test("the public intake is security: [] and takes no tenant header; admin operations keep the default", () => {
    const start = spec.indexOf("  /api/v1/website-engagement/submissions:\n");
    const end = spec.indexOf(
      "  /api/v1/website-engagement/submissions/{id}:",
      start
    );
    const block = spec.slice(start, end);
    const post = block.slice(
      block.indexOf("    post:"),
      block.indexOf("    get:")
    );

    expect(post).toContain("operationId: websiteEngagementSubmit");
    expect(post).toContain("security: []");
    expect(post).not.toContain("X-AWCMS-Tenant-ID");

    const get = block.slice(block.indexOf("    get:"));

    expect(get).not.toContain("security: []");
  });

  test("the token is documented as shown once and never read back", () => {
    expect(spec).toContain("Present ONLY when `revealed` is true");
    // This module's own fragment never names a hash field at all.
    expect(read("openapi/modules/website-engagement.openapi.yaml")).not.toMatch(
      /tokenHash|token_hash/
    );
  });
});

describe("website_engagement public handler: every pre-proof refusal happens before the database", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    resetRateLimitForTests();

    for (const name of [
      "WEBSITE_ENGAGEMENT_KEYS",
      "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS",
      "WEBSITE_ENGAGEMENT_HASH_KEYS",
      "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS",
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX"
    ]) {
      saved[name] = process.env[name];
    }

    process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS = ENCRYPTION_RING;
    process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = HASH_RING;
    delete process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;
    delete process.env.WEBSITE_ENGAGEMENT_KEYS;
    delete process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    resetRateLimitForTests();
  });

  test("a non-JSON content type (the cross-origin form post that skips preflight) is 415", async () => {
    const response = await post(null, {
      rawBody: "a=b",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.status).toBe(415);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an oversize body is 413 without being read", async () => {
    const response = await post(null, {
      rawBody: "x".repeat(20_000),
      headers: { "content-length": "20000" }
    });

    expect(response.status).toBe(413);
  });

  test("a bad SHAPE is the same 400 whether or not the token is valid", async () => {
    const withToken = await post(goodBody({ kind: "nonsense" }));
    const withoutToken = await post(
      goodBody({ kind: "nonsense", sourceToken: "garbage" })
    );

    expect(withToken.status).toBe(400);
    expect(withoutToken.status).toBe(400);
    expect(await withToken.text()).toBe(await withoutToken.text());
  });

  test("no key ring is a closed 503 and never a silent skip", async () => {
    delete process.env.WEBSITE_ENGAGEMENT_HASH_KEYS;

    const response = await post(goodBody());

    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("one key in both rings is a closed 503 before the database (Issue #1262)", async () => {
    process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = `h1:${ENCRYPTION_RING.slice(3)}`;

    const response = await post(goodBody());

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(ENCRYPTION_RING.slice(3));
  });

  test("the retired single ring is a closed 503, alone or next to the new rings (Issue #1262)", async () => {
    process.env.WEBSITE_ENGAGEMENT_KEYS = ENCRYPTION_RING;

    expect((await post(goodBody())).status).toBe(503);

    delete process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS;
    delete process.env.WEBSITE_ENGAGEMENT_HASH_KEYS;

    expect((await post(goodBody())).status).toBe(503);
  });

  test("an unparseable token is the uniform refusal, with no CORS grant", async () => {
    const response = await post(goodBody({ sourceToken: "wes1.nope" }));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("SUBMISSION_REFUSED");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  test("tenant-ID substitution: a tenant or source id that disagrees with the token is the same refusal, before any database work", async () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const uniform = await (
      await post(goodBody({ sourceToken: "wes1.nope" }))
    ).text();
    const attempts = await Promise.all([
      post(goodBody({ tenantId: other })),
      post(goodBody({ sourceId: other })),
      post(goodBody(), { query: `?tenant_id=${other}` }),
      post(goodBody(), { query: `?tenantId=${other}` }),
      post(goodBody(), { query: `?source_id=${other}` }),
      post(goodBody(), { query: "?tenant_code=acme" }),
      post(goodBody(), { query: "?tenantCode=acme" })
    ]);

    for (const response of attempts) {
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(uniform);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  test("localisation: the refusal and the 429 answer in the submitted language", async () => {
    const id = (await (
      await post(goodBody({ sourceToken: "bad", locale: "id" }))
    ).json()) as {
      error: { message: string };
    };

    // A shape-valid body with a garbage token (the shape check accepts any
    // non-empty string) is refused in Indonesian.
    expect(id.error.message).toBe(publicMessage("submissionRefused", "id"));
    expect(publicMessage("submissionRefused", "id")).not.toBe(
      publicMessage("submissionRefused", "en")
    );
    expect(publicMessage("received", "id-ID")).toBe(
      publicMessage("received", "id")
    );
    expect(publicMessage("received", "fr")).toBe(
      publicMessage("received", "en")
    );
    expect(publicMessage("received", null)).toBe(
      publicMessage("received", undefined)
    );

    process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "1";
    resetRateLimitForTests();

    await post(goodBody({ sourceToken: "bad" }));
    const limited = await post(goodBody({ sourceToken: "bad" }));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  test("the response never echoes the token, the address or the message", async () => {
    for (const sourceToken of ["bad", TOKEN.replace(SECRET, "A")]) {
      const response = await post(
        goodBody({
          sourceToken,
          contact: {
            email: "secret.person@example.com",
            message: "private words"
          }
        })
      );
      const text = await response.text();

      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("secret.person");
      expect(text).not.toContain("private words");
    }

    const response = await post(
      goodBody({
        kind: "nonsense",
        contact: {
          email: "secret.person@example.com",
          message: "private words"
        }
      })
    );
    const text = await response.text();

    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("secret.person");
    expect(text).not.toContain("private words");
  });
});

describe("website_engagement source rules and challenge (after proof)", () => {
  const source = {
    acceptedKinds: ["contact", "lead"] as (
      "contact" | "lead" | "interaction"
    )[],
    consentCopyVersion: "v2"
  };

  function request(overrides: Record<string, unknown>) {
    const result = validateSubmissionRequest({
      sourceToken: TOKEN,
      eventId: "evt-12345678",
      kind: "contact",
      contact: { email: "a@b.co", message: "m" },
      consent: { purposes: ["respond_to_inquiry"], copyVersion: "v2" },
      ...overrides
    });

    if (!result.valid) throw new Error(JSON.stringify(result.errors));

    return result.value;
  }

  test("a kind the source does not accept, a missing inquiry consent and a stale copy version are refused specifically", () => {
    expect(checkSourceRules(source, request({}))).toEqual({ ok: true });
    expect(
      checkSourceRules(
        source,
        request({
          kind: "interaction",
          contact: undefined,
          consent: undefined,
          interaction: { type: "cta_click" }
        })
      )
    ).toEqual({ ok: false, status: 422, code: "KIND_NOT_ACCEPTED" });
    // Marketing consent alone never stands in for consent to be responded to.
    expect(
      checkSourceRules(
        source,
        request({
          consent: { purposes: ["marketing_follow_up"], copyVersion: "v2" }
        })
      )
    ).toEqual({ ok: false, status: 422, code: "CONSENT_REQUIRED" });
    expect(
      checkSourceRules(
        source,
        request({
          consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" }
        })
      )
    ).toEqual({ ok: false, status: 409, code: "CONSENT_COPY_MISMATCH" });
    expect(
      checkSourceRules(
        source,
        request({ consent: { purposes: ["respond_to_inquiry"] } })
      )
    ).toEqual({ ok: false, status: 409, code: "CONSENT_COPY_MISMATCH" });
  });

  test("an opt-out source accepts an interaction with no consent at all", () => {
    expect(
      checkSourceRules(
        { acceptedKinds: ["interaction"], consentCopyVersion: "v2" },
        request({
          kind: "interaction",
          contact: undefined,
          consent: undefined,
          interaction: { type: "map_click" }
        })
      )
    ).toEqual({ ok: true });
  });

  test("the challenge: none is visible, the offline profile is not_required, and a required one fails closed", async () => {
    const origin = {
      origin: "https://shop.example.id",
      hostname: "shop.example.id",
      via: "origin" as const
    };

    expect(
      await runChallenge({ challengeMode: "none", origin }, null, undefined, {})
    ).toBe("source_none");
    expect(
      await runChallenge(
        { challengeMode: "turnstile", origin },
        null,
        undefined,
        {}
      )
    ).toBe("not_required");

    const online = {
      AUTH_ONLINE_SECURITY_ENABLED: "true",
      AUTH_ONLINE_SECURITY_PROFILE: "full_online",
      TURNSTILE_ENABLED: "true"
    } as NodeJS.ProcessEnv;

    // Required, no token: refused.
    expect(
      await runChallenge(
        { challengeMode: "turnstile", origin },
        null,
        "1.2.3.4",
        online
      )
    ).toBeNull();
    // Required, a token, but the deployment has no secret configured: refused,
    // never skipped, and no network call is made.
    expect(
      await runChallenge(
        { challengeMode: "turnstile", origin },
        "tok",
        "1.2.3.4",
        online
      )
    ).toBeNull();
  });
});
