/**
 * `defineTenantRoute` carries the whole opening, in order, and short-circuits
 * at every point a hand-written route does.
 *
 * ## What this replaces
 *
 * Nothing — that is the point. The opening it encapsulates was copied into 204
 * route files and had no test anywhere, because there was no single thing to
 * test. Its correctness was asserted only indirectly, by whichever integration
 * test happened to exercise a route that had copied it correctly.
 *
 * Four routes had copied it INcorrectly (`/api/v1/reports/*`, Issue #255) and
 * every integration test still passed, because each one asserted its own
 * route's happy path and none asserted the chain.
 *
 * ## No database
 *
 * The factory's job is sequencing and short-circuiting: which checks run,
 * in what order, and what stops the request. Every collaborator is injected
 * through `mock.module`, so a fake can record the call order and a fake can
 * refuse. The real guard chain has its own DB-backed integration tests; what
 * has never been covered is the wiring between them.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

const GUARD = {
  moduleKey: "reporting",
  activityCode: "dashboard",
  action: "read" as const
};

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Calls = string[];

/**
 * Rebuilds the module graph per test with the given fakes.
 *
 * `mock.module` mutates the LIVE namespace for the whole process, so the
 * factory is re-imported after each set of mocks is installed and the mocks are
 * restored in `afterEach`. Without the restore, a later test file importing
 * `tenant-route.ts` would silently get this file's fakes.
 */
async function loadFactory(options: {
  calls: Calls;
  authInputs?: { tenantId: string | null; token: string | null };
  authorize?: (guard: unknown) => unknown;
}) {
  const { calls } = options;

  mock.module(
    "../src/modules/identity-access/application/access-guard",
    () => ({
      resolveAuthInputs: () => {
        calls.push("resolveAuthInputs");
        return options.authInputs ?? { tenantId: TENANT, token: "tok" };
      },
      authorizeInTransaction: async (
        _tx: unknown,
        _tenantId: string,
        _tokenHash: string,
        _now: Date,
        guard: unknown
      ) => {
        calls.push("authorizeInTransaction");
        return (
          options.authorize?.(guard) ?? {
            allowed: true,
            context: { tenantUserId: "user-1" },
            grantedPermissionKeys: new Set<string>()
          }
        );
      }
    })
  );

  mock.module("../src/lib/auth/session-token", () => ({
    hashSessionToken: () => {
      calls.push("hashSessionToken");
      return "hash";
    }
  }));

  mock.module("../src/lib/database/client", () => ({
    getDatabaseClient: () => {
      calls.push("getDatabaseClient");
      return {} as Bun.SQL;
    }
  }));

  mock.module("../src/lib/database/tenant-context", () => ({
    withTenant: async (
      _sql: unknown,
      _tenantId: string,
      fn: (tx: unknown) => Promise<Response>,
      opts?: { workClass?: string; queueTimeoutMs?: number }
    ) => {
      calls.push(`withTenant:${opts?.workClass}:${opts?.queueTimeoutMs}`);
      return fn({} as Bun.TransactionSQL);
    }
  }));

  return (await import("../src/modules/_shared/tenant-route"))
    .defineTenantRoute;
}

function invoke(route: ReturnType<Awaited<ReturnType<typeof loadFactory>>>) {
  return route({
    request: new Request("https://example.test/api/v1/reports/module-usage"),
    cookies: {} as never,
    url: new URL("https://example.test/api/v1/reports/module-usage"),
    params: {},
    locals: {}
  } as never) as Promise<Response>;
}

afterEach(() => {
  mock.restore();
});

