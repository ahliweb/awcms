import type { APIContext, APIRoute, AstroCookies } from "astro";

import { fail } from "./api-response";
import type { BusinessScopeHierarchyPort } from "./ports/business-scope-hierarchy-port";
import type { SoDRuleDescriptor } from "./module-contract";
import { hashSessionToken } from "../../lib/auth/session-token";
import { getDatabaseClient } from "../../lib/database/client";
import { withTenant } from "../../lib/database/tenant-context";
import type { WorkClass } from "../../lib/database/work-class";
import {
  authorizeInTransaction,
  resolveAuthInputs,
  type AuthorizeResult
} from "../identity-access/application/access-guard";
import type { AccessRequest } from "../identity-access/domain/access-control";

/**
 * `defineTenantRoute` (Issue #255) — the ONE place the auth/tenant opening that
 * 184 of 221 `src/pages/api` route files copy verbatim is written down:
 *
 * ```
 * resolveAuthInputs → tenantId? (400 TENANT_REQUIRED) → token? (401 AUTH_REQUIRED)
 *   → getDatabaseClient → hashSessionToken → withTenant(workClass)
 *   → authorizeInTransaction → short-circuit auth.denied → handler
 * ```
 *
 * Ported from awcms-micro's `_shared/tenant-route.ts`, adapted where this
 * repo's `withTenant` differs (see "One difference from micro" below).
 *
 * ## Why a factory and not "just a helper"
 *
 * Because the copy was already wrong in four places and nothing noticed.
 * `/api/v1/reports/{module-usage,access-audit,sync-health,tenant-activity}.ts`
 * hand-rolled the chain and called `evaluateAccess` with **three arguments of
 * five**, so those endpoints skipped `resolveModuleEnabled` (a tenant that
 * disabled `reporting` was still served) and skipped dynamic ABAC policies (a
 * `deny` authored through `/api/v1/access/policies` was silently inert).
 *
 * Copy-paste was the only enforcement mechanism there was. It worked 184 times
 * and failed 4, and no type, gate or reviewer could tell the difference from a
 * diff. Everything below is stated once so the NEXT invariant does not have to
 * be copied 293 times.
 *
 * ## `workClass` is REQUIRED, deliberately
 *
 * `withTenant`'s own `workClass` is optional and defaults to `"interactive"`.
 * Measured over `src/pages/api` at the time of writing: **176 of the 204 route
 * files** that call `withTenant` directly pass no work class at all. Only 28 do
 * (19 `interactive`, 7 `background_sync`, 6 `reporting`). So 176 routes share
 * login's pool budget because nobody passed the argument, not because anybody
 * decided.
 *
 * Here it has no default: omitting it is a compile error. Re-affirming
 * `"interactive"` is a perfectly good answer; leaving it unsaid is not.
 *
 * Do NOT cite `docs/awcms/work-class-registry.generated.json` for this. That
 * file is a copied awcms-mini artifact — its own `_disclaimer` says so, listing
 * ghost routes and a route count that was already wrong. There is no generator
 * and no freshness gate behind it in this repo, so it can only rot.
 *
 * ## One difference from micro: no `unavailableBehavior`
 *
 * micro's factory pins `unavailableBehavior: "response"` because its
 * `withTenant` can be told to throw instead. This repo's cannot — `withTenant`
 * ALWAYS returns the 503 `DATABASE_BUSY` `Response`, cast to the caller's `T`
 * (see its header: "type-safe in practice, even though the generic signature
 * doesn't statically enforce `T = Response`").
 *
 * For a route that is exactly right, and pinning `withTenant<Response>` below
 * makes the assumption explicit rather than inferred. For NON-`Response`
 * callers it is a live hazard in this repo, which is why
 * `layouts/AdminLayout.astro` shape-checks the result instead of trusting it.
 * Nothing here fixes that; a route is simply never the caller that suffers it.
 */

/** Everything available BEFORE the transaction opens. */
export type TenantRouteRequestContext = {
  request: Request;
  cookies: AstroCookies;
  url: URL;
  params: APIContext["params"];
  locals: APIContext["locals"];
  /** Already validated non-null (a missing one produced `400 TENANT_REQUIRED`). */
  tenantId: string;
  /**
   * The adapter's view of the peer address, forwarded verbatim. Pass it to
   * `resolveClientIp` — which decides whether `x-forwarded-for` may override it
   * — rather than trusting either source directly.
   */
  clientAddress: string | undefined;
  /** One clock for the whole request — the same instant the guard chain sees. */
  now: Date;
};

/** The `allowed: true` half of {@link AuthorizeResult}, so `auth.context.tenantUserId` reads exactly as in a hand-written route. */
export type AuthorizedAccess = Extract<AuthorizeResult, { allowed: true }>;

