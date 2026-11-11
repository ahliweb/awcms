/**
 * `website_engagement` against a real PostgreSQL (Issue #1153, ADR-0155) —
 * WORLD 1 of the harness: the migrations ran as a demoted table owner and every
 * call below goes through the least-privilege runtime role, so RLS `FORCE` and
 * the role grants are actually observed. The PUBLIC handler is driven with that
 * runtime pool injected, so the whole intake (token, tenant, module, source,
 * Origin, limits, challenge, insert, outbox) runs for real.
 *
 * Test matrix (the issue's acceptance list):
 *
 *   * 2 tenant domains and 3 websites under one tenant, each accepting exactly
 *     its own hosts;
 *   * a forged third-party Origin, a missing Origin, the Referer fallback;
 *   * duplicate submission (sequential AND concurrent): one row, one event;
 *   * opt-out: a controller withdrawal, one event, idempotent, one-way;
 *   * malicious payload: markup refused, SQL-shaped text stored as TEXT;
 *   * tenant-id substitution: body, query, and a token naming another tenant;
 *   * localisation: the answer and the stored locale;
 *   * RLS FORCE and the role grants (app cannot delete evidence; the worker
 *     purges and reads no identifier, hash or ciphertext);
 *   * the integrity triggers and CHECKs refuse what the application never does.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { resetRateLimitForTests } from "../../src/lib/security/rate-limit";
import { handlePublicSubmission } from "../../src/modules/website-engagement/application/public-intake-handler";
import {
  createSource,
  deleteSource,
  revokeSource,
  rotateSource,
  updateSource
} from "../../src/modules/website-engagement/application/source-directory";
import {
  fetchSubmission,
  listSubmissions,
  revealSubmission,
  withdrawSubmission
} from "../../src/modules/website-engagement/application/submission-directory";
import {
  recordSubmission,
  verifyIntake
} from "../../src/modules/website-engagement/application/submission-intake";
import {
  countSourceTokensByKeyId,
  countSubmissionContactsByKeyId
} from "../../src/modules/website-engagement/application/key-transition";
import {
  resolveWebsiteEngagementRings,
  lookupHashCandidates,
  type WebsiteEngagementRings
} from "../../src/modules/website-engagement/domain/engagement-config";
import { parseSourceToken } from "../../src/modules/website-engagement/domain/source-token";
import { validateSubmissionRequest } from "../../src/modules/website-engagement/domain/submission-request";
import {
  SOURCE_TOKEN_HASH_PURPOSE,
  SUBMISSION_EMAIL_HASH_PURPOSE
} from "../../src/modules/website-engagement/domain/website-engagement-constants";
import {
  matchesAnyHash,
  parseKeyRing,
  type KeyRing
} from "../../src/lib/security/field-encryption";

const T1 = "e1153000-0000-4000-8000-000000000001";
const T2 = "e1153000-0000-4000-8000-000000000002";
const U1 = "e1153000-0000-4000-8000-000000000101";
const U2 = "e1153000-0000-4000-8000-000000000201";

const SHOP = "shop.example.id";
const BLOG = "blog.example.id";
const PENDING = "pending.example.id";
const OTHER = "other.example.id";

const keyBytes = (seed: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 7 + seed) % 251)
  ).toString("base64");
// Two rings, never one (ADR-0137 section 3, Issue #1262).
const ENCRYPTION_SPEC = `e1:${keyBytes(3)}`;
const HASH_SPEC = `h1:${keyBytes(5)}`;

/** The rings every test runs on, and nothing of the #1262 transition. */
function useCurrentRings() {
  process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS = ENCRYPTION_SPEC;
  process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = HASH_SPEC;
  delete process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;
  delete process.env.WEBSITE_ENGAGEMENT_KEYS;
}
const savedEnv: Record<string, string | undefined> = {};
const ENV_NAMES = [
  "WEBSITE_ENGAGEMENT_KEYS",
  "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS",
  "WEBSITE_ENGAGEMENT_HASH_KEYS",
  "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS",
  "WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX",
  "WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX",
  "WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX",
  "AUTH_ONLINE_SECURITY_ENABLED",
  "AUTH_ONLINE_SECURITY_PROFILE",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAME"
];

function rings() {
  const resolved = resolveWebsiteEngagementRings();

  if (!resolved.ok) throw new Error(resolved.reason);

  return resolved.rings;
}

const inTenant = <T>(tenantId: string, work: (tx: Bun.SQL) => Promise<T>) =>
  withTenantOrThrow(getRuntimeSql(), tenantId, (tx) => work(tx));

/** A plain transaction with the tenant GUC set. Rejected statements must not run through `withTenantOrThrow`: it trips the process-wide circuit breaker. */
async function asApp<T>(
  tenantId: string | null,
  work: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getRuntimeSql().begin(async (tx) => {
    if (tenantId) {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    }

    return work(tx);
  }) as Promise<T>;
}

async function seedTenant(tenantId: string, code: string, userId: string) {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${code}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;
}

async function seedDomain(
  tenantId: string,
  host: string,
  status = "active"
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, domain_type, status, verified_at)
    VALUES (${tenantId}, ${host}, ${host}, 'custom_domain', ${status},
            ${status === "active" ? new Date() : null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

type Fixture = {
  domainIds: Record<string, string>;
  tokens: Record<string, string>;
  sourceIds: Record<string, string>;
};

let fx: Fixture;

async function newSource(
  tenantId: string,
  actor: string,
  code: string,
  domainIds: string[],
  extra: Partial<Parameters<typeof createSource>[3]> = {}
): Promise<{ id: string; token: string }> {
  const result = await inTenant(tenantId, (tx) =>
    createSource(
      tx,
      tenantId,
      actor,
      {
        code,
        name: `Source ${code}`,
        consentCopyVersion: "v1",
        challengeMode: "turnstile",
        acceptedKinds: ["contact", "lead", "interaction"],
        domainIds,
        ...extra
      },
      rings().hash
    )
  );

  if (result.outcome !== "created") {
    throw new Error(`fixture: ${JSON.stringify(result)}`);
  }

  return { id: result.source.id, token: result.token };
}

async function seedFixture(): Promise<Fixture> {
  await seedTenant(T1, "we-one", U1);
  await seedTenant(T2, "we-two", U2);

  const shop = await seedDomain(T1, SHOP);
  const blog = await seedDomain(T1, BLOG);
  const pending = await seedDomain(T1, PENDING, "pending_verification");
  const other = await seedDomain(T2, OTHER);

  const siteA = await newSource(T1, U1, "site-a", [shop]);
  const siteB = await newSource(T1, U1, "site-b", [shop, blog]);
  const siteC = await newSource(T1, U1, "site-c", [blog, pending]);
  const siteT2 = await newSource(T2, U2, "t2-site", [other]);

  return {
    domainIds: { shop, blog, pending, other },
    tokens: {
      a: siteA.token,
      b: siteB.token,
      c: siteC.token,
      t2: siteT2.token
    },
    sourceIds: { a: siteA.id, b: siteB.id, c: siteC.id, t2: siteT2.id }
  };
}

let eventCounter = 0;

function body(token: string, overrides: Record<string, unknown> = {}) {
  eventCounter += 1;

  return {
    sourceToken: token,
    eventId: `evt-${String(eventCounter).padStart(8, "0")}`,
    kind: "contact",
    contact: {
      name: "Budi Santoso",
      email: "Budi.Santoso@Example.com",
      phone: "+62 812-3456-7890",
      message: "Saya ingin tahu harga paket."
    },
    consent: {
      purposes: ["respond_to_inquiry"],
      copyVersion: "v1",
      pagePath: "/kontak"
    },
    locale: "id",
    topic: "pricing",
    attribution: {
      landingPath: "/produk",
      referrerHost: "google.com",
      utmSource: "newsletter"
    },
    ...overrides
  };
}

async function submit(
  payload: unknown,
  options: {
    origin?: string | null;
    referer?: string;
    query?: string;
    ip?: string;
  } = {}
) {
  const url = new URL(
    `https://cms.integration.test/api/v1/website-engagement/submissions${options.query ?? ""}`
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "curl/8.0 secret-agent"
  };
  const origin =
    options.origin === undefined ? `https://${SHOP}` : options.origin;

  if (origin !== null) headers.origin = origin;
  if (options.referer) headers.referer = options.referer;

  const response = await handlePublicSubmission(
    {
      request: new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }),
      url,
      clientAddress: options.ip ?? "203.0.113.77",
      locals: { correlationId: "corr-1153" }
    } as never,
    getRuntimeSql()
  );
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: text ? (JSON.parse(text) as Record<string, any>) : null,
    response
  };
}

