/**
 * The `/api/v1/hr-commission/*` surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #950, ADR-0132) — WORLD-2 of the harness.
 *
 * What this proves that the unit tests cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every verb
 *     and writes nothing;
 *   * every guard BITES: a user holding every hr_commission permission EXCEPT
 *     one is refused that action, while a user holding ONLY that one succeeds
 *     (so "seeded" and "enforced" are the same fact);
 *   * the lifecycle: draft -> edit -> publish (immutable, 409 on edit) ->
 *     retire (terminal), version numbering, overlap refusal naming the version;
 *   * idempotency: publish and retire replay the stored response, a key reused
 *     with a different request is 409, a missing key is 400;
 *   * money is a string end to end: a JSON number is a 400;
 *   * the audit row carries the rule key and version, never a rate or an amount.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { hrCommissionModule } from "../../src/modules/hr-commission/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import {
  GET as listRules,
  POST as createRule
} from "../../src/pages/api/v1/hr-commission/rules/index";
import {
  GET as getRule,
  PUT as updateRule
} from "../../src/pages/api/v1/hr-commission/rules/[id]";
import { POST as publishRule } from "../../src/pages/api/v1/hr-commission/rules/[id]/publish";
import { POST as retireRule } from "../../src/pages/api/v1/hr-commission/rules/[id]/retire";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Rule = {
  id: string;
  ruleKey: string;
  versionNo: number;
  status: "draft" | "published" | "retired";
  name: string;
  calculation: string;
  rate: string | null;
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  currencyCode: string;
  roundingScale: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  contentDigest: string;
  publishedAt: string | null;
  retiredAt: string | null;
};

let env: Env;
/** A SECOND person holding every hr_commission permission: the checker (author != publisher). */
let publisherToken = "";
let keyCounter = 0;
let userCounter = 0;

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "cm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CM Co",
      tenantCode: "cm-co",
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    ownerTenantUserId: owner[0]!.id
  };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `cm-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
      RETURNING id
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
        reason: "partial-permission fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PERMISSIONS = (hrCommissionModule.permissions ?? []).map(
  (permission) =>
    `hr_commission.${permission.activityCode}.${permission.action}`
);

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    tenantId?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId
  };

  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (key) requestHeaders["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers: requestHeaders,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-950" }
  });
}

const RULE_BODY = {
  ruleKey: "upsell",
  name: "Upsell",
  sourceType: "sale_line",
  calculation: "percent",
  rate: "2.5",
  currencyCode: "XTS",
  roundingMode: "half_up",
  roundingScale: 2,
  effectiveFrom: "2026-01-01"
};

function draft(extra: Record<string, unknown> = {}, token?: string) {
  return call<Rule>(createRule, {
    method: "POST",
    path: "/api/v1/hr-commission/rules",
    body: { ...RULE_BODY, ...extra },
    token
  });
}

function editBody(extra: Record<string, unknown> = {}) {
  const { ruleKey: _key, ...rest } = RULE_BODY;

  return { ...rest, ...extra };
}

async function digestOf(id: string): Promise<string> {
  // Always read as the owner: the digest a reviewer was shown.
  return (await getOne(id)).body.data?.contentDigest ?? "0".repeat(64);
}

async function put(
  id: string,
  body: Record<string, unknown>,
  token?: string,
  digest?: string
) {
  return call<Rule>(updateRule, {
    method: "PUT",
    path: `/api/v1/hr-commission/rules/${id}`,
    params: { id },
    body: { expectedContentDigest: digest ?? (await digestOf(id)), ...body },
    token
  });
}

/** Publishes as the SECOND person (maker / checker), naming the digest they reviewed. */
async function publish(
  id: string,
  token?: string,
  key?: string | null,
  digest?: string
) {
  return call<Rule>(publishRule, {
    method: "POST",
    path: `/api/v1/hr-commission/rules/${id}/publish`,
    params: { id },
    body: {
      expectedContentDigest: digest ?? (await digestOf(id)),
      // The fixtures' windows start in the past; the reason is only stored when needed.
      backdatedReason: "fixture"
    },
    token: token ?? publisherToken,
    idempotencyKey: key
  });
}

function retire(id: string, token?: string, key?: string | null) {
  return call<Rule>(retireRule, {
    method: "POST",
    path: `/api/v1/hr-commission/rules/${id}/retire`,
    params: { id },
    token,
    idempotencyKey: key
  });
}

function getOne(id: string, token?: string) {
  return call<Rule>(getRule, {
    path: `/api/v1/hr-commission/rules/${id}`,
    params: { id },
    token
  });
}

async function count(): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM awcms_hr_commission_rules
    WHERE tenant_id = ${env.tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_commission HTTP surface (Issue #950)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    env = await bootstrap();
    publisherToken = (
      await seedUser(env.tenantId, "publisher", ALL_PERMISSIONS)
    ).token;
  });

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const rule = (await draft()).body.data!;
    const before = await count();

    expect(
      (
        await call(listRules, {
          path: "/api/v1/hr-commission/rules",
          token: null
        })
      ).status
    ).toBe(401);

    const attempts = [
      call(listRules, {
        path: "/api/v1/hr-commission/rules",
        token: noRole.token
      }),
      draft({ ruleKey: "other" }, noRole.token),
      getOne(rule.id, noRole.token),
      put(rule.id, editBody({ name: "Hacked" }), noRole.token),
      publish(rule.id, noRole.token),
      retire(rule.id, noRole.token)
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await count()).toBe(before);
    expect((await getOne(rule.id)).body.data!.name).toBe("Upsell");
  });

  describe("every guard bites (seeded AND enforced)", () => {
    const actions: [
      string,
      (id: string, token: string) => Promise<{ status: number }>
    ][] = [
      ["hr_commission.rules.read", (id, token) => getOne(id, token)],
      [
        "hr_commission.rules.create",
        (_id, token) => draft({ ruleKey: "g-new" }, token)
      ],
      [
        "hr_commission.rules.update",
        (id, token) => put(id, editBody({ name: "Edited" }), token)
      ],
      ["hr_commission.rules.publish", (id, token) => publish(id, token)],
      ["hr_commission.rules.retire", (id, token) => retire(id, token)]
    ];

    for (const [permission, act] of actions) {
      test(`${permission}: holding every OTHER permission is refused; holding only it succeeds`, async () => {
        if (!handlerReady) return;
        const rule = (await draft()).body.data!;
        const others = await seedUser(
          env.tenantId,
          "others",
          ALL_PERMISSIONS.filter((key) => key !== permission)
        );
        const only = await seedUser(env.tenantId, "only", [permission]);

        expect((await act(rule.id, others.token)).status).toBe(403);
        expect((await act(rule.id, only.token)).status).toBeLessThan(300);
      });
    }

    test("the seeded permissions match the descriptor verbatim", async () => {
      if (!handlerReady) return;
      const rows = (await admin()`
        SELECT activity_code, action, description FROM awcms_permissions
        WHERE module_key = 'hr_commission' ORDER BY activity_code, action
      `) as { activity_code: string; action: string; description: string }[];
      const declared = [...(hrCommissionModule.permissions ?? [])].sort(
        (a, b) =>
          `${a.activityCode}.${a.action}`.localeCompare(
            `${b.activityCode}.${b.action}`
          )
      );

      expect(
        rows.map((r) => [r.activity_code, r.action, r.description])
      ).toEqual(declared.map((p) => [p.activityCode, p.action, p.description]));
    });
  });

  describe("the lifecycle", () => {
    test("create assigns version 1, status draft; the next draft of the key is version 2", async () => {
      if (!handlerReady) return;
      const first = await draft();

      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({
        ruleKey: "upsell",
        versionNo: 1,
        status: "draft",
        rate: "2.5",
        fixedAmount: null,
        effectiveTo: null,
        publishedAt: null
      });

      const second = await draft({ effectiveFrom: "2027-01-01" });
      expect(second.body.data!.versionNo).toBe(2);

      const other = await draft({ ruleKey: "other" });
      expect(other.body.data!.versionNo).toBe(1);
    });

    test("a draft is editable; a published one is immutable (409), also against the database", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;

      const edited = await put(
        rule.id,
        editBody({
          name: "Renamed",
          rate: "3",
          minAmount: "1",
          maxAmount: "50.5"
        })
      );
      expect(edited.status).toBe(200);
      expect(edited.body.data).toMatchObject({
        name: "Renamed",
        rate: "3",
        minAmount: "1",
        maxAmount: "50.5"
      });

      const published = await publish(rule.id);
      expect(published.status).toBe(200);
      expect(published.body.data!.status).toBe("published");
      expect(published.body.data!.publishedAt).toBeTruthy();

      const refused = await put(rule.id, editBody({ name: "Nope" }));
      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("RULE_NOT_DRAFT");
      expect((await getOne(rule.id)).body.data!.name).toBe("Renamed");

      // Bypassing the application: the trigger refuses as well.
      let message = "";
      try {
        await admin()`
          UPDATE awcms_hr_commission_rules SET rate = 99 WHERE id = ${rule.id}
        `;
      } catch (error) {
        message = String((error as Error).message);
      }
      expect(message).toMatch(/immutable/);
    });

    test("a rule key cannot be changed by an edit", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const response = await put(rule.id, { ...editBody(), ruleKey: "other" });

      expect(response.status).toBe(400);
    });

    test("publishing an overlapping window is 409 naming the version; a touching window publishes", async () => {
      if (!handlerReady) return;
      const v1 = (await draft({ effectiveTo: "2026-07-01" })).body.data!;
      expect((await publish(v1.id)).status).toBe(200);

      const overlapping = (await draft({ effectiveFrom: "2026-06-01" })).body
        .data!;
      const refused = await publish(overlapping.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("RULE_WINDOW_OVERLAP");
      expect(refused.body.error!.message).toContain("version 1");
      expect((await getOne(overlapping.id)).body.data!.status).toBe("draft");

      const touching = (await draft({ effectiveFrom: "2026-07-01" })).body
        .data!;
      expect((await publish(touching.id)).status).toBe(200);
    });

    test("only a draft can be published", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      await publish(rule.id);

      const again = await publish(rule.id);
      expect(again.status).toBe(409);
      expect(again.body.error!.code).toBe("RULE_NOT_DRAFT");

      expect((await publish(crypto.randomUUID())).status).toBe(404);
    });

    test("retire: a draft is abandoned, a published version stops applying and frees its window; retired is terminal", async () => {
      if (!handlerReady) return;
      const abandoned = (await draft({ ruleKey: "abandon" })).body.data!;
      const gone = await retire(abandoned.id);
      expect(gone.status).toBe(200);
      expect(gone.body.data).toMatchObject({ status: "retired" });
      expect(gone.body.data!.retiredAt).toBeTruthy();

      const rule = (await draft()).body.data!;
      await publish(rule.id);
      expect((await retire(rule.id)).status).toBe(200);

      const replacement = (await draft()).body.data!;
      expect((await publish(replacement.id)).status).toBe(200);

      const again = await retire(rule.id);
      expect(again.status).toBe(409);
      expect(again.body.error!.code).toBe("RULE_ALREADY_RETIRED");

      const edit = await put(rule.id, editBody());
      expect(edit.status).toBe(409);
      expect((await publish(rule.id)).status).toBe(409);
    });

    test("list filters by key and status and paginates newest first", async () => {
      if (!handlerReady) return;
      for (let i = 0; i < 3; i += 1) {
        await draft({ ruleKey: i === 2 ? "second" : "first" });
      }
      const all = await call<{ rules: Rule[]; nextCursor: string | null }>(
        listRules,
        { path: "/api/v1/hr-commission/rules" }
      );

      expect(all.body.data!.rules).toHaveLength(3);
      expect(all.body.data!.nextCursor).toBeNull();
      expect(all.body.data!.rules[0]!.ruleKey).toBe("second");

      const first = await call<{ rules: Rule[] }>(listRules, {
        path: "/api/v1/hr-commission/rules",
        query: "ruleKey=first&status=draft"
      });
      expect(first.body.data!.rules).toHaveLength(2);

      for (const query of ["status=bogus", "ruleKey=Bad Key", "cursor=zzz"]) {
        expect(
          (
            await call(listRules, {
              path: "/api/v1/hr-commission/rules",
              query
            })
          ).status
        ).toBe(400);
      }
    });

    test("a rule in another tenant is invisible (404 for the owner of a different tenant)", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const otherTenant = (await admin()`
        INSERT INTO awcms_tenants (tenant_code, tenant_name)
        VALUES ('cm-other', 'CM Other') RETURNING id
      `) as { id: string }[];
      const stranger = await seedUser(
        otherTenant[0]!.id,
        "stranger",
        ALL_PERMISSIONS
      );

      const response = await call<Rule>(getRule, {
        path: `/api/v1/hr-commission/rules/${rule.id}`,
        params: { id: rule.id },
        token: stranger.token,
        tenantId: otherTenant[0]!.id
      });

      expect([403, 404]).toContain(response.status);
      expect(response.body.data).toBeUndefined();
    });
  });

  describe("publish is bound to what the reviewer saw, and to a second person", () => {
    test("the author cannot publish; neither can the last editor; a third person can", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!; // created by the owner

      const byAuthor = await publish(rule.id, env.token);
      expect(byAuthor.status).toBe(403);
      expect(byAuthor.body.error!.code).toBe("PUBLISH_BY_AUTHOR_FORBIDDEN");

      // The second person edits it, which makes THEM the last editor.
      const edit = await put(
        rule.id,
        editBody({ name: "Edited by checker" }),
        publisherToken
      );
      expect(edit.status).toBe(200);

      const byEditor = await publish(rule.id, publisherToken);
      expect(byEditor.status).toBe(403);
      expect(byEditor.body.error!.code).toBe("PUBLISH_BY_AUTHOR_FORBIDDEN");
      expect((await getOne(rule.id)).body.data!.status).toBe("draft");

      const third = await seedUser(env.tenantId, "third", ALL_PERMISSIONS);
      const done = await publish(rule.id, third.token);
      expect(done.status).toBe(200);
      expect(done.body.data!.status).toBe("published");
    });

    test("publish without the digest is a 400; with a stale one it is 409 RULE_CHANGED and writes nothing", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const seen = rule.contentDigest;

      const none = await call(publishRule, {
        method: "POST",
        path: `/api/v1/hr-commission/rules/${rule.id}/publish`,
        params: { id: rule.id },
        body: {},
        token: publisherToken
      });
      expect(none.status).toBe(400);

      // The maker edits AFTER the reviewer looked.
      const edited = await put(rule.id, editBody({ rate: "9" }));
      expect(edited.body.data!.contentDigest).not.toBe(seen);

      const stale = await publish(rule.id, undefined, undefined, seen);
      expect(stale.status).toBe(409);
      expect(stale.body.error!.code).toBe("RULE_CHANGED");
      expect((await getOne(rule.id)).body.data!.status).toBe("draft");

      const fresh = await publish(
        rule.id,
        undefined,
        undefined,
        edited.body.data!.contentDigest
      );
      expect(fresh.status).toBe(200);
    });

    test("an edit made on a stale view is 409 RULE_CHANGED, not a silent overwrite", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const seen = rule.contentDigest;

      expect(
        (await put(rule.id, editBody({ name: "First" }), publisherToken)).status
      ).toBe(200);

      const lost = await put(
        rule.id,
        editBody({ name: "Second" }),
        undefined,
        seen
      );
      expect(lost.status).toBe(409);
      expect(lost.body.error!.code).toBe("RULE_CHANGED");
      expect((await getOne(rule.id)).body.data!.name).toBe("First");

      // An edit without the digest is a 400.
      const missing = await call(updateRule, {
        method: "PUT",
        path: `/api/v1/hr-commission/rules/${rule.id}`,
        params: { id: rule.id },
        body: editBody()
      });
      expect(missing.status).toBe(400);
    });

    test("a no-op replace does not move the digest", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const same = await put(rule.id, editBody());

      expect(same.status).toBe(200);
      expect(same.body.data!.contentDigest).toBe(rule.contentDigest);
    });

    test("the publish audit row carries the content digest of what was published", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const published = await publish(rule.id);

      const rows = (await admin()`
        SELECT attributes::text AS attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_commission.rule.published'
      `) as { attributes: string }[];

      expect(JSON.parse(rows[0]!.attributes).contentDigest).toBe(
        published.body.data!.contentDigest
      );
    });
  });

  describe("validation", () => {
    test("money must be a string; a JSON number is a 400 and writes nothing", async () => {
      if (!handlerReady) return;
      const response = await draft({ rate: 2.5 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.error)).toContain("rate");
      expect(await count()).toBe(0);
    });

    test("status, version, stamps, employment and tier fields are refused", async () => {
      if (!handlerReady) return;

      for (const extra of [
        { status: "published" },
        { versionNo: 7 },
        { publishedAt: "2026-01-01T00:00:00Z" },
        { employmentId: crypto.randomUUID() },
        { tiers: [] }
      ]) {
        expect((await draft(extra)).status).toBe(400);
      }

      expect(await count()).toBe(0);
    });

    test("a missing Idempotency-Key is 400 on create, publish and retire", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;

      const noKey = await call(createRule, {
        method: "POST",
        path: "/api/v1/hr-commission/rules",
        body: RULE_BODY,
        idempotencyKey: null
      });
      expect(noKey.status).toBe(400);
      expect(noKey.body.error!.code).toBe("IDEMPOTENCY_REQUIRED");
      expect((await publish(rule.id, undefined, null)).status).toBe(400);
      expect((await retire(rule.id, undefined, null)).status).toBe(400);
    });

    test("a bad id is 400", async () => {
      if (!handlerReady) return;

      expect(
        (
          await call(getRule, {
            path: "/api/v1/hr-commission/rules/nope",
            params: { id: "nope" }
          })
        ).status
      ).toBe(400);
    });
  });

  describe("idempotency", () => {
    test("replaying a create returns the stored response and writes one row", async () => {
      if (!handlerReady) return;
      const key = nextKey();
      const body = { ...RULE_BODY };
      const first = await call<Rule>(createRule, {
        method: "POST",
        path: "/api/v1/hr-commission/rules",
        body,
        idempotencyKey: key
      });
      const replay = await call<Rule>(createRule, {
        method: "POST",
        path: "/api/v1/hr-commission/rules",
        body,
        idempotencyKey: key
      });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.data!.id).toBe(first.body.data!.id);
      expect(await count()).toBe(1);

      const conflict = await call(createRule, {
        method: "POST",
        path: "/api/v1/hr-commission/rules",
        body: { ...body, name: "Different" },
        idempotencyKey: key
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error!.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    test("replaying a publish returns the stored 200 instead of a 409, and audits once", async () => {
      if (!handlerReady) return;
      const rule = (await draft()).body.data!;
      const key = nextKey();
      const first = await publish(rule.id, undefined, key);
      const replay = await publish(rule.id, undefined, key);

      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body.data!.publishedAt).toBe(first.body.data!.publishedAt);

      const audits = (await admin()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_commission.rule.published'
      `) as { n: number }[];
      expect(audits[0]!.n).toBe(1);

      // The same key for a different rule is a conflict, not a replay.
      const other = (await draft({ ruleKey: "other" })).body.data!;
      const conflict = await publish(other.id, undefined, key);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error!.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  describe("audit", () => {
    test("rows say what happened to which version and carry no rate, amount or name", async () => {
      if (!handlerReady) return;
      const rule = (
        await draft({
          name: "Secret Scheme Name",
          rate: "7.77",
          maxAmount: "123456.78"
        })
      ).body.data!;
      await put(
        rule.id,
        editBody({ name: "Secret Scheme Name", rate: "8.88" })
      );
      await publish(rule.id);
      await retire(rule.id);

      const rows = (await admin()`
        SELECT action, severity, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND module_key = 'hr_commission'
        ORDER BY created_at
      `) as { action: string; severity: string; attributes: string | null }[];

      expect(rows.map((r) => r.action)).toEqual([
        "hr_commission.rule.created",
        "hr_commission.rule.updated",
        "hr_commission.rule.published",
        "hr_commission.rule.retired"
      ]);
      expect(rows[2]!.severity).toBe("warning");
      expect(rows[3]!.severity).toBe("warning");
      expect(JSON.parse(rows[2]!.attributes!)).toMatchObject({
        ruleKey: "upsell",
        versionNo: 1
      });

      const text = JSON.stringify(rows);

      for (const forbidden of ["Secret Scheme", "7.77", "8.88", "123456"]) {
        expect(text).not.toContain(forbidden);
      }
    });
  });
});