export type TenantRouteHandlerContext<TPrepared> = TenantRouteRequestContext & {
  /**
   * The tenant transaction, with `app.current_tenant_id` already set.
   *
   * `tx` is ONE reserved connection. Never run two queries on it concurrently
   * — no `Promise.all([queryA(tx), queryB(tx)])` and no
   * `Promise.all(items.map((item) => query(tx, item)))`. Concurrent queries on
   * one connection desync it, the transaction never commits, and the session
   * is stranded holding its work-class slot. `await` in sequence, or use a
   * plain `for` loop.
   */
  tx: Bun.TransactionSQL;
  /** Already narrowed to allowed — a deny was returned before `handler` ran. */
  auth: AuthorizedAccess;
  /** Whatever `prepare` returned (`undefined` when there is no `prepare`). */
  prepared: TPrepared;
};

export type TenantRouteConfig<TPrepared> = {
  /**
   * REQUIRED — no default. See this file's header: the whole point is that an
   * implicit `"interactive"` becomes a written, reviewable classification.
   */
  workClass: WorkClass;
  /** Forwarded verbatim to `withTenant` (which defaults to its own 2000ms). */
  queueTimeoutMs?: number;
  /**
   * The guard. A plain `AccessRequest` for the usual static case, or a function
   * when it depends on what `prepare` parsed (e.g. an action that differs by
   * request body).
   *
   * INFERENCE ORDER, when using the callback form: write `prepare` BEFORE
   * `authorize` in the object literal. TypeScript infers `TPrepared` from
   * object-literal properties in source order, so an unannotated `authorize`
   * callback appearing first pins `TPrepared` to its `undefined` default before
   * `prepare` is looked at. The symptom is a confusing "`prepare` is not
   * assignable to ..." error, not a silent wrong type.
   */
  authorize:
    | AccessRequest
    | ((
        context: TenantRouteRequestContext & { prepared: TPrepared }
      ) => AccessRequest);
  /** Forwarded verbatim to `authorizeInTransaction`. */
  authorizeOptions?: {
    hierarchyPort?: BusinessScopeHierarchyPort;
    sodRules?: readonly SoDRuleDescriptor[];
  };
  /**
   * Runs AFTER the tenant/token checks and BEFORE any database work — the slot
   * for everything hand-written routes do between the 401 guard and
   * `withTenant`: body parsing, query-parameter validation, cursor decoding,
   * `Idempotency-Key` handling. Returning a `Response` short-circuits with it,
   * so a malformed request still costs no connection and no pool slot;
   * returning anything else hands that value to `handler` as `prepared`.
   */
  prepare?: (
    context: TenantRouteRequestContext
  ) => TPrepared | Response | Promise<TPrepared | Response>;
  /** Runs inside the tenant transaction, only when access was ALLOWED. */
  handler: (
    context: TenantRouteHandlerContext<TPrepared>
  ) => Response | Promise<Response>;
};

/**
 * SELF-SERVICE variant: an authenticated route whose subject is the CALLER
 * itself, so there is no permission to check (ADR-0049 §7 —
 * `GET /api/v1/auth/session` is the first user).
 *
 * ## Why this is a seam and not an exception
 *
 * `defineTenantRoute` demands an `AccessRequest`. A self-service endpoint has
 * none: "may I read my own session?" is answered by holding the session, not by
 * a permission. Naming an invented permission there would be the latent-authz
 * trap this repo has already hit more than once — an action nothing seeds
 * denies even the tenant owner while the calling code looks correct.
 *
 * What it does NOT drop is the rest: `workClass` stays required, the tenant
 * transaction is still opened in one place, and the route file still contains
 * no `withTenant` call of its own — so `api:tenant-route:check` stays
 * one-directional instead of growing a second allowlist.
 *
 * Response shaping stays with the route via `onUnauthenticated`, because the
 * endpoints in this class are exactly the ones with deliberate anti-oracle
 * requirements (one response shape for several different failures) that a
 * shared default would quietly flatten.
 */
export type SelfServiceTenantRouteConfig = {
  /** REQUIRED, same reasoning as `defineTenantRoute`. */
  workClass: WorkClass;
  queueTimeoutMs?: number;
  /**
   * Called when no tenant could be resolved (`"tenant"`) or no bearer was
   * presented (`"token"`). The route decides the status/body/headers.
   */
  onUnauthenticated: (reason: "tenant" | "token") => Response;
  /**
   * Runs BEFORE any database work — rate limiting, header checks. Returning a
   * `Response` short-circuits with it, so a refused request costs no connection.
   */
  beforeTransaction?: (
    context: TenantRouteRequestContext & { token: string }
  ) => Response | undefined | Promise<Response | undefined>;
  handler: (
    context: TenantRouteRequestContext & {
      tx: Bun.TransactionSQL;
      token: string;
      /** Kind-tagged hash (`session-token.ts`) — machine vs session already distinguished. */
      tokenHash: string;
    }
  ) => Response | Promise<Response>;
};

export function defineSelfServiceTenantRoute(
  config: SelfServiceTenantRouteConfig
): APIRoute {
  return async ({ request, cookies, url, params, locals, clientAddress }) => {
    const { tenantId, token } = resolveAuthInputs(request, cookies);

    if (!token) return config.onUnauthenticated("token");
    if (!tenantId) return config.onUnauthenticated("tenant");

    const requestContext: TenantRouteRequestContext = {
      request,
      cookies,
      url,
      params,
      locals,
      tenantId,
      clientAddress,
      now: new Date()
    };

    const short = await config.beforeTransaction?.({
      ...requestContext,
      token
    });

    if (short) return short;

    return withTenant<Response>(
      sqlClientForRoute(),
      tenantId,
      async (tx) =>
        config.handler({
          ...requestContext,
          tx,
          token,
          tokenHash: hashSessionToken(token)
        }),
      {
        workClass: config.workClass,
        queueTimeoutMs: config.queueTimeoutMs
      }
    );
  };
}