async function count(table: string, tenantId?: string): Promise<number> {
  const rows = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table} ${tenantId ? "WHERE tenant_id = $1" : ""}`,
    tenantId ? [tenantId] : []
  )) as { n: number }[];

  return rows[0]!.n;
}

async function events(tenantId: string, type?: string) {
  return (await getAdminSql()`
    SELECT event_type, aggregate_id, payload
    FROM awcms_domain_events
    WHERE tenant_id = ${tenantId}
      AND (${type ?? null}::text IS NULL OR event_type = ${type ?? null}::text)
    ORDER BY event_sequence
  `) as {
    event_type: string;
    aggregate_id: string;
    payload: Record<string, any>;
  }[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("website_engagement against PostgreSQL (Issue #1153)", () => {
  beforeAll(async () => {
    for (const name of ENV_NAMES) savedEnv[name] = process.env[name];

    useCurrentRings();
    process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "10000";
    process.env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX = "10000";
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    resetRateLimitForTests();
    useCurrentRings();
    process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "10000";
    process.env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX = "10000";
    delete process.env.WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX;
    await resetDatabase();
    fx = await seedFixture();
  });

  afterEach(() => {
    for (const name of [
      "AUTH_ONLINE_SECURITY_ENABLED",
      "AUTH_ONLINE_SECURITY_PROFILE",
      "TURNSTILE_ENABLED",
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_EXPECTED_HOSTNAME"
    ]) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  // -------------------------------------------------------------------------
  describe("the public intake", () => {
    test("a verified submission is stored encrypted, with provenance and consent, and announces itself once", async () => {
      const result = await submit(body(fx.tokens.a!));

      expect(result.status).toBe(200);
      expect(result.json?.data.received).toBe(true);
      expect(result.response.headers.get("access-control-allow-origin")).toBe(
        `https://${SHOP}`
      );
      expect(result.response.headers.get("vary")).toBe("Origin");

      const rows = (await getAdminSql()`
        SELECT * FROM awcms_engagement_submissions WHERE tenant_id = ${T1}
      `) as Record<string, any>[];

      expect(rows).toHaveLength(1);

      const row = rows[0]!;

      expect(row.kind).toBe("contact");
      expect(row.status).toBe("received");
      expect(row.privacy_class).toBe("personal");
      expect(row.origin_host).toBe(SHOP);
      expect(row.origin_via).toBe("origin");
      expect(row.challenge_outcome).toBe("not_required");
      expect(row.consent_purposes).toEqual(["respond_to_inquiry"]);
      expect(row.consent_copy_version).toBe("v1");
      expect(row.consent_page_path).toBe("/kontak");
      expect(row.consent_at).toBeInstanceOf(Date);
      expect(row.landing_path).toBe("/produk");
      expect(row.referrer_host).toBe("google.com");
      expect(row.utm_source).toBe("newsletter");
      expect(row.locale).toBe("id");
      expect(row.email_masked).toBe("b***********@example.com");
      expect(row.email_hash).toMatch(/^h1:[0-9a-f]{64}$/);
      expect(row.contact_encrypted).toMatch(/^v2:e1:/);

      // No identifier, no IP, no user agent anywhere in the persisted row.
      const persisted = JSON.stringify(row);

      for (const secret of [
        "Budi",
        "budi.santoso",
        "081234567890",
        "6281234567890",
        "harga paket",
        "203.0.113.77",
        "curl/8.0",
        "secret-agent"
      ]) {
        expect(persisted).not.toContain(secret);
      }

      const stored = await inTenant(T1, (tx) =>
        revealSubmission(tx, T1, row.id, rings().encryption)
      );

      expect(stored?.email).toBe("Budi.Santoso@Example.com");
      expect(stored?.message).toBe("Saya ingin tahu harga paket.");

      const published = await events(
        T1,
        "awcms.website_engagement.submission.received"
      );

      expect(published).toHaveLength(1);
      expect(published[0]!.aggregate_id).toBe(row.id);
      expect(published[0]!.payload).toMatchObject({
        contractVersion: "1",
        submissionId: row.id,
        sourceId: fx.sourceIds.a,
        sourceCode: "site-a",
        kind: "contact",
        privacyClass: "personal",
        identifiers: ["email", "phone"],
        provenance: {
          sourceAuthenticated: true,
          originVerified: true,
          originHost: SHOP,
          challenge: "not_required"
        },
        consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" }
      });

      const eventText = JSON.stringify(published[0]!.payload);

      for (const secret of ["Budi", "budi.santoso", "08123", "harga"]) {
        expect(eventText).not.toContain(secret);
      }
    });

    test("duplicate submission: the same (source, eventId) stores nothing and publishes nothing, and answers identically", async () => {
      const first = body(fx.tokens.a!);
      const one = await submit(first);
      const two = await submit(first);
      const three = await submit({
        ...first,
        contact: { email: "x@y.co", message: "changed" }
      });

      expect(one.status).toBe(200);
      expect(two.status).toBe(200);
      expect(three.status).toBe(200);
      expect(two.text).toBe(one.text);
      expect(three.text).toBe(one.text);
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);
      expect(
        await events(T1, "awcms.website_engagement.submission.received")
      ).toHaveLength(1);
    });

    test("duplicate submission under concurrency: one row, one event", async () => {
      const payload = body(fx.tokens.a!);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => submit(payload))
      );

      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);
      expect(
        await events(T1, "awcms.website_engagement.submission.received")
      ).toHaveLength(1);
    });

    test("three websites and two domains under one tenant: each source accepts exactly its own hosts", async () => {
      const matrix: [string, string, number][] = [
        ["a", SHOP, 200],
        ["a", BLOG, 403],
        ["b", SHOP, 200],
        ["b", BLOG, 200],
        ["c", SHOP, 403],
        ["c", BLOG, 200],
        // A domain still pending verification never counts, even when listed.
        ["c", PENDING, 403]
      ];

      for (const [source, host, expected] of matrix) {
        const result = await submit(body(fx.tokens[source]!), {
          origin: `https://${host}`
        });

        expect(`${source}@${host}=${result.status}`).toBe(
          `${source}@${host}=${expected}`
        );
      }
    });

    test("a forged third-party Origin, a missing Origin and an unusable one are refused identically, and nothing is stored", async () => {
      const uniform = (
        await submit(body(fx.tokens.a!, { eventId: "evt-forged-001" }), {
          origin: "https://evil.example"
        })
      ).text;

      for (const origin of [
        "https://evil.example",
        `https://${SHOP}.evil.example`,
        "https://xshop.example.id",
        "null",
        "chrome-extension://abc",
        null
      ]) {
        const result = await submit(
          body(fx.tokens.a!, { eventId: "evt-forged-001" }),
          {
            origin
          }
        );

        expect(result.status).toBe(403);
        expect(result.json?.error.code).toBe("SUBMISSION_REFUSED");
        expect(result.text).toBe(uniform);
        expect(
          result.response.headers.get("access-control-allow-origin")
        ).toBeNull();
      }

      expect(await count("awcms_engagement_submissions")).toBe(0);
    });

    test("the Referer host stands in ONLY when there is no Origin header", async () => {
      const viaReferer = await submit(body(fx.tokens.a!), {
        origin: null,
        referer: `https://${SHOP}/kontak?x=1`
      });

      expect(viaReferer.status).toBe(200);

      const row = (await getAdminSql()`
        SELECT origin_via FROM awcms_engagement_submissions
      `) as { origin_via: string }[];

      expect(row[0]!.origin_via).toBe("referer");

      const downgraded = await submit(body(fx.tokens.a!), {
        origin: "null",
        referer: `https://${SHOP}/kontak`
      });

      expect(downgraded.status).toBe(403);
    });

    test("tenant-id substitution: a body or query id that disagrees, or a token naming another tenant, finds nothing", async () => {
      const secret = fx.tokens.a!.split(".")[3]!;
      const tenantTwoWithAsSource = `wes1.${T2}.${fx.sourceIds.a}.${secret}`;
      const attempts = [
        submit(body(fx.tokens.a!, { tenantId: T2 })),
        submit(body(fx.tokens.a!, { sourceId: fx.sourceIds.t2 })),
        submit(body(fx.tokens.a!), { query: `?tenant_id=${T2}` }),
        submit(body(fx.tokens.a!), { query: `?tenantId=${T2}` }),
        submit(body(fx.tokens.a!), { query: `?tenant_code=we-two` }),
        // The token claims tenant 2 with tenant 1's source id and secret: the
        // lookup happens INSIDE tenant 2's context, where that source is invisible.
        submit(body(tenantTwoWithAsSource)),
        // Tenant 2's own token, replayed from tenant 1's domain.
        submit(body(fx.tokens.t2!), { origin: `https://${SHOP}` })
      ];
      const results = await Promise.all(attempts);

      for (const result of results) {
        expect(result.status).toBe(403);
        expect(result.json?.error.code).toBe("SUBMISSION_REFUSED");
      }

      expect(new Set(results.map((r) => r.text)).size).toBe(1);
      expect(await count("awcms_engagement_submissions")).toBe(0);

      // And a legitimate tenant-2 submission lands in tenant 2 only.
      const legit = await submit(body(fx.tokens.t2!), {
        origin: `https://${OTHER}`
      });

      expect(legit.status).toBe(200);
      expect(await count("awcms_engagement_submissions", T2)).toBe(1);
      expect(await count("awcms_engagement_submissions", T1)).toBe(0);
    });

    test("a wrong secret, a paused, revoked or deleted source, a rotated-away token and a suspended tenant are all the same refusal", async () => {
      const uniform = (
        await submit(body(fx.tokens.a!), { origin: "https://evil.example" })
      ).text;
      const sameRefusal = async (token: string) => {
        const result = await submit(body(token));

        expect(result.status).toBe(403);
        expect(result.text).toBe(uniform);
      };

      await sameRefusal(
        fx.tokens.a!.replace(/.$/, (c) => (c === "A" ? "B" : "A"))
      );

      await inTenant(T1, (tx) =>
        updateSource(tx, T1, U1, fx.sourceIds.b!, { status: "paused" })
      );
      await sameRefusal(fx.tokens.b!);
      await inTenant(T1, (tx) =>
        updateSource(tx, T1, U1, fx.sourceIds.b!, { status: "active" })
      );
      expect((await submit(body(fx.tokens.b!))).status).toBe(200);

      await inTenant(T1, (tx) => revokeSource(tx, T1, U1, fx.sourceIds.b!));
      await sameRefusal(fx.tokens.b!);

      await inTenant(T1, (tx) => deleteSource(tx, T1, U1, fx.sourceIds.c!));
      await sameRefusal(fx.tokens.c!);

      const rotated = await inTenant(T1, (tx) =>
        rotateSource(tx, T1, U1, fx.sourceIds.a!, rings().hash)
      );

      expect(rotated.outcome).toBe("rotated");
      await sameRefusal(fx.tokens.a!);

      if (rotated.outcome === "rotated") {
        expect((await submit(body(rotated.token))).status).toBe(200);
      }

      await getAdminSql()`UPDATE awcms_tenants SET status = 'suspended' WHERE id = ${T2}`;
      await sameRefusal(fx.tokens.t2!);
    });

    test("consent: a contact needs an explicit inquiry consent against the CURRENT copy version; marketing is never implied", async () => {
      const missing = await submit(body(fx.tokens.a!, { consent: undefined }));
      const marketingOnly = await submit(
        body(fx.tokens.a!, {
          consent: { purposes: ["marketing_follow_up"], copyVersion: "v1" }
        })
      );
      const stale = await submit(
        body(fx.tokens.a!, {
          consent: { purposes: ["respond_to_inquiry"], copyVersion: "v0" }
        })
      );

      expect(missing.status).toBe(422);
      expect(missing.json?.error.code).toBe("CONSENT_REQUIRED");
      expect(marketingOnly.status).toBe(422);
      expect(stale.status).toBe(409);
      expect(stale.json?.error.code).toBe("CONSENT_COPY_MISMATCH");
      expect(await count("awcms_engagement_submissions")).toBe(0);

      const both = await submit(
        body(fx.tokens.a!, {
          consent: {
            purposes: ["respond_to_inquiry", "marketing_follow_up"],
            copyVersion: "v1"
          }
        })
      );

      expect(both.status).toBe(200);

      const rows = (await getAdminSql()`
        SELECT consent_purposes FROM awcms_engagement_submissions
      `) as { consent_purposes: string[] }[];

      expect(rows[0]!.consent_purposes).toEqual([
        "respond_to_inquiry",
        "marketing_follow_up"
      ]);
    });

    test("an interaction is stored anonymous: no contact details, no consent, and the event says so", async () => {
      const result = await submit({
        sourceToken: fx.tokens.a!,
        eventId: "evt-interact-1",
        kind: "interaction",
        interaction: { type: "whatsapp_click" },
        attribution: { landingPath: "/produk" }
      });

      expect(result.status).toBe(200);

      const rows = (await getAdminSql()`
        SELECT * FROM awcms_engagement_submissions
      `) as Record<string, any>[];

      expect(rows[0]).toMatchObject({
        kind: "interaction",
        interaction_type: "whatsapp_click",
        privacy_class: "anonymous",
        contact_encrypted: null,
        email_hash: null,
        consent_at: null
      });

      const published = await events(
        T1,
        "awcms.website_engagement.submission.received"
      );

      expect(published[0]!.payload).toMatchObject({
        privacyClass: "anonymous",
        identifiers: [],
        kind: "interaction",
        interactionType: "whatsapp_click"
      });

      // A source that does not accept interactions refuses one, specifically.
      const narrow = await newSource(
        T1,
        U1,
        "leads-only",
        [fx.domainIds.shop!],
        {
          acceptedKinds: ["lead"]
        }
      );
      const refused = await submit({
        sourceToken: narrow.token,
        eventId: "evt-interact-2",
        kind: "interaction",
        interaction: { type: "cta_click" }
      });

      expect(refused.status).toBe(422);
      expect(refused.json?.error.code).toBe("KIND_NOT_ACCEPTED");
    });

    test("malicious payload: markup and control characters are refused; SQL-shaped text is stored as TEXT and nothing breaks", async () => {
      for (const message of [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "bad\u0000byte",
        "evil‮txt"
      ]) {
        const result = await submit(
          body(fx.tokens.a!, { contact: { email: "a@b.co", message } })
        );

        expect(result.status).toBe(400);
      }

      expect(await count("awcms_engagement_submissions")).toBe(0);

      const sqli =
        "'); DROP TABLE awcms_engagement_submissions; -- \\ \" 5 < 10";
      const ok = await submit(
        body(fx.tokens.a!, { contact: { email: "a@b.co", message: sqli } })
      );

      expect(ok.status).toBe(200);
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);

      const id = (
        (await getAdminSql()`SELECT id FROM awcms_engagement_submissions`) as {
          id: string;
        }[]
      )[0]!.id;
      const revealed = await inTenant(T1, (tx) =>
        revealSubmission(tx, T1, id, rings().encryption)
      );

      expect(revealed?.message).toBe(sqli);

      // Oversize and over-long fields are refused before the database.
      const big = await submit(
        body(fx.tokens.a!, {
          contact: { email: "a@b.co", message: "x".repeat(2001) }
        })
      );

      expect(big.status).toBe(400);
    });

    test("honeypot and implausibly fast fills answer like a success and store nothing", async () => {
      const trap = await submit(
        body(fx.tokens.a!, { honeypot: "http://spam.example" })
      );
      const fast = await submit(body(fx.tokens.a!, { fillMs: 50 }));
      const real = await submit(body(fx.tokens.a!, { fillMs: 8000 }));

      expect(trap.status).toBe(200);
      expect(fast.status).toBe(200);
      expect(trap.text).toBe(fast.text);
      expect(real.status).toBe(200);
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);
    });

    test("localisation: the answer follows the submitted locale and the locale is stored", async () => {
      const id = await submit(body(fx.tokens.a!, { locale: "id" }));
      const en = await submit(body(fx.tokens.a!, { locale: "en" }));
      const none = await submit(body(fx.tokens.a!, { locale: undefined }));
      const refusedId = await submit(body(fx.tokens.a!, { locale: "id" }), {
        origin: "https://evil.example"
      });
      const refusedEn = await submit(body(fx.tokens.a!, { locale: "en" }), {
        origin: "https://evil.example"
      });

      expect(id.json?.data.message).toBe(
        "Terima kasih. Pesan Anda telah kami terima."
      );
      expect(en.json?.data.message).toBe(
        "Thank you. Your message has been received."
      );
      expect(none.json?.data.message).toBe(en.json?.data.message);
      expect(refusedId.json?.error.message).not.toBe(
        refusedEn.json?.error.message
      );

      const locales = (await getAdminSql()`
        SELECT locale FROM awcms_engagement_submissions ORDER BY received_at
      `) as { locale: string | null }[];

      expect(locales.map((row) => row.locale)).toEqual(["id", "en", null]);
    });

    test("H1: a scraped REAL token with a forged Origin from many addresses cannot starve a real visitor", async () => {
      process.env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX = "2";
      process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "5";
      resetRateLimitForTests();

      // Forty different addresses replay the REAL token from a foreign origin.
      for (let i = 0; i < 40; i += 1) {
        const attack = await submit(body(fx.tokens.a!), {
          origin: "https://evil.example",
          ip: `198.51.100.${i + 1}`
        });

        expect(attack.status).toBe(403);
      }

      // ...and the real website's visitors are untouched.
      expect((await submit(body(fx.tokens.a!))).status).toBe(200);
      expect((await submit(body(fx.tokens.a!))).status).toBe(200);

      // The ceiling is still a ceiling for proven, challenge-passing traffic.
      const limited = await submit(body(fx.tokens.a!));

      expect(limited.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).not.toBeNull();
      expect(limited.response.headers.get("access-control-allow-origin")).toBe(
        `https://${SHOP}`
      );
    });

    test("H1: failed challenges spend none of a real source's budget", async () => {
      process.env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX = "2";
      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      delete process.env.TURNSTILE_SECRET_KEY;
      resetRateLimitForTests();

      for (let i = 0; i < 8; i += 1) {
        const failed = await submit(body(fx.tokens.a!), {
          ip: `203.0.113.${i + 1}`
        });

        expect(failed.status).toBe(403);
      }

      delete process.env.TURNSTILE_ENABLED;

      expect((await submit(body(fx.tokens.a!))).status).toBe(200);
      expect((await submit(body(fx.tokens.a!))).status).toBe(200);
      expect((await submit(body(fx.tokens.a!))).status).toBe(429);
    });

    test("H1: the per-address limiter keys an IPv6 address on its /64, not on the whole address", async () => {
      process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "2";
      resetRateLimitForTests();

      await submit(body(fx.tokens.a!), { ip: "2001:db8:1:2::1" });
      await submit(body(fx.tokens.a!), { ip: "2001:db8:1:2:ffff:eeee:dddd:1" });

      const sameSlash64 = await submit(body(fx.tokens.a!), {
        ip: "2001:db8:1:2:1234::9"
      });
      const otherSlash64 = await submit(body(fx.tokens.a!), {
        ip: "2001:db8:1:3::1"
      });

      expect(sameSlash64.status).toBe(429);
      expect(otherSlash64.status).toBe(200);
    });

    test("M1: interactions have their own lower budget and never spend the lead budget (and need no per-event challenge)", async () => {
      process.env.WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX = "2";
      process.env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX = "1000";
      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      delete process.env.TURNSTILE_SECRET_KEY;
      resetRateLimitForTests();

      const click = () =>
        submit({
          sourceToken: fx.tokens.a!,
          eventId: `evt-click-${(eventCounter += 1)}-xxxx`,
          kind: "interaction",
          interaction: { type: "cta_click" }
        });

      // Challenge is required for leads on this deployment, yet interactions pass.
      expect((await click()).status).toBe(200);
      expect((await click()).status).toBe(200);
      expect((await click()).status).toBe(429);

      // The lead budget is untouched: a lead still reaches (and fails) the challenge, not a 429.
      expect((await submit(body(fx.tokens.a!))).status).toBe(403);

      const rows = (await getAdminSql()`
        SELECT challenge_outcome FROM awcms_engagement_submissions
      `) as { challenge_outcome: string }[];

      expect(rows.map((row) => row.challenge_outcome)).toEqual([
        "not_required",
        "not_required"
      ]);
    });

    test("M2: a duplicate eventId is no oracle before the challenge: new and existing ids answer identically", async () => {
      const first = body(fx.tokens.a!);

      expect((await submit(first)).status).toBe(200);

      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      delete process.env.TURNSTILE_SECRET_KEY;

      const existing = await submit(first);
      const fresh = await submit(body(fx.tokens.a!));

      expect(existing.status).toBe(403);
      expect(fresh.status).toBe(403);
      expect(existing.text).toBe(fresh.text);
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);
    });

    test("L2: plain http is refused for a registered production host; a localhost dev host may use it", async () => {
      const http = await submit(body(fx.tokens.a!), {
        origin: `http://${SHOP}`
      });

      expect(http.status).toBe(403);
      expect(
        http.response.headers.get("access-control-allow-origin")
      ).toBeNull();

      const downgradedReferer = await submit(body(fx.tokens.a!), {
        origin: null,
        referer: `http://${SHOP}/kontak`
      });

      expect(downgradedReferer.status).toBe(403);

      const local = await getAdminSql()`
        INSERT INTO awcms_tenant_domains
          (tenant_id, hostname, normalized_hostname, domain_type, status, verified_at)
        VALUES (${T1}, 'localhost', 'localhost', 'custom_domain', 'active', now())
        RETURNING id
      `;

      await inTenant(T1, (tx) =>
        updateSource(tx, T1, U1, fx.sourceIds.a!, {
          domainIds: [fx.domainIds.shop!, (local as { id: string }[])[0]!.id]
        })
      );

      const dev = await submit(body(fx.tokens.a!), {
        origin: "http://localhost:4321"
      });

      expect(dev.status).toBe(200);
      expect(dev.response.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:4321"
      );
    });

    test("L4: personal data cannot ride in utm values or paths into the outbox event", async () => {
      for (const attribution of [
        { utmSource: "john@example.com" },
        { utmCampaign: "jo%40example.com" },
        { utmTerm: "budi:08123456789" },
        { landingPath: "/u/jo%40example.com" },
        { landingPath: "/u/budi@example.com" }
      ]) {
        const result = await submit(body(fx.tokens.a!, { attribution }));

        expect(result.status).toBe(400);
      }

      expect(await count("awcms_engagement_submissions")).toBe(0);
    });

    test("the per-address limit answers 429 before any database work", async () => {
      process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "2";
      resetRateLimitForTests();

      await submit(body(fx.tokens.a!), { ip: "198.51.100.1" });
      await submit(body(fx.tokens.a!), { ip: "198.51.100.1" });

      const limited = await submit(body(fx.tokens.a!), { ip: "198.51.100.1" });
      const otherAddress = await submit(body(fx.tokens.a!), {
        ip: "198.51.100.2"
      });

      expect(limited.status).toBe(429);
      expect(otherAddress.status).toBe(200);
    });

    test("the challenge fails closed where required, is visible where off, and is recorded per submission", async () => {
      // Required, but the deployment has no secret: refused, nothing stored.
      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      delete process.env.TURNSTILE_SECRET_KEY;

      const closed = await submit(
        body(fx.tokens.a!, { challengeToken: "any" })
      );
      const noToken = await submit(body(fx.tokens.a!));

      expect(closed.status).toBe(403);
      expect(noToken.status).toBe(403);
      expect(await count("awcms_engagement_submissions")).toBe(0);

      // A `none` source runs on the non-third-party controls and says so.
      const open = await newSource(T1, U1, "open-site", [fx.domainIds.shop!], {
        challengeMode: "none"
      });
      const accepted = await submit(body(open.token));

      expect(accepted.status).toBe(200);

      const rows = (await getAdminSql()`
        SELECT challenge_outcome FROM awcms_engagement_submissions
      `) as { challenge_outcome: string }[];

      expect(rows[0]!.challenge_outcome).toBe("source_none");
    });

    test("an unparseable token and an unknown tenant pay the same refusal as a wrong secret", async () => {
      const uniform = (
        await submit(body(fx.tokens.a!), { origin: "https://evil.example" })
      ).text;
      const unknownTenant = `wes1.${"f".repeat(8)}-${"f".repeat(4)}-4fff-8fff-${"f".repeat(12)}.${fx.sourceIds.a}.${"A".repeat(43)}`;

      for (const token of ["not-a-token", "wes1.x.y.z", unknownTenant]) {
        const result = await submit(body(token));

        expect(result.status).toBe(403);
        expect(result.text).toBe(uniform);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("administrator reads and the controller's opt-out", () => {
    async function seedSubmissions(n: number): Promise<string[]> {
      for (let i = 0; i < n; i += 1) {
        const result = await submit(
          body(fx.tokens.a!, {
            contact: {
              email: `person${i}@example.com`,
              message: `message ${i}`
            }
          })
        );

        expect(result.status).toBe(200);
      }

      return (
        (await getAdminSql()`
          SELECT id FROM awcms_engagement_submissions
          WHERE tenant_id = ${T1} ORDER BY received_at DESC, id DESC
        `) as { id: string }[]
      ).map((row) => row.id);
    }

    test("the list is masked, keyset-paginated and tenant-scoped", async () => {
      const ids = await seedSubmissions(5);

      await submit(body(fx.tokens.t2!), { origin: `https://${OTHER}` });

      const pageOne = await inTenant(T1, (tx) =>
        listSubmissions(tx, T1, {
          limit: 2,
          cursor: null,
          sourceId: null,
          kind: null,
          status: null
        })
      );

      expect(pageOne.ok).toBe(true);

      if (!pageOne.ok) return;

      expect(pageOne.items.map((i) => i.id)).toEqual(ids.slice(0, 2));
      expect(pageOne.nextCursor).not.toBeNull();
      expect(JSON.stringify(pageOne.items)).not.toContain(
        "person0@example.com"
      );
      expect(pageOne.items[0]!.emailMasked).toMatch(/^p\*+@example\.com$/);

      const pageTwo = await inTenant(T1, (tx) =>
        listSubmissions(tx, T1, {
          limit: 10,
          cursor: pageOne.nextCursor,
          sourceId: null,
          kind: null,
          status: null
        })
      );

      expect(pageTwo.ok && pageTwo.items.map((i) => i.id)).toEqual(
        ids.slice(2)
      );
      expect(pageTwo.ok && pageTwo.nextCursor).toBeNull();

      const bad = await inTenant(T1, (tx) =>
        listSubmissions(tx, T1, {
          limit: 5,
          cursor: "garbage",
          sourceId: null,
          kind: null,
          status: null
        })
      );

      expect(bad.ok).toBe(false);

      const tenantTwo = await inTenant(T2, (tx) =>
        listSubmissions(tx, T2, {
          limit: 50,
          cursor: null,
          sourceId: null,
          kind: null,
          status: null
        })
      );

      expect(tenantTwo.ok && tenantTwo.items).toHaveLength(1);
    });

    test("another tenant's submission is invisible to read, reveal and withdraw (the same not-found)", async () => {
      const [id] = await seedSubmissions(1);

      expect(
        await inTenant(T2, (tx) => fetchSubmission(tx, T2, id!))
      ).toBeNull();
      expect(
        await inTenant(T2, (tx) =>
          revealSubmission(tx, T2, id!, rings().encryption)
        )
      ).toBeNull();
      expect(
        (
          await inTenant(T2, (tx) =>
            withdrawSubmission(
              tx,
              T2,
              U2,
              id!,
              "controller_decision",
              undefined
            )
          )
        ).outcome
      ).toBe("not_found");
      expect(await fetchSubmission(getRuntimeSql(), T1, id!)).toBeNull();
    });

    test("opt-out: withdrawal marks, publishes ONCE, is idempotent and one-way", async () => {
      const [id] = await seedSubmissions(1);
      const first = await inTenant(T1, (tx) =>
        withdrawSubmission(tx, T1, U1, id!, "data_subject_request", "corr-w")
      );
      const second = await inTenant(T1, (tx) =>
        withdrawSubmission(tx, T1, U1, id!, "consent_withdrawn", "corr-w2")
      );

      expect(first.outcome).toBe("withdrawn");
      expect(second.outcome).toBe("already_withdrawn");

      if (
        first.outcome === "withdrawn" &&
        second.outcome === "already_withdrawn"
      ) {
        expect(first.submission.status).toBe("withdrawn");
        // The first reason stands: a later request does not rewrite history.
        expect(second.submission.withdrawalReason).toBe("data_subject_request");
      }

      // M3: the withdrawal ERASED the person; the consent evidence stays.
      const erased = (await getAdminSql()`
        SELECT contact_encrypted, email_hash, phone_hash, email_masked,
               phone_masked, consent_copy_version
        FROM awcms_engagement_submissions WHERE id = ${id}
      `) as Record<string, unknown>[];

      expect(erased[0]).toMatchObject({
        contact_encrypted: null,
        email_hash: null,
        phone_hash: null,
        email_masked: null,
        phone_masked: null,
        consent_copy_version: "v1"
      });
      expect(
        await inTenant(T1, (tx) =>
          revealSubmission(tx, T1, id!, rings().encryption)
        )
      ).toBeNull();

      const withdrawn = await events(
        T1,
        "awcms.website_engagement.submission.withdrawn"
      );

      expect(withdrawn).toHaveLength(1);
      expect(withdrawn[0]!.payload).toMatchObject({
        submissionId: id,
        reason: "data_subject_request",
        privacyClass: "personal"
      });
      expect(JSON.stringify(withdrawn[0]!.payload)).not.toContain("person0");

      // Concurrent withdrawals still publish exactly one event.
      const [other] = await seedSubmissions(1);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          inTenant(T1, (tx) =>
            withdrawSubmission(
              tx,
              T1,
              U1,
              other!,
              "controller_decision",
              undefined
            )
          )
        )
      );
      expect(
        await events(T1, "awcms.website_engagement.submission.withdrawn")
      ).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("the single-ring transition (Issue #1262, ADR-0137 section 3)", () => {
    // The retired single ring: one key that encrypted AND hashed.
    const OLD_SPEC = `k1:${keyBytes(9)}`;
    const OLD_RING = parseKeyRing(OLD_SPEC, "OLD") as KeyRing;
    const SINGLE_RING: WebsiteEngagementRings = {
      encryption: OLD_RING,
      hash: OLD_RING,
      legacyHash: []
    };

    /** The documented transition: old key LAST in the encryption ring, and verify-only for hashes. */
    function useTransitionRings() {
      process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS = `${ENCRYPTION_SPEC},${OLD_SPEC}`;
      process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = HASH_SPEC;
      process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS = OLD_SPEC;
      delete process.env.WEBSITE_ENGAGEMENT_KEYS;
    }

    /** What a deployment produced BEFORE #1262: a source and a submission, both under the one key. */
    async function writeUnderSingleRing(code: string) {
      const created = await inTenant(T1, (tx) =>
        createSource(
          tx,
          T1,
          U1,
          {
            code,
            name: code,
            consentCopyVersion: "v1",
            challengeMode: "none",
            acceptedKinds: ["contact", "lead", "interaction"],
            domainIds: [fx.domainIds.shop!]
          },
          OLD_RING
        )
      );

      if (created.outcome !== "created") throw new Error("fixture");

      const parsed = parseSourceToken(created.token)!;
      const verified = await verifyIntake(
        getRuntimeSql(),
        parsed,
        new Request("https://cms.integration.test/x", {
          method: "POST",
          headers: { origin: `https://${SHOP}` }
        }),
        SINGLE_RING
      );

      if (!verified) throw new Error("fixture: single-ring verify");

      const validated = validateSubmissionRequest(body(created.token));

      if (!validated.valid) throw new Error("fixture: body");

      const recorded = await recordSubmission(
        getRuntimeSql(),
        verified,
        validated.value,
        "source_none",
        SINGLE_RING,
        "corr-1262"
      );

      if (recorded.outcome !== "created") throw new Error("fixture: record");

      return {
        sourceId: created.source.id,
        token: created.token,
        secret: parsed.secret,
        submissionId: recorded.submissionId,
        emailNormalized: validated.value.contact!.emailNormalized!
      };
    }

    async function storedTokenHash(sourceId: string): Promise<string> {
      const rows = (await getAdminSql()`
        SELECT token_hash FROM awcms_engagement_sources WHERE id = ${sourceId}
      `) as { token_hash: string }[];

      return rows[0]!.token_hash;
    }

    async function storedSubmission(id: string) {
      const rows = (await getAdminSql()`
        SELECT contact_encrypted, email_hash, phone_hash
        FROM awcms_engagement_submissions WHERE id = ${id}
      `) as {
        contact_encrypted: string;
        email_hash: string;
        phone_hash: string;
      }[];

      return rows[0]!;
    }

    test("a token and the contact details written under the retired single ring keep resolving, and the token moves onto the hash ring on first use", async () => {
      useTransitionRings();

      const old = await writeUnderSingleRing("legacy-site");
      const before = await storedSubmission(old.submissionId);

      expect(await storedTokenHash(old.sourceId)).toMatch(/^k1:[0-9a-f]{64}$/);
      expect(before.contact_encrypted).toMatch(/^v2:k1:/);
      expect(before.email_hash).toMatch(/^k1:[0-9a-f]{64}$/);
      expect((await countSourceTokensByKeyId(getRuntimeSql(), T1)).k1).toBe(1);

      // Old ciphertext still decrypts: the old key is a NON-first encryption key.
      const revealed = await inTenant(T1, (tx) =>
        revealSubmission(tx, T1, old.submissionId, rings().encryption)
      );

      expect(revealed?.email).toBe("Budi.Santoso@Example.com");

      // An old identifier hash still resolves through the lookup candidates.
      expect(
        matchesAnyHash(
          before.email_hash,
          lookupHashCandidates(
            old.emailNormalized,
            { purpose: SUBMISSION_EMAIL_HASH_PURPOSE, tenantId: T1 },
            rings()
          )
        )
      ).toBe(true);

      // The old token is accepted through the public intake ...
      const first = await submit(body(old.token));

      expect(first.status).toBe(200);

      // ... and its stored hash now lives under the ACTIVE hash key.
      const upgraded = await storedTokenHash(old.sourceId);

      expect(upgraded).toMatch(/^h1:[0-9a-f]{64}$/);
      expect(
        matchesAnyHash(
          upgraded,
          lookupHashCandidates(
            old.secret,
            { purpose: SOURCE_TOKEN_HASH_PURPOSE, tenantId: T1 },
            rings()
          )
        )
      ).toBe(true);
      expect(
        (await countSourceTokensByKeyId(getRuntimeSql(), T1)).k1
      ).toBeUndefined();

      // New rows are written by the two NEW keys, never by the old one.
      const fresh = (await getAdminSql()`
        SELECT contact_encrypted, email_hash, phone_hash
        FROM awcms_engagement_submissions
        WHERE source_id = ${old.sourceId} AND id <> ${old.submissionId}
      `) as {
        contact_encrypted: string;
        email_hash: string;
        phone_hash: string;
      }[];

      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.contact_encrypted).toMatch(/^v2:e1:/);
      expect(fresh[0]!.email_hash).toMatch(/^h1:/);
      expect(fresh[0]!.phone_hash).toMatch(/^h1:/);

      // The old submission is evidence: nothing rewrote it.
      expect(await storedSubmission(old.submissionId)).toEqual(before);
      expect(await countSubmissionContactsByKeyId(getRuntimeSql(), T1)).toEqual(
        { k1: 1, e1: 1 }
      );

      // Without the legacy keys now, the token keeps working: it is on h1.
      delete process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;
      expect((await submit(body(old.token))).status).toBe(200);
    });

    test("without the legacy keys a single-ring token is the uniform refusal, and the retired variable fails closed", async () => {
      useTransitionRings();

      const old = await writeUnderSingleRing("legacy-off");

      delete process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;

      const refusedOld = await submit(body(old.token));
      const refusedGarbage = await submit(
        body(`${old.token.slice(0, -4)}AAAA`)
      );

      expect(refusedOld.status).toBe(403);
      expect(refusedOld.text).toBe(refusedGarbage.text);
      expect(await storedTokenHash(old.sourceId)).toMatch(/^k1:/);

      // Only the retired single ring: refused by name, never used for a role.
      delete process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS;
      delete process.env.WEBSITE_ENGAGEMENT_HASH_KEYS;
      process.env.WEBSITE_ENGAGEMENT_KEYS = OLD_SPEC;
      expect((await submit(body(old.token))).status).toBe(503);

      // Still set NEXT TO the new rings: also refused.
      useTransitionRings();
      process.env.WEBSITE_ENGAGEMENT_KEYS = OLD_SPEC;
      expect((await submit(body(old.token))).status).toBe(503);

      // One key in both new rings: refused at runtime, whatever config:validate said.
      useCurrentRings();
      process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = `h9:${keyBytes(3)}`;
      expect((await submit(body(fx.tokens.a!))).status).toBe(503);
    });

    test("the upgrade never overwrites a rotation that commits while it runs (compare-and-swap)", async () => {
      useTransitionRings();

      const old = await writeUnderSingleRing("legacy-race");
      const ROTATED = `h1:${"a".repeat(64)}`;
      let upgrade: Promise<unknown> | undefined;

      // A rotation holds the row; the intake reads the OLD hash, matches it, and
      // its upgrade UPDATE waits for the lock. The rotation then commits.
      await asApp(T1, async (tx) => {
        await tx`
          SELECT 1 FROM awcms_engagement_sources WHERE id = ${old.sourceId} FOR UPDATE
        `;
        upgrade = verifyIntake(
          getRuntimeSql(),
          parseSourceToken(old.token)!,
          new Request("https://cms.integration.test/x", {
            method: "POST",
            headers: { origin: `https://${SHOP}` }
          }),
          rings()
        );
        await Bun.sleep(400);
        await tx`
          UPDATE awcms_engagement_sources SET token_hash = ${ROTATED}
          WHERE id = ${old.sourceId}
        `;
      });

      await upgrade;

      // The upgrade found no row still carrying the hash it matched.
      expect(await storedTokenHash(old.sourceId)).toBe(ROTATED);
    });

    test("rotating a single-ring source moves it onto the hash ring and retires the old token", async () => {
      useTransitionRings();

      const old = await writeUnderSingleRing("legacy-rotate");
      const rotated = await inTenant(T1, (tx) =>
        rotateSource(tx, T1, U1, old.sourceId, rings().hash)
      );

      if (rotated.outcome !== "rotated") throw new Error("rotate");

      expect(await storedTokenHash(old.sourceId)).toMatch(/^h1:/);
      expect((await submit(body(old.token))).status).toBe(403);
      expect((await submit(body(rotated.token))).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe("sources", () => {
    test("the token is stored only as a keyed hash; the view never carries it", async () => {
      const secret = fx.tokens.a!.split(".")[3]!;
      const rows = (await getAdminSql()`
        SELECT to_jsonb(s)::text AS row FROM awcms_engagement_sources s
      `) as { row: string }[];

      for (const row of rows) {
        expect(row.row).not.toContain(secret);
        expect(row.row).toMatch(/"token_hash": "h1:[0-9a-f]{64}"/);
      }

      const view = await inTenant(T1, (tx) =>
        createSource(
          tx,
          T1,
          U1,
          {
            code: "another",
            name: "Another",
            consentCopyVersion: "v1",
            challengeMode: "none",
            acceptedKinds: ["lead"],
            domainIds: []
          },
          rings().hash
        )
      );

      expect(view.outcome).toBe("created");

      if (view.outcome === "created") {
        expect(JSON.stringify(view.source)).not.toContain(
          view.token.split(".")[3]!
        );
        expect(Object.keys(view.source)).not.toContain("tokenHash");
        expect(view.source.tokenPrefix).toBe(
          view.token.split(".")[3]!.slice(0, 6)
        );
      }
    });

    test("a code is unique per tenant (live rows) and a foreign or missing domain is refused", async () => {
      const duplicate = await inTenant(T1, (tx) =>
        createSource(
          tx,
          T1,
          U1,
          {
            code: "site-a",
            name: "Dup",
            consentCopyVersion: "v1",
            challengeMode: "none",
            acceptedKinds: ["lead"],
            domainIds: []
          },
          rings().hash
        )
      );
      const foreign = await inTenant(T1, (tx) =>
        createSource(
          tx,
          T1,
          U1,
          {
            code: "foreign",
            name: "Foreign",
            consentCopyVersion: "v1",
            challengeMode: "none",
            acceptedKinds: ["lead"],
            domainIds: [fx.domainIds.other!]
          },
          rings().hash
        )
      );
      const sameCodeOtherTenant = await inTenant(T2, (tx) =>
        createSource(
          tx,
          T2,
          U2,
          {
            code: "site-a",
            name: "Fine",
            consentCopyVersion: "v1",
            challengeMode: "none",
            acceptedKinds: ["lead"],
            domainIds: []
          },
          rings().hash
        )
      );

      expect(duplicate.outcome).toBe("code_taken");
      expect(foreign.outcome).toBe("domain_not_found");
      expect(sameCodeOtherTenant.outcome).toBe("created");
      expect(await count("awcms_engagement_sources", T1)).toBe(3);
    });

    test("a revoked source cannot be changed, rotated or reactivated, and revoking again is idempotent", async () => {
      const first = await inTenant(T1, (tx) =>
        revokeSource(tx, T1, U1, fx.sourceIds.a!)
      );
      const again = await inTenant(T1, (tx) =>
        revokeSource(tx, T1, U1, fx.sourceIds.a!)
      );

      expect(first).toMatchObject({ outcome: "revoked", changed: true });
      expect(again).toMatchObject({ outcome: "revoked", changed: false });
      expect(
        (
          await inTenant(T1, (tx) =>
            updateSource(tx, T1, U1, fx.sourceIds.a!, { name: "x" })
          )
        ).outcome
      ).toBe("revoked");
      expect(
        (
          await inTenant(T1, (tx) =>
            rotateSource(tx, T1, U1, fx.sourceIds.a!, rings().hash)
          )
        ).outcome
      ).toBe("revoked");

      const error = await assertRejected(
        getAdminSql()`UPDATE awcms_engagement_sources SET status = 'active', revoked_at = NULL WHERE id = ${fx.sourceIds.a}`,
        "reactivating a revoked source"
      );

      expect(String(error.message)).toContain("cannot be reactivated");
    });
  });

  // -------------------------------------------------------------------------
  describe("RLS FORCE, role grants and integrity guards", () => {
    test("without a tenant context the runtime role sees nothing, and another tenant's rows are invisible", async () => {
      await submit(body(fx.tokens.a!));

      for (const table of [
        "awcms_engagement_sources",
        "awcms_engagement_source_domains",
        "awcms_engagement_submissions"
      ]) {
        const none = await asApp(null, (tx) =>
          tx.unsafe(`SELECT count(*)::int AS n FROM ${table}`)
        );

        expect((none as { n: number }[])[0]!.n).toBe(0);

        const other = await asApp(T2, (tx) =>
          tx.unsafe(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = '${T1}'`
          )
        );

        expect((other as { n: number }[])[0]!.n).toBe(0);
      }
    });

    test("RLS WITH CHECK: a row for another tenant cannot be written", async () => {
      const error = await assertRejected(
        asApp(
          T1,
          (tx) => tx`
          INSERT INTO awcms_engagement_sources
            (tenant_id, code, name, consent_copy_version, token_hash, token_prefix)
          VALUES (${T2}, 'smuggled', 'Smuggled', 'v1', ${`k1:${"0".repeat(64)}`}, 'abcdef')
        `
        ),
        "a cross-tenant source insert"
      );

      expect(String(error.message)).toMatch(/row-level security/i);
    });

    test("the runtime role cannot DELETE or TRUNCATE evidence", async () => {
      await submit(body(fx.tokens.a!));

      await assertRejected(
        asApp(
          T1,
          (tx) =>
            tx`DELETE FROM awcms_engagement_submissions WHERE tenant_id = ${T1}`
        ),
        "an app-role delete of a submission"
      );
      await assertRejected(
        asApp(
          T1,
          (tx) =>
            tx`DELETE FROM awcms_engagement_sources WHERE tenant_id = ${T1}`
        ),
        "an app-role delete of a source"
      );
      await assertRejected(
        asApp(T1, (tx) => tx`TRUNCATE awcms_engagement_submissions`),
        "an app-role truncate"
      );
      expect(await count("awcms_engagement_submissions", T1)).toBe(1);
    });

    test("the worker can purge submissions and read no identifier, hash or ciphertext", async () => {
      if (!workerRoleActivated) return;

      await submit(body(fx.tokens.a!));

      const worker = getWorkerRoleSql();
      const probe = <R>(work: (tx: Bun.TransactionSQL) => Promise<R>) =>
        worker.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${T1}, true)`;

          return work(tx);
        }) as Promise<R>;

      for (const denied of [
        (tx: Bun.TransactionSQL) =>
          tx`SELECT contact_encrypted FROM awcms_engagement_submissions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT email_hash FROM awcms_engagement_submissions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT phone_hash FROM awcms_engagement_submissions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT email_masked FROM awcms_engagement_submissions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT * FROM awcms_engagement_submissions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT token_hash FROM awcms_engagement_sources`,
        (tx: Bun.TransactionSQL) => tx`SELECT id FROM awcms_engagement_sources`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT tenant_id FROM awcms_engagement_source_domains`,
        (tx: Bun.TransactionSQL) =>
          tx`UPDATE awcms_engagement_submissions SET status = 'withdrawn'`,
        (tx: Bun.TransactionSQL) =>
          tx`INSERT INTO awcms_engagement_sources (tenant_id, code, name, consent_copy_version, token_hash, token_prefix)
             VALUES (${T1}, 'w', 'w', 'v1', ${`k1:${"0".repeat(64)}`}, 'abcdef')`
      ]) {
        await assertRejected(
          probe(denied),
          "a worker access to website engagement data"
        );
      }

      const cursor = (await probe(
        (tx) =>
          tx`SELECT id, tenant_id, received_at FROM awcms_engagement_submissions`
      )) as { id: string }[];

      expect(cursor).toHaveLength(1);

      await probe(
        (tx) =>
          tx`DELETE FROM awcms_engagement_submissions WHERE id = ${cursor[0]!.id}`
      );
      expect(await count("awcms_engagement_submissions", T1)).toBe(0);
    });

    test("a submission is evidence: only its withdrawal may change, and a withdrawal is one-way", async () => {
      await submit(body(fx.tokens.a!));

      const admin = getAdminSql();
      const id = (
        (await admin`SELECT id FROM awcms_engagement_submissions`) as {
          id: string;
        }[]
      )[0]!.id;

      for (const attempt of [
        admin`UPDATE awcms_engagement_submissions SET consent_purposes = ARRAY['respond_to_inquiry','marketing_follow_up'] WHERE id = ${id}`,
        admin`UPDATE awcms_engagement_submissions SET consent_copy_version = 'v9' WHERE id = ${id}`,
        admin`UPDATE awcms_engagement_submissions SET contact_encrypted = 'x' WHERE id = ${id}`,
        admin`UPDATE awcms_engagement_submissions SET origin_host = 'evil.example' WHERE id = ${id}`,
        admin`UPDATE awcms_engagement_submissions SET received_at = now() - interval '1 year' WHERE id = ${id}`
      ]) {
        const error = await assertRejected(
          attempt,
          "rewriting submission evidence"
        );

        expect(String(error.message)).toContain("evidence");
      }

      // A withdrawal that does NOT erase the person is refused by the shape CHECK.
      await assertRejected(
        admin`
          UPDATE awcms_engagement_submissions
          SET status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = 'controller_decision'
          WHERE id = ${id}
        `,
        "a withdrawal that keeps the contact blob"
      );

      // M3: the withdrawal erases the blob, the keyed hashes and the masked values.
      await admin`
        UPDATE awcms_engagement_submissions
        SET status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = 'controller_decision',
            contact_encrypted = NULL, email_hash = NULL, phone_hash = NULL,
            email_masked = NULL, phone_masked = NULL
        WHERE id = ${id}
      `;

      const erased = (await admin`
        SELECT contact_encrypted, email_hash, phone_hash, email_masked, phone_masked,
               consent_purposes, consent_copy_version, consent_at, landing_path
        FROM awcms_engagement_submissions WHERE id = ${id}
      `) as Record<string, unknown>[];

      expect(erased[0]).toMatchObject({
        contact_encrypted: null,
        email_hash: null,
        phone_hash: null,
        email_masked: null,
        phone_masked: null,
        consent_copy_version: "v1",
        landing_path: "/produk"
      });
      expect(erased[0]!.consent_purposes).toEqual(["respond_to_inquiry"]);

      // ...and nothing can be written back afterwards.
      for (const column of [
        "contact_encrypted = 'x'",
        "email_masked = 'a***@b.co'"
      ]) {
        await assertRejected(
          admin.unsafe(
            `UPDATE awcms_engagement_submissions SET ${column} WHERE id = '${id}'`
          ),
          "restoring erased identifiers"
        );
      }

      const oneWay = await assertRejected(
        admin`UPDATE awcms_engagement_submissions SET status = 'received', withdrawn_at = NULL, withdrawal_reason = NULL WHERE id = ${id}`,
        "un-withdrawing"
      );

      expect(String(oneWay.message)).toContain("one-way");
    });

    test("the shape CHECKs refuse a contact without consent, an interaction with a person, and a duplicate replay key", async () => {
      const admin = getAdminSql();
      const source = fx.sourceIds.a!;
      const base = {
        tenant: T1,
        source,
        origin: SHOP
      };
      const insert = (columns: string, values: string) =>
        admin.unsafe(
          `INSERT INTO awcms_engagement_submissions
             (tenant_id, source_id, event_id, occurred_at, origin_host, origin_via, challenge_outcome, ${columns})
           VALUES ('${base.tenant}', '${base.source}', 'evt-check-0001', now(), '${base.origin}', 'origin', 'not_required', ${values})`
        );

      await assertRejected(
        insert(
          "kind, privacy_class, contact_encrypted, email_hash",
          `'contact', 'personal', 'v2:k1:a:b:c', 'k1:${"0".repeat(64)}'`
        ),
        "a contact with no consent"
      );
      await assertRejected(
        insert(
          "kind, privacy_class, interaction_type, email_masked",
          `'interaction', 'anonymous', 'cta_click', 'a***@b.co'`
        ),
        "an interaction carrying a person"
      );
      await assertRejected(
        insert(
          "kind, privacy_class, interaction_type, landing_path",
          `'interaction', 'anonymous', 'cta_click', '/a?utm=1'`
        ),
        "a landing path with a query"
      );
      await insert(
        "kind, privacy_class, interaction_type",
        `'interaction', 'anonymous', 'cta_click'`
      );
      await assertRejected(
        insert(
          "kind, privacy_class, interaction_type",
          `'interaction', 'anonymous', 'cta_click'`
        ),
        "a duplicate replay key"
      );
    });

    test("a source may list only a live domain of its own tenant, and its identity is immutable", async () => {
      const admin = getAdminSql();

      const error = await assertRejected(
        admin`
          INSERT INTO awcms_engagement_source_domains (tenant_id, source_id, tenant_domain_id)
          VALUES (${T1}, ${fx.sourceIds.a}, ${fx.domainIds.other})
        `,
        "linking another tenant's domain"
      );

      expect(String(error.message)).toContain("own tenant");

      // L1: re-pointing an EXISTING link at another tenant's domain is refused too.
      const update = await assertRejected(
        admin`
          UPDATE awcms_engagement_source_domains SET tenant_domain_id = ${fx.domainIds.other}
          WHERE source_id = ${fx.sourceIds.a}
        `,
        "re-pointing a link at another tenant's domain"
      );

      expect(String(update.message)).toContain("own tenant");

      await assertRejected(
        admin`UPDATE awcms_engagement_sources SET code = 'renamed' WHERE id = ${fx.sourceIds.a}`,
        "changing a source code"
      );
      await assertRejected(
        admin`UPDATE awcms_engagement_sources SET tenant_id = ${T2} WHERE id = ${fx.sourceIds.a}`,
        "moving a source to another tenant"
      );
    });
  });
});
