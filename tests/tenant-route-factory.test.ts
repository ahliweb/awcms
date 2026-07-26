/**
 * `defineTenantRoute` runs the opening in order and short-circuits at every
 * point a hand-written route does.
 *
 * ## Why there are no module mocks here
 *
 * The first version of this file mocked `tenant-context`, `client`,
 * `session-token` and `access-guard` through `mock.module`, and restored them
 * with `mock.restore()`. It passed locally and turned CI red in twelve places:
 * `mock.restore()` does NOT undo `mock.module`, so the fake `withTenant` leaked
 * into every later file in the process. `tests/tenant-context-circuit-breaker.
 * test.ts` asked for a 503 and got the fake's 200.
 *
 * It passed locally only because `tenant-context-circuit-breaker` sorts before
 * `tenant-route-factory` on this filesystem and had already run. That is luck,
 * not isolation — and a test whose correctness depends on readdir order is not
 * a test.
 *
 * So: real modules throughout, following awcms-micro's own factory test. The
 * circuit breaker is forced OPEN, which makes `withTenant` return its 503
 * before it ever calls `sql.begin` — every assertion below therefore exercises
 * the genuine `withTenant`, the genuine `resolveAuthInputs`, and the genuine
 * pool gate, and no connection is ever opened.
 *
 * ## What this deliberately does NOT cover
 *
 * The allowed path — handler running inside a real transaction with a resolved
 * `auth.context`. That needs a session row, a permission grant and a database;
 * faking it is what produced the leak above. It belongs in the DB-gated suite,
 * and the four migrated `/api/v1/reports/*` routes are covered there through
 * their own endpoints.
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
import type { APIContext, APIRoute, AstroCookies } from "astro";

import {
  getDatabaseCircuitBreaker,
  resetDatabaseCircuitBreakerForTests
} from "../src/lib/database/circuit-breaker";
import {
  acquireWorkClassSlot,
  resetWorkClassGatesForTests,
  type WorkClassSlot
} from "../src/lib/database/work-class";
import { defineTenantRoute } from "../src/modules/_shared/tenant-route";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const GUARD = {
  moduleKey: "reporting",
  activityCode: "dashboard",
  action: "read"
} as const;

/** `resolveAuthInputs` only ever reads `cookies.get(name)?.value`. */
const EMPTY_COOKIES = { get: () => undefined } as unknown as AstroCookies;

async function call(
  route: APIRoute,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  body: { error?: { code: string } };
  response: Response;
}> {
  const url = new URL("http://unit.test/api/v1/reports/module-usage?x=1");
  const response = (await route({
    request: new Request(url.toString(), { method: "GET", headers }),
    url,
    params: {},
    locals: {},
    cookies: EMPTY_COOKIES
  } as unknown as APIContext)) as Response;
  const text = await response.text();

  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : {},
    response
  };
}

function authHeaders(): Record<string, string> {
  return {
    "x-awcms-tenant-id": TENANT_ID,
    authorization: "Bearer unit-test-session-token"
  };
}

/**
 * The factory calls `getDatabaseClient()` before `withTenant`, and that needs a
 * connection string to exist even though nothing ever connects (an open breaker
 * short-circuits inside `withTenant`, before `sql.begin`).
 *
 * Only set when absent: a run WITH a real `DATABASE_URL` must keep using it,
 * because the client is memoized per process — overwriting it here would hand a
 * dead client to every later test in the run.
 */
const HAD_DATABASE_URL = Boolean(process.env.DATABASE_URL);

/** Forces `withTenant` to return 503 before touching the connection. */
function openTheBreaker(): void {
  const breaker = getDatabaseCircuitBreaker();

  for (let attempt = 0; attempt < 20; attempt++) {
    breaker.recordFailure(new Date());
  }

  expect(breaker.canAttempt(new Date())).toBe(false);
}

beforeAll(() => {
  if (!HAD_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgres://unit:unit@127.0.0.1:1/unit-test-never-connected";
  }
});

afterAll(() => {
  if (!HAD_DATABASE_URL) {
    delete process.env.DATABASE_URL;
  }
});

beforeEach(() => {
  resetDatabaseCircuitBreakerForTests();
  resetWorkClassGatesForTests();
});

afterEach(() => {
  resetDatabaseCircuitBreakerForTests();
  resetWorkClassGatesForTests();
});