/**
 * CLIENT-CREDENTIAL variant: an endpoint whose principal is a registered
 * server-side client, not a person and not a session (ADR-0050's
 * `POST /api/v1/auth/session-handoff/redeem` is the first user).
 *
 * ## Why this is a third seam and not an exception
 *
 * `defineTenantRoute` requires a session token; `defineSelfServiceTenantRoute`
 * requires one too and merely drops the permission. A redeem call has neither —
 * it is the request that OBTAINS a session, made server-to-server with a client
 * secret. Hand-rolling `withTenant` there would be a new entry on
 * `api:tenant-route:check`'s allowlist, and that list is a debt ledger that may
 * only shrink.
 *
 * What it does NOT drop: `workClass` stays required, the tenant transaction is
 * still opened in one place, and the route file still contains no `withTenant`
 * call of its own.
 *
 * Authentication is the ROUTE's job, inside `handler`. This factory
 * deliberately does not parse a secret or look a client up: those are
 * credential comparisons whose failure shape (one generic answer, never an
 * oracle for which client keys exist) belongs with the endpoint that knows what
 * it is authenticating, not in a shared default that would flatten it.
 */
export type ClientCredentialTenantRouteConfig = {
  /** REQUIRED, same reasoning as `defineTenantRoute`. */
  workClass: WorkClass;
  queueTimeoutMs?: number;
  /** Called when no tenant could be resolved. The route decides the response. */
  onMissingTenant: () => Response;
  /**
   * Runs BEFORE any database work — body parsing, rate limiting. Returning a
   * `Response` short-circuits, so a malformed request costs no connection.
   */
  beforeTransaction?: (
    context: TenantRouteRequestContext
  ) => Response | undefined | Promise<Response | undefined>;
  handler: (
    context: TenantRouteRequestContext & { tx: Bun.TransactionSQL }
  ) => Response | Promise<Response>;
};

export function defineClientCredentialTenantRoute(
  config: ClientCredentialTenantRouteConfig
): APIRoute {
  return async ({ request, cookies, url, params, locals, clientAddress }) => {
    const { tenantId } = resolveAuthInputs(request, cookies);

    if (!tenantId) return config.onMissingTenant();

    const requestContext: TenantRouteRequestContext = {
      request,
      cookies,
      url,
      params,
      locals,
      tenantId,
      clientAddress,
      now: new Date()
    };

    const short = await config.beforeTransaction?.(requestContext);

    if (short) return short;

    return withTenant<Response>(
      sqlClientForRoute(),
      tenantId,
      async (tx) => config.handler({ ...requestContext, tx }),
      {
        workClass: config.workClass,
        queueTimeoutMs: config.queueTimeoutMs
      }
    );
  };
}

/** One place every factory reaches the pool, so none can drift onto its own client. */
function sqlClientForRoute(): Bun.SQL {
  return getDatabaseClient();
}

export function defineTenantRoute<TPrepared = undefined>(
  config: TenantRouteConfig<TPrepared>
): APIRoute {
  return async ({ request, cookies, url, params, locals, clientAddress }) => {
    const { tenantId, token } = resolveAuthInputs(request, cookies);

    if (!tenantId) {
      return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
    }

    if (!token) {
      return fail(401, "AUTH_REQUIRED", "Authentication required.");
    }

    const requestContext: TenantRouteRequestContext = {
      request,
      cookies,
      url,
      params,
      locals,
      tenantId,
      clientAddress,
      now: new Date()
    };

    let prepared = undefined as TPrepared;

    if (config.prepare) {
      const prepareResult = await config.prepare(requestContext);

      if (prepareResult instanceof Response) {
        return prepareResult;
      }

      prepared = prepareResult;
    }

    const guard =
      typeof config.authorize === "function"
        ? config.authorize({ ...requestContext, prepared })
        : config.authorize;

    const sql = getDatabaseClient();
    const tokenHash = hashSessionToken(token);

    // `withTenant<Response>` — pinned, not inferred. This repo's `withTenant`
    // returns its 503 `DATABASE_BUSY` cast to `T` on breaker-open / queue-full,
    // so `T = Response` is the assumption that makes that correct. Stated here
    // so a future edit has to break it on purpose.
    return withTenant<Response>(
      sql,
      tenantId,
      async (tx) => {
        const auth = await authorizeInTransaction(
          tx,
          tenantId,
          tokenHash,
          requestContext.now,
          guard,
          config.authorizeOptions
        );

        if (!auth.allowed) {
          return auth.denied;
        }

        return config.handler({ ...requestContext, tx, auth, prepared });
      },
      {
        workClass: config.workClass,
        queueTimeoutMs: config.queueTimeoutMs
      }
    );
  };
}
