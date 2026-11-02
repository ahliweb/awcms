/**
 * The administrator surface of `website_engagement`, driven through the REAL
 * route handlers against a real PostgreSQL (Issue #1153, ADR-0155) — WORLD 2 of
 * the harness.
 *
 * What this proves that the service-level suite cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every verb,
 *     and every guard BITES (a user holding every permission but one is refused
 *     that action), which also proves each guard names a permission the
 *     migration really seeded;
 *   * the token is shown ONCE: create and rotate reveal it, a replay of the
 *     same Idempotency-Key does not, a list never carries it, and it appears
 *     in no audit row, idempotency row or source row;
 *   * the public POST on the SAME path works end to end through the route file
 *     and its submission is readable (masked), revealable (audited, never in
 *     the audit row) and withdrawable (idempotent) by an administrator;
 *   * another tenant's id answers the same 404 everywhere.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { websiteEngagementModule } from "../../src/modules/website-engagement/module";
import {
  GET as listSources,
  POST as createSource
} from "../../src/pages/api/v1/website-engagement/sources/index";
import {
  DELETE as deleteSource,
  GET as getSource,
  PATCH as patchSource
} from "../../src/pages/api/v1/website-engagement/sources/[id]/index";
import { POST as rotateSource } from "../../src/pages/api/v1/website-engagement/sources/[id]/rotate";
import { POST as revokeSource } from "../../src/pages/api/v1/website-engagement/sources/[id]/revoke";
import {
  GET as listSubmissions,
  OPTIONS as submissionsPreflight,
  POST as publicSubmit
} from "../../src/pages/api/v1/website-engagement/submissions/index";
import { GET as getSubmission } from "../../src/pages/api/v1/website-engagement/submissions/[id]/index";
import { POST as revealSubmission } from "../../src/pages/api/v1/website-engagement/submissions/[id]/reveal";
import { POST as withdrawSubmission } from "../../src/pages/api/v1/website-engagement/submissions/[id]/withdraw";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const RING = `k1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64")}`;
const BASE = "/api/v1/website-engagement";
const HOST = "www.owner-site.example";

type Env = { tenantId: string; token: string; domainId: string };
type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "we-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "WE Co",
      tenantCode: "we-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);

  const domain = (await admin()`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, domain_type, status, verified_at)
    VALUES (${tenantId}, ${HOST}, ${HOST}, 'custom_domain', 'active', now())
    RETURNING id
  `) as { id: string }[];

  return { tenantId, token: login.body.data.token, domainId: domain[0]!.id };
}

/** A person with exactly `permissionKeys`. */
async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `we-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      grantRolePolicy(tx, tenantId, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "website engagement fixture"
      })
    );
  }

  return { token };
}

const ALL_PERMISSIONS = (websiteEngagementModule.permissions ?? []).map(
  (permission) =>
    `website_engagement.${permission.activityCode}.${permission.action}`
);

function call<T = any>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-1153" }
  });
}

function create(
  extra: Record<string, unknown> = {},
  token?: string | null,
  key?: string | null
) {
  return call(createSource, {
    method: "POST",
    path: `${BASE}/sources`,
    token,
    idempotencyKey: key,
    body: {
      code: "main-site",
      name: "Main site",
      consentCopyVersion: "v1",
      acceptedKinds: ["contact", "lead", "interaction"],
      challengeMode: "none",
      domainIds: [env.domainId],
      ...extra
    }
  });
}

async function publicPost(
  token: string,
  overrides: Record<string, unknown> = {}
) {
  return invoke<Envelope>(publicSubmit, {
    method: "POST",
    path: `${BASE}/submissions`,
    // NO authorization and NO tenant header: the token is the credential.
    headers: { "content-type": "application/json", origin: `https://${HOST}` },
    body: {
      sourceToken: token,
      eventId: `evt-${crypto.randomUUID().slice(0, 12)}`,
      kind: "contact",
      contact: { name: "Siti", email: "siti@example.com", message: "Halo" },
      consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" },
      ...overrides
    }
  });
}