describe("defineTenantRoute — the opening it replaces", () => {
  test("a missing tenant header is 400 TENANT_REQUIRED", async () => {
    let reached = false;

    const result = await call(
      defineTenantRoute({
        workClass: "interactive",
        authorize: GUARD,
        handler: async () => {
          reached = true;
          return new Response("unreachable");
        }
      }),
      { authorization: "Bearer t" }
    );

    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("TENANT_REQUIRED");
    expect(reached).toBe(false);
  });

  test("a missing token is 401 AUTH_REQUIRED", async () => {
    const result = await call(
      defineTenantRoute({
        workClass: "interactive",
        authorize: GUARD,
        handler: async () => new Response("unreachable")
      }),
      { "x-awcms-tenant-id": TENANT_ID }
    );

    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("AUTH_REQUIRED");
  });

  test("both guards run before anything else — an unauthenticated call never reaches the pool", async () => {
    // Proven by the breaker: it is OPEN, so ANY call that got as far as
    // `withTenant` would come back 503. A 401 therefore means the request
    // stopped earlier — which is the property that keeps unauthenticated
    // traffic off the connection pool entirely.
    openTheBreaker();

    const result = await call(
      defineTenantRoute({
        workClass: "interactive",
        authorize: GUARD,
        handler: async () => new Response("unreachable")
      })
    );

    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("TENANT_REQUIRED");
  });
});

describe("defineTenantRoute — prepare runs before any database work", () => {
  test("a Response from prepare short-circuits with that exact response", async () => {
    openTheBreaker();
    let authorizeCalled = false;

    const result = await call(
      defineTenantRoute<{ parsed: string }>({
        workClass: "interactive",
        prepare: () =>
          new Response(
            JSON.stringify({ error: { code: "VALIDATION_ERROR" } }),
            {
              status: 400
            }
          ),
        authorize: () => {
          authorizeCalled = true;
          return GUARD;
        },
        handler: async () => new Response("unreachable")
      }),
      authHeaders()
    );

    // 400, not the 503 an open breaker would produce: `prepare` short-circuited
    // before the pool was ever consulted. That ordering is the whole point — a
    // malformed body must not cost a connection.
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("VALIDATION_ERROR");
    expect(authorizeCalled).toBe(false);
  });

  test("prepare's value reaches the authorize callback", async () => {
    openTheBreaker();
    let seen: unknown;

    const result = await call(
      defineTenantRoute<{ action: "read" | "update" }>({
        workClass: "interactive",
        prepare: () => ({ action: "update" as const }),
        authorize: ({ prepared }) => {
          seen = prepared;
          return { ...GUARD, action: prepared.action };
        },
        handler: async () => new Response("unreachable")
      }),
      authHeaders()
    );

    expect(seen).toEqual({ action: "update" });
    // The guard was built, then the open breaker stopped the request at the
    // pool — the furthest a test can go here without a database.
    expect(result.status).toBe(503);
  });
});

describe("defineTenantRoute — the declared work class is really used", () => {
  test("an open breaker yields 503 DATABASE_BUSY with Retry-After: 30", async () => {
    openTheBreaker();

    const result = await call(
      defineTenantRoute({
        workClass: "reporting",
        authorize: GUARD,
        handler: async () => new Response("unreachable")
      }),
      authHeaders()
    );

    expect(result.status).toBe(503);
    expect(result.body.error?.code).toBe("DATABASE_BUSY");
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });

  test("the declared class picks the gate: a saturated `maintenance` stops a `maintenance` route at the pool", async () => {
    // Breaker CLOSED here, deliberately. `withTenant` checks the breaker
    // BEFORE the work-class gate, so an open breaker returns Retry-After 30 for
    // every class and would make this assertion pass no matter what `workClass`
    // said — the first draft of this test did exactly that and proved nothing.
    //
    // With the breaker closed and `maintenance`'s only slot (concurrency 1)
    // held, a route that DECLARED `maintenance` fails at the gate with the
    // work-class Retry-After of 2. Delete `workClass` from the route below and
    // it defaults to `interactive`, whose gate is wide open — a different
    // outcome entirely. That is what makes this a test of forwarding rather
    // than a test of "some 503 happened".
    let held: WorkClassSlot | undefined;

    try {
      held = await acquireWorkClassSlot("maintenance", 50);

      const result = await call(
        defineTenantRoute({
          workClass: "maintenance",
          queueTimeoutMs: 20,
          authorize: GUARD,
          handler: async () => new Response("unreachable")
        }),
        authHeaders()
      );

      expect(result.status).toBe(503);
      expect(result.body.error?.code).toBe("DATABASE_BUSY");
      expect(result.response.headers.get("Retry-After")).toBe("2");
    } finally {
      held?.release();
    }
  });
});