describe("defineTenantRoute sequencing", () => {
  test("runs the opening in order and hands the handler an allowed auth", async () => {
    const calls: Calls = [];
    const defineTenantRoute = await loadFactory({ calls });

    const route = defineTenantRoute({
      workClass: "reporting",
      authorize: GUARD,
      handler: async ({ auth, tenantId, tx }) => {
        calls.push("handler");
        expect(auth.allowed).toBe(true);
        expect(auth.context.tenantUserId).toBe("user-1");
        expect(tenantId).toBe(TENANT);
        expect(tx).toBeDefined();
        return new Response("ok", { status: 200 });
      }
    });

    const response = await invoke(route);

    expect(response.status).toBe(200);
    // The order IS the contract: no connection is taken before the token
    // check, and the guard always runs before the handler.
    expect(calls).toEqual([
      "resolveAuthInputs",
      "getDatabaseClient",
      "hashSessionToken",
      "withTenant:reporting:undefined",
      "authorizeInTransaction",
      "handler"
    ]);
  });

  test("a missing tenant is 400 and never touches the database", async () => {
    const calls: Calls = [];
    const defineTenantRoute = await loadFactory({
      calls,
      authInputs: { tenantId: null, token: "tok" }
    });

    const response = await invoke(
      defineTenantRoute({
        workClass: "interactive",
        authorize: GUARD,
        handler: async () => {
          calls.push("handler");
          return new Response("unreachable");
        }
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "TENANT_REQUIRED" }
    });
    expect(calls).toEqual(["resolveAuthInputs"]);
  });

  test("a missing token is 401 and never touches the database", async () => {
    const calls: Calls = [];
    const defineTenantRoute = await loadFactory({
      calls,
      authInputs: { tenantId: TENANT, token: null }
    });

    const response = await invoke(
      defineTenantRoute({
        workClass: "interactive",
        authorize: GUARD,
        handler: async () => new Response("unreachable")
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED" }
    });
    expect(calls).toEqual(["resolveAuthInputs"]);
  });

  test("a denied guard returns the guard's own response, handler never runs", async () => {
    const calls: Calls = [];
    const denied = new Response("denied", { status: 403 });
    const defineTenantRoute = await loadFactory({
      calls,
      authorize: () => ({ allowed: false, denied })
    });

    const response = await invoke(
      defineTenantRoute({
        workClass: "reporting",
        authorize: GUARD,
        handler: async () => {
          calls.push("handler");
          return new Response("unreachable");
        }
      })
    );

    // The SAME response object — the factory must not re-wrap or re-word a
    // denial, because `authorizeInTransaction` distinguishes 401 from 403 and
    // MODULE_DISABLED from ACCESS_DENIED, and that detail is load-bearing.
    expect(response).toBe(denied);
    expect(calls).not.toContain("handler");
  });
});

describe("defineTenantRoute prepare phase", () => {
  test("a Response from prepare short-circuits before any connection is taken", async () => {
    const calls: Calls = [];
    const defineTenantRoute = await loadFactory({ calls });

    const response = await invoke(
      defineTenantRoute<{ parsed: string }>({
        workClass: "interactive",
        prepare: () => {
          calls.push("prepare");
          return new Response("bad request", { status: 400 });
        },
        authorize: GUARD,
        handler: async () => {
          calls.push("handler");
          return new Response("unreachable");
        }
      })
    );

    expect(response.status).toBe(400);
    // The whole reason `prepare` runs before `getDatabaseClient`: a malformed
    // body must not cost a pool slot.
    expect(calls).toEqual(["resolveAuthInputs", "prepare"]);
  });

  test("prepare's value reaches the handler and the authorize callback", async () => {
    const calls: Calls = [];
    const defineTenantRoute = await loadFactory({ calls });
    let seenByAuthorize: unknown;

    const response = await invoke(
      defineTenantRoute<{ action: "read" | "update" }>({
        workClass: "interactive",
        prepare: () => ({ action: "update" as const }),
        authorize: ({ prepared }) => {
          seenByAuthorize = prepared;
          return { ...GUARD, action: prepared.action };
        },
        handler: async ({ prepared }) => {
          expect(prepared).toEqual({ action: "update" });
          return new Response("ok");
        }
      })
    );

    expect(response.status).toBe(200);
    expect(seenByAuthorize).toEqual({ action: "update" });
  });
});

describe("work class is a decision, not a default", () => {
  test("the declared work class reaches withTenant verbatim", async () => {
    for (const workClass of [
      "reporting",
      "maintenance",
      "interactive"
    ] as const) {
      const calls: Calls = [];
      const defineTenantRoute = await loadFactory({ calls });

      await invoke(
        defineTenantRoute({
          workClass,
          queueTimeoutMs: 1234,
          authorize: GUARD,
          handler: async () => new Response("ok")
        })
      );

      expect(calls).toContain(`withTenant:${workClass}:1234`);
      mock.restore();
    }
  });
});
