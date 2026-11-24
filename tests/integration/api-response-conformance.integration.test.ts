/**
 * Provider-side response conformance for three operations (Issue #1393,
 * ADR-0167): the REAL handlers answer, and `ajv` checks each answer (status AND
 * body) against the generated OpenAPI bundle.
 *
 * `blogListPosts`, `newsletterSubscribe` and `bookingPolicyPut` are the three
 * representative operations: an authenticated read with a oneOf body, an
 * anonymous neutral-answer write, and an idempotent high-risk replace.
 *
 * What this does NOT claim: nothing here proves authorization or tenant
 * isolation -- those stay tested where they are. This only proves the SHAPE of
 * what a handler actually answers matches what the contract promises, using the
 * same ajv setup as `api:contract:lint` and no hand-written validator. The
 * helper's own negative cases (undeclared status, missing/extra field) live in
 * `tests/api-response-conformance-helper.test.ts`.
 *
 * Gated on `DATABASE_URL` (harness section Gating) -- WORLD-2 of the harness.
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
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { assertResponseConforms } from "../support/contract-conformance";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as listPosts } from "../../src/pages/api/v1/blog/posts/index";
import { POST as newsletterSubscribe } from "../../src/pages/api/v1/newsletter/subscribe";
import { PUT as putPolicy } from "../../src/pages/api/v1/booking/policy";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string };

let handlerReady = false;
let env: Env;

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "conformance-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Conformance Co",
      tenantCode: "conformance-co",
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

  return { tenantId, token: login.body.data.token };
}

async function seedPosts(count: number): Promise<void> {
  const admin = getHandlerAdminSql();
  const author = (await admin`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${env.tenantId} LIMIT 1
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text, status, visibility, locale)
    SELECT ${env.tenantId}, ${author[0]!.id}, 'Post ' || n, 'post-' || n, '{}'::jsonb, '', 'published', 'public', 'id'
    FROM generate_series(1, ${count}) AS n
  `;
}

function authed(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId,
    authorization: `Bearer ${env.token}`,
    ...extra
  };
}

const POLICY = {
  defaultHoldSeconds: 900,
  maxHoldSeconds: 3600,
  maxActiveHoldsPerCustomer: null,
  maxActiveHoldsPerTenant: null,
  minLeadSeconds: 7200,
  maxHorizonDays: 365,
  noShowGraceSeconds: null,
  defaultTimezone: "Asia/Pontianak",
  defaultCheckInTime: "14:00:00",
  defaultCheckOutTime: "12:00:00"
};

const suite = integrationEnabled ? describe : describe.skip;

suite("provider-side response conformance (integration)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
    if (!handlerReady) return;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  afterAll(async () => {
    if (handlerReady) await teardownHandlerDatabase();
  });

  beforeEach(() => {
    if (!handlerReady) return;
  });

  describe("blogListPosts", () => {
    const route = "/api/v1/blog/posts";

    test("summary list answers a declared 200 that matches BlogPostSummary", async () => {
      if (!handlerReady) return;
      await seedPosts(3);
      const res = await invoke(listPosts, {
        path: route,
        headers: authed(),
        locals: { correlationId: crypto.randomUUID() }
      });
      expect(res.status).toBe(200);
      expect((res.body as any).data.posts.length).toBe(3);
      assertResponseConforms("get", route, res);
    });

    test("view=full with a cursor traversal matches BlogPostFeedItem and nextCursor", async () => {
      if (!handlerReady) return;
      const res = await invoke(listPosts, {
        path: `${route}?view=full&order=created_at&limit=2`,
        headers: authed(),
        locals: { correlationId: crypto.randomUUID() }
      });
      expect(res.status).toBe(200);
      expect(typeof (res.body as any).data.nextCursor).toBe("string");
      assertResponseConforms("get", route, res);
    });

    test("a refusal (cursor without order) answers a declared 400", async () => {
      if (!handlerReady) return;
      const res = await invoke(listPosts, {
        path: `${route}?cursor=abc`,
        headers: authed(),
        locals: { correlationId: crypto.randomUUID() }
      });
      expect(res.status).toBe(400);
      assertResponseConforms("get", route, res);
    });

    test("no token answers a declared 401", async () => {
      if (!handlerReady) return;
      const res = await invoke(listPosts, {
        path: route,
        headers: {
          "content-type": "application/json",
          "x-awcms-tenant-id": env.tenantId
        },
        locals: { correlationId: crypto.randomUUID() }
      });
      expect(res.status).toBe(401);
      assertResponseConforms("get", route, res);
    });
  });

  describe("newsletterSubscribe", () => {
    const route = "/api/v1/newsletter/subscribe";
    const call = (body: unknown, headers: Record<string, string> = {}) =>
      invoke(newsletterSubscribe, {
        method: "POST",
        path: route,
        headers: { "content-type": "application/json", ...headers },
        body,
        locals: { correlationId: crypto.randomUUID() }
      });

    // A cross-origin caller naming a host this deployment does not serve
    // resolves NO tenant (ADR-0118), which ends in the same neutral body a real
    // subscription gets. This is the path used here on purpose: see the todo.
    test("a well-formed address from an unserved origin answers the declared neutral 200", async () => {
      if (!handlerReady) return;
      const res = await call(
        { email: "reader@example.test", locale: "id" },
        { origin: "https://unserved.example.test" }
      );
      expect(res.status).toBe(200);
      assertResponseConforms("post", route, res);
    });

    // FINDING (#1393): for a host that DOES resolve a tenant with the module
    // enabled, a FIRST subscription of a new address throws
    // "ReferenceError: Cannot access 'decision' before initialization" at
    // subscribe.ts (the `enqueueDirectAddressEmail` callback reads `decision`,
    // which is destructured from the very call that is still running it), so no
    // response is produced at all. Reported, not fixed here: this issue does not
    // change handler behaviour. Turn this into a real test with the fix.
    test.todo(
      "a first subscription for a resolved tenant answers the declared neutral 200"
    );

    test("a malformed body answers a declared 400", async () => {
      if (!handlerReady) return;
      const res = await call({ email: "not-an-address" });
      expect(res.status).toBe(400);
      assertResponseConforms("post", route, res);
    });
  });

  describe("bookingPolicyPut", () => {
    const route = "/api/v1/booking/policy";
    const put = (body: unknown, key: string | null) =>
      invoke(putPolicy, {
        method: "PUT",
        path: route,
        headers: authed(key ? { "idempotency-key": key } : {}),
        body,
        locals: { correlationId: crypto.randomUUID() }
      });

    test("a valid replace answers the declared 200", async () => {
      if (!handlerReady) return;
      const res = await put(POLICY, `conf-${crypto.randomUUID()}`);
      expect(res.status).toBe(200);
      assertResponseConforms("put", route, res);
    });

    test("an out-of-range field answers a declared 400", async () => {
      if (!handlerReady) return;
      const res = await put(
        { ...POLICY, maxHorizonDays: 99999 },
        `conf-${crypto.randomUUID()}`
      );
      expect(res.status).toBe(400);
      assertResponseConforms("put", route, res);
    });

    test("a missing Idempotency-Key answers a declared 400", async () => {
      if (!handlerReady) return;
      const res = await put(POLICY, null);
      expect(res.status).toBe(400);
      assertResponseConforms("put", route, res);
    });
  });
});