async function everythingPersisted(): Promise<string> {
  const rows = (await admin()`
    SELECT to_jsonb(t)::text AS row FROM awcms_engagement_sources t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_engagement_submissions t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_idempotency_keys t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
  `) as { row: string }[];

  return rows.map((entry) => entry.row).join("\n");
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("website_engagement HTTP surface (Issue #1153)", () => {
  beforeAll(async () => {
    for (const name of [
      "WEBSITE_ENGAGEMENT_KEYS",
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX"
    ]) {
      savedEnv[name] = process.env[name];
    }

    process.env.WEBSITE_ENGAGEMENT_KEYS = RING;
    process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "10000";
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    process.env.WEBSITE_ENGAGEMENT_KEYS = RING;
    process.env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX = "10000";
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;

    const noRole = await seedUser(env.tenantId, "norole", []);
    const created = (await create()).body.data!;
    const id = created.id as string;
    const sid = "00000000-0000-4000-8000-000000000001";

    expect(
      (await call(listSources, { path: `${BASE}/sources`, token: null })).status
    ).toBe(401);
    expect(
      (
        await call(listSubmissions, {
          path: `${BASE}/submissions`,
          token: null
        })
      ).status
    ).toBe(401);

    const attempts = [
      call(listSources, { path: `${BASE}/sources`, token: noRole.token }),
      create({ code: "denied-site" }, noRole.token),
      call(getSource, {
        path: `${BASE}/sources/${id}`,
        params: { id },
        token: noRole.token
      }),
      call(patchSource, {
        method: "PATCH",
        path: `${BASE}/sources/${id}`,
        params: { id },
        token: noRole.token,
        body: { name: "Hacked" }
      }),
      call(deleteSource, {
        method: "DELETE",
        path: `${BASE}/sources/${id}`,
        params: { id },
        token: noRole.token
      }),
      call(rotateSource, {
        method: "POST",
        path: `${BASE}/sources/${id}/rotate`,
        params: { id },
        token: noRole.token
      }),
      call(revokeSource, {
        method: "POST",
        path: `${BASE}/sources/${id}/revoke`,
        params: { id },
        token: noRole.token
      }),
      call(listSubmissions, {
        path: `${BASE}/submissions`,
        token: noRole.token
      }),
      call(getSubmission, {
        path: `${BASE}/submissions/${sid}`,
        params: { id: sid },
        token: noRole.token
      }),
      call(revealSubmission, {
        method: "POST",
        path: `${BASE}/submissions/${sid}/reveal`,
        params: { id: sid },
        token: noRole.token
      }),
      call(withdrawSubmission, {
        method: "POST",
        path: `${BASE}/submissions/${sid}/withdraw`,
        params: { id: sid },
        token: noRole.token,
        body: { reason: "controller_decision" }
      })
    ];

    for (const result of await Promise.all(attempts)) {
      expect(result.status).toBe(403);
    }

    expect(
      (
        (await admin()`SELECT count(*)::int AS n FROM awcms_engagement_sources`) as {
          n: number;
        }[]
      )[0]!.n
    ).toBe(1);
  });

  test("every guard bites: a user holding every permission but one is refused exactly that action", async () => {
    if (!handlerReady) return;

    const source = (await create()).body.data!;
    const id = source.id as string;
    const sid = "00000000-0000-4000-8000-000000000001";
    const actions: Record<
      string,
      (token: string) => Promise<{ status: number }>
    > = {
      "website_engagement.sources.read": (token) =>
        call(listSources, { path: `${BASE}/sources`, token }),
      "website_engagement.sources.manage": (token) =>
        call(patchSource, {
          method: "PATCH",
          path: `${BASE}/sources/${id}`,
          params: { id },
          token,
          body: { name: "Renamed" }
        }),
      "website_engagement.submissions.read": (token) =>
        call(listSubmissions, { path: `${BASE}/submissions`, token }),
      "website_engagement.submissions.reveal": (token) =>
        call(revealSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${sid}/reveal`,
          params: { id: sid },
          token
        }),
      "website_engagement.submissions.withdraw": (token) =>
        call(withdrawSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${sid}/withdraw`,
          params: { id: sid },
          token,
          body: { reason: "controller_decision" }
        })
    };

    for (const missing of ALL_PERMISSIONS) {
      const without = await seedUser(
        env.tenantId,
        `without-${missing.split(".").slice(1).join("-")}`,
        ALL_PERMISSIONS.filter((key) => key !== missing)
      );

      expect((await actions[missing]!(without.token)).status).toBe(403);
    }

    // And the same user holding ONLY that permission is let through to the handler (not 403).
    for (const key of ALL_PERMISSIONS) {
      const only = await seedUser(
        env.tenantId,
        `only-${key.split(".").slice(1).join("-")}`,
        [key]
      );

      expect((await actions[key]!(only.token)).status).not.toBe(403);
    }
  });

  test("the token is shown once: create and rotate reveal it, replay and list never do, and no store holds it", async () => {
    if (!handlerReady) return;

    const key = nextKey();
    const first = await create({}, undefined, key);

    expect(first.status).toBe(201);
    expect(first.body.data.revealed).toBe(true);
    expect(first.body.data.token).toMatch(
      /^wes1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
    );
    expect(first.body.data.tokenPrefix).toBe(
      first.body.data.token.split(".")[3].slice(0, 6)
    );
    expect(first.body.data.challengeEffective).toBe("none");
    expect(first.body.data.domains).toHaveLength(1);

    const secret = first.body.data.token.split(".")[3] as string;
    const replay = await create({}, undefined, key);

    expect(replay.status).toBe(201);
    expect(replay.body.data.revealed).toBe(false);
    expect(replay.body.data.token).toBeUndefined();

    // Same key, different request.
    expect((await create({ name: "Other" }, undefined, key)).status).toBe(409);
    // Same code, new key.
    const taken = await create({}, undefined, nextKey());

    expect(taken.status).toBe(409);
    expect(taken.body.error?.code).toBe("SOURCE_CODE_TAKEN");

    const id = first.body.data.id as string;
    const listed = await call(listSources, { path: `${BASE}/sources` });

    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect(JSON.stringify(listed.body)).not.toMatch(/token_hash|tokenHash/);

    const rotateKey = nextKey();
    const rotated = await call(rotateSource, {
      method: "POST",
      path: `${BASE}/sources/${id}/rotate`,
      params: { id },
      idempotencyKey: rotateKey
    });
    const newSecret = rotated.body.data.token.split(".")[3] as string;

    expect(rotated.status).toBe(200);
    expect(rotated.body.data.revealed).toBe(true);
    expect(newSecret).not.toBe(secret);
    expect(
      (
        await call(rotateSource, {
          method: "POST",
          path: `${BASE}/sources/${id}/rotate`,
          params: { id },
          idempotencyKey: rotateKey
        })
      ).body.data.token
    ).toBeUndefined();

    const everything = await everythingPersisted();

    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(newSecret);

    const audit = (await admin()`
      SELECT action, severity FROM awcms_audit_events WHERE module_key = 'website_engagement' ORDER BY created_at
    `) as { action: string; severity: string }[];

    expect(audit.map((row) => row.action)).toEqual([
      "website_engagement.source.create",
      "website_engagement.source.rotate"
    ]);
    expect(audit.every((row) => row.severity === "warning")).toBe(true);

    // The old token no longer works; the new one does.
    expect((await publicPost(first.body.data.token)).status).toBe(403);
    expect((await publicPost(rotated.body.data.token)).status).toBe(200);
  });

  test("a domain of another tenant or a missing one is refused, and a source can be paused, resumed, revoked and deleted", async () => {
    if (!handlerReady) return;

    const other = "00000000-0000-4000-8000-0000000000aa";

    expect(
      (await create({ code: "bad-domain", domainIds: [other] })).body.error
        ?.code
    ).toBe("DOMAIN_NOT_FOUND");

    const source = (await create()).body.data!;
    const id = source.id as string;

    expect(
      (
        await call(patchSource, {
          method: "PATCH",
          path: `${BASE}/sources/${id}`,
          params: { id },
          body: { status: "paused" }
        })
      ).body.data.status
    ).toBe("paused");
    expect((await publicPost(source.token)).status).toBe(403);
    await call(patchSource, {
      method: "PATCH",
      path: `${BASE}/sources/${id}`,
      params: { id },
      body: { status: "active" }
    });
    expect((await publicPost(source.token)).status).toBe(200);

    const revoked = await call(revokeSource, {
      method: "POST",
      path: `${BASE}/sources/${id}/revoke`,
      params: { id }
    });

    expect(revoked.body.data.status).toBe("revoked");
    expect(
      (
        await call(revokeSource, {
          method: "POST",
          path: `${BASE}/sources/${id}/revoke`,
          params: { id }
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(patchSource, {
          method: "PATCH",
          path: `${BASE}/sources/${id}`,
          params: { id },
          body: { name: "x" }
        })
      ).body.error?.code
    ).toBe("SOURCE_REVOKED");
    expect((await publicPost(source.token)).status).toBe(403);

    const other2 = (await create({ code: "to-delete" })).body.data!;

    expect(
      (
        await call(deleteSource, {
          method: "DELETE",
          path: `${BASE}/sources/${other2.id}`,
          params: { id: other2.id }
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(getSource, {
          path: `${BASE}/sources/${other2.id}`,
          params: { id: other2.id }
        })
      ).status
    ).toBe(404);

    // An unknown id is a 404, a malformed one a 400.
    expect(
      (
        await call(getSource, {
          path: `${BASE}/sources/${other}`,
          params: { id: other }
        })
      ).status
    ).toBe(404);
    expect(
      (
        await call(getSource, {
          path: `${BASE}/sources/nope`,
          params: { id: "nope" }
        })
      ).status
    ).toBe(400);
  });

  test("the public POST shares its path with the admin GET: unauthenticated by design, default-deny for everything else", async () => {
    if (!handlerReady) return;

    const source = (await create()).body.data!;
    const accepted = await publicPost(source.token);

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.received).toBe(true);

    // The same path, GET, with no credential: 401, not a leak.
    expect(
      (
        await call(listSubmissions, {
          path: `${BASE}/submissions`,
          token: null
        })
      ).status
    ).toBe(401);

    // The preflight is answered for a verified tenant domain only, and never with *.
    const preflight = await invoke(submissionsPreflight, {
      method: "OPTIONS",
      path: `${BASE}/submissions`,
      headers: {
        origin: `https://${HOST}`,
        "access-control-request-method": "POST"
      }
    });

    expect(preflight.status).toBe(204);
    expect(preflight.response.headers.get("access-control-allow-origin")).toBe(
      `https://${HOST}`
    );
    expect(preflight.response.headers.get("access-control-allow-headers")).toBe(
      "content-type"
    );
    expect(
      preflight.response.headers.get("access-control-allow-credentials")
    ).toBeNull();

    const refused = await invoke(submissionsPreflight, {
      method: "OPTIONS",
      path: `${BASE}/submissions`,
      headers: { origin: "https://evil.example" }
    });

    expect(refused.status).toBe(204);
    expect(
      refused.response.headers.get("access-control-allow-origin")
    ).toBeNull();
  });

  test("masked reads, an audited reveal that never records the values, and an idempotent withdrawal", async () => {
    if (!handlerReady) return;

    const source = (await create()).body.data!;

    await publicPost(source.token, {
      contact: {
        name: "Siti Aminah",
        email: "siti.aminah@example.com",
        phone: "0812 3456 7890",
        message: "Mohon penawaran"
      }
    });

    const listed = await call(listSubmissions, { path: `${BASE}/submissions` });

    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain("siti.aminah");
    expect(JSON.stringify(listed.body)).not.toContain("Mohon penawaran");

    const item = listed.body.data.items[0];
    const id = item.id as string;

    expect(item.emailMasked).toMatch(/^s\*+@example\.com$/);
    expect(item.consent.purposes).toEqual(["respond_to_inquiry"]);
    expect(item.provenance.originHost).toBe(HOST);

    expect(
      (
        await call(getSubmission, {
          path: `${BASE}/submissions/${id}`,
          params: { id }
        })
      ).body.data.id
    ).toBe(id);

    const reveal = await call(revealSubmission, {
      method: "POST",
      path: `${BASE}/submissions/${id}/reveal`,
      params: { id }
    });

    expect(reveal.status).toBe(200);
    expect(reveal.body.data.contact.email).toBe("siti.aminah@example.com");
    expect(reveal.body.data.contact.message).toBe("Mohon penawaran");
    expect(reveal.response.headers.get("cache-control")).toBe("no-store");

    const audit = (await admin()`
      SELECT to_jsonb(a)::text AS row FROM awcms_audit_events a
      WHERE action = 'website_engagement.submission.reveal'
    `) as { row: string }[];

    expect(audit).toHaveLength(1);
    expect(audit[0]!.row).not.toContain("siti.aminah");
    expect(audit[0]!.row).not.toContain("Mohon penawaran");

    const key = nextKey();
    const withdraw = () =>
      call(withdrawSubmission, {
        method: "POST",
        path: `${BASE}/submissions/${id}/withdraw`,
        params: { id },
        idempotencyKey: key,
        body: { reason: "data_subject_request" }
      });
    const first = await withdraw();
    const replay = await withdraw();

    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("withdrawn");
    expect(replay.body).toEqual(first.body);
    expect(
      (
        await call(withdrawSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${id}/withdraw`,
          params: { id },
          body: { reason: "consent_withdrawn" }
        })
      ).body.data.withdrawalReason
    ).toBe("data_subject_request");
    expect(
      (
        await call(withdrawSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${id}/withdraw`,
          params: { id },
          idempotencyKey: key,
          body: { reason: "consent_withdrawn" }
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(withdrawSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${id}/withdraw`,
          params: { id },
          idempotencyKey: null,
          body: { reason: "consent_withdrawn" }
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(withdrawSubmission, {
          method: "POST",
          path: `${BASE}/submissions/${id}/withdraw`,
          params: { id },
          body: { reason: "because" }
        })
      ).status
    ).toBe(400);

    // A withdrawn submission cannot be revealed.
    const afterWithdraw = await call(revealSubmission, {
      method: "POST",
      path: `${BASE}/submissions/${id}/reveal`,
      params: { id }
    });

    expect(afterWithdraw.status).toBe(409);
    expect(afterWithdraw.body.error?.code).toBe("SUBMISSION_WITHDRAWN");

    const events = (await admin()`
      SELECT event_type FROM awcms_domain_events
      WHERE event_type LIKE 'awcms.website_engagement.%' ORDER BY event_sequence
    `) as { event_type: string }[];

    expect(events.map((row) => row.event_type)).toEqual([
      "awcms.website_engagement.submission.received",
      "awcms.website_engagement.submission.withdrawn"
    ]);
  });

  test("L6: switching the challenge OFF needs an Idempotency-Key and writes a warning audit row naming old and new mode", async () => {
    if (!handlerReady) return;

    const source = (await create({ challengeMode: "turnstile" })).body.data!;
    const id = source.id as string;
    const patch = (body: unknown, key?: string | null) =>
      call(patchSource, {
        method: "PATCH",
        path: `${BASE}/sources/${id}`,
        params: { id },
        idempotencyKey: key,
        body
      });

    // A harmless change needs no key (the default test helper adds one only when undefined).
    expect((await patch({ name: "Renamed" }, null)).status).toBe(200);

    const missing = await patch({ challengeMode: "none" }, null);

    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
    expect(
      (
        (
          await call(getSource, {
            path: `${BASE}/sources/${id}`,
            params: { id }
          })
        ).body.data as any
      ).challengeMode
    ).toBe("turnstile");

    const key = nextKey();
    const done = await patch({ challengeMode: "none" }, key);

    expect(done.status).toBe(200);
    expect(done.body.data.challengeMode).toBe("none");
    expect((await patch({ challengeMode: "none" }, key)).body).toEqual(
      done.body
    );

    const audit = (await admin()`
      SELECT severity, attributes FROM awcms_audit_events
      WHERE action = 'website_engagement.source.update'
      ORDER BY created_at DESC LIMIT 1
    `) as { severity: string; attributes: Record<string, unknown> }[];

    expect(audit[0]!.severity).toBe("warning");
    expect(audit[0]!.attributes).toMatchObject({
      challengeModeFrom: "turnstile",
      challengeModeTo: "none"
    });
  });

  test("a missing key ring fails closed everywhere it would hash or decrypt", async () => {
    if (!handlerReady) return;

    const source = (await create()).body.data!;

    delete process.env.WEBSITE_ENGAGEMENT_KEYS;

    expect((await create({ code: "no-ring" })).status).toBe(503);
    expect(
      (
        await call(rotateSource, {
          method: "POST",
          path: `${BASE}/sources/${source.id}/rotate`,
          params: { id: source.id }
        })
      ).status
    ).toBe(503);
    expect((await publicPost(source.token)).status).toBe(503);

    process.env.WEBSITE_ENGAGEMENT_KEYS = RING;
  });
});
