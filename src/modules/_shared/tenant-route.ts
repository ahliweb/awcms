import type { APIContext, APIRoute, AstroCookies } from "astro";

import { resolveClientIp } from "../../lib/security/rate-limit";

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
import { createAuthorizationReadCache } from "../identity-access/application/authorization-read-cache";
import type { AccessRequest } from "../identity-access/domain/access-control";
import {
  isSuspensionExemptTenant,
  isTenantServiceStopped
} from "../identity-access/domain/suspended-tenant-allowlist";
import { resolvePlatformTenantIdIgnoringStatus } from "../../lib/tenant/platform-tenant";
import { runSseLoop, type SseTickOutcome } from "./sse-stream";

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
  /**
   * Kind-tagged hash of the calling bearer (`session-token.ts`) — the same value
   * the seam handed `authorizeInTransaction`, exposed so a handler that needs to
   * recognise the CALLING session (rather than the calling person) does not
   * re-derive it from `request`/`cookies`. Two derivations of one value is how
   * they come to disagree.
   *
   * It is a hash of a live credential: compare it, never return it.
   */
  tokenHash: string;
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
   * The guard. A plain `AccessRequest` for the usual static case; an ARRAY for
   * "any one of these is enough"; or a function when the permission itself
   * depends on what `prepare` parsed (e.g. an action that differs by request
   * body).
   *
   * ## The array form — ANY-of, not the body-dependent kind
   *
   * Mirrors `loadAdminScreen`'s `authorize` (`lib/auth/admin-screen.ts`): allowed
   * when AT LEAST ONE listed request is allowed, each evaluated through the one
   * chokepoint (`authorizeInTransaction`, sharing one read cache so the session/
   * tenant-state reads are not repeated per candidate) and each writing its own
   * decision-log row. An EMPTY array denies — "no request authorizes this route"
   * must never read as "any request does".
   *
   * This exists for a route with no permission common to every shape it accepts
   * — Issue #794/PR #797's `PATCH /api/v1/media/objects/{id}`: a caller holding
   * ONLY `media.update` may submit a routine-fields body, a caller holding ONLY
   * `media.adjudicate_rights` may submit a status-only body, and neither
   * permission is required of every caller. Because the array does not depend on
   * `prepared`, it is evaluated EAGERLY like the plain-object form — see the next
   * paragraph for why that distinction is load-bearing — and the route's
   * `handler` still makes the FINAL, body-shape-specific `authorizeInTransaction`
   * call(s) that decide what a given request actually needed; this array only
   * answers "is it worth opening the handler at all".
   *
   * ## The function form CANNOT defer, and that is why it stays separate
   *
   * A callback receives `prepared` — the very thing `prepare` may have failed to
   * produce — so it can only run once body parsing already succeeded. The two
   * routes that need a body-dependent permission (`POST /api/v1/partners/:id/
   * status`, `POST /api/v1/access/machine-credentials`) accept that: see the
   * `heldPrepareRefusal` carve-out below, scoped to exactly those two by name. A
   * route whose permission choice depends on the body should reach for the array
   * form INSTEAD when the body-independent "does the caller hold any relevant
   * permission at all" question has a real answer (as media rights does); the
   * function form is for the narrower case where it does not.
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
    | readonly AccessRequest[]
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
export type SelfServiceTenantRouteConfig<TPrepared = undefined> = {
  /**
   * ADR-0073 — WHY this route stays reachable while the tenant is suspended.
   *
   * Omitting it refuses, which is the default a new route inherits and the
   * whole reason the field is shaped this way round. A REASON rather than a
   * boolean, for the reason `SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS` is a
   * code declaration: `true` can be added in a diff without anybody having to
   * say what it buys, and this list only stays short if each entry argues for
   * itself.
   *
   * The rule the current entries follow: a suspended tenant may still SEE its
   * own security state and may still do things that only ever REMOVE its own
   * access. Everything else is service, and suspension stops service.
   */
  allowedWhileTenantSuspended?: string;
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
  /**
   * Reads and validates the request BODY, before the transaction opens.
   *
   * The mirror of `defineTenantRoute`'s `prepare`, and it exists for the same
   * non-cosmetic reason: `await request.json()` waits on the CLIENT. Doing it
   * inside `withTenant` holds a reserved pool connection — and its work-class
   * slot — for as long as a caller chooses to take sending its body, which turns
   * a slow request into a connection held against every other request in the
   * pool. `queueTimeoutMs` bounds ACQUIRING a connection, never holding one.
   *
   * Returning a `Response` short-circuits; anything else is handed to `handler`
   * as `prepared`.
   *
   * `beforeTransaction` cannot do this job: it returns only `Response |
   * undefined`, so a body parsed there has nowhere to go and would have to be
   * parsed a second time.
   */
  prepare?: (
    context: TenantRouteRequestContext & { token: string }
  ) => TPrepared | Response | Promise<TPrepared | Response>;
  handler: (
    context: TenantRouteRequestContext & {
      tx: Bun.TransactionSQL;
      token: string;
      /** Kind-tagged hash (`session-token.ts`) — machine vs session already distinguished. */
      tokenHash: string;
      /** Whatever `prepare` returned (`undefined` when there is no `prepare`). */
      prepared: TPrepared;
    }
  ) => Response | Promise<Response>;
};

/**
 * ADR-0073 for the two factories that have no `AccessRequest` to consult.
 *
 * `authorizeInTransaction` refuses a suspended tenant before it looks up a
 * permission, and `ssr-session.ts` refuses one before it hands an admin screen a
 * session. Neither of those is on the path of a self-service or
 * client-credential route, so until this existed a suspended tenant's live
 * session could still write its profile, rewrite its credential, and — through
 * the handoff pair — mint NEW sessions indefinitely. The foothold outlived the
 * TTL that suspension was meant to drain, which is the one thing suspension is
 * for.
 *
 * ## One read, and only for the tenant that is already suspended
 *
 * `awcms_tenants` is the deliberately RLS-free root table (ADR-0003), so this is
 * a primary-key lookup with no policy work. The platform-tenant resolution —
 * which can cost a chain — sits behind the `&&`, so it runs only for a tenant
 * that is ALREADY refused. A healthy request pays one PK read.
 *
 * A missing row reads as stopped. That is unreachable behind a resolved tenant
 * id, and it is because it is unreachable that fail-closed costs nothing.
 */
async function refuseIfTenantSuspended(
  tx: Bun.SQL,
  tenantId: string,
  allowedWhileTenantSuspended: string | undefined
): Promise<Response | undefined> {
  if (allowedWhileTenantSuspended) return undefined;

  const rows = (await tx`
    SELECT status FROM awcms_tenants WHERE id = ${tenantId}
  `) as { status: string }[];

  const status = rows[0]?.status ?? "suspended";

  if (!isTenantServiceStopped(status)) return undefined;

  if (
    isSuspensionExemptTenant(
      tenantId,
      await resolvePlatformTenantIdIgnoringStatus(tx)
    )
  ) {
    return undefined;
  }

  return fail(403, "TENANT_SUSPENDED", "Tenant is suspended.");
}

export function defineSelfServiceTenantRoute<TPrepared = undefined>(
  config: SelfServiceTenantRouteConfig<TPrepared>
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

    let prepared = undefined as TPrepared;

    if (config.prepare) {
      const prepareResult = await config.prepare({ ...requestContext, token });

      if (prepareResult instanceof Response) {
        return prepareResult;
      }

      prepared = prepareResult;
    }

    return withTenant<Response>(
      sqlClientForRoute(),
      tenantId,
      async (tx) => {
        const suspended = await refuseIfTenantSuspended(
          tx,
          tenantId,
          config.allowedWhileTenantSuspended
        );

        if (suspended) return suspended;

        return config.handler({
          ...requestContext,
          tx,
          token,
          tokenHash: hashSessionToken(token),
          prepared
        });
      },
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
  /**
   * ADR-0073 — see `SelfServiceTenantRouteConfig`. Omitting it refuses.
   *
   * The one route in this class today MINTS a session, which is precisely the
   * loop suspension has to close, so nothing here opts out.
   */
  allowedWhileTenantSuspended?: string;
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
      async (tx) => {
        const suspended = await refuseIfTenantSuspended(
          tx,
          tenantId,
          config.allowedWhileTenantSuspended
        );

        if (suspended) return suspended;

        return config.handler({ ...requestContext, tx });
      },
      {
        workClass: config.workClass,
        queueTimeoutMs: config.queueTimeoutMs
      }
    );
  };
}

/**
 * SSE variant: a long-lived stream that RE-AUTHORIZES on every tick (ADR-0075,
 * Issue #467).
 *
 * ## Why this is a fourth seam and not a handler that happens to stream
 *
 * `defineTenantRoute` returns the connection to the pool and releases the
 * work-class slot BEFORE any byte reaches the client. For a JSON request that
 * is correct and thrifty. For a connection that lives thirty minutes it turns a
 * momentary decision into a STANDING PERMISSION: a role revoked at minute two
 * does not stop the stream until the client disconnects.
 *
 * So this factory opens NO transaction of its own around the stream. Each tick
 * opens and closes its own, runs `authorizeInTransaction` first and the
 * snapshot read second, and a deny ends the connection. `tx` never enters the
 * stream closure — the connection it belongs to has already been handed to
 * another request.
 *
 * ## What it does NOT drop
 *
 * `workClass` stays required, the tenant transaction is still opened in one
 * place, and the route file still contains no `withTenant` call of its own — so
 * `api:tenant-route:check` stays one-directional instead of growing an
 * allowlist for streams.
 *
 * ## Fan-out is per-connection polling, and that is written down
 *
 * Every connection reads the database on its own schedule. Production defaults
 * to a single instance (`capacity-config.ts`), so this works today, and it does
 * not silently break when replicas are added — it just does not get cheaper.
 * The pub/sub shape that would replace it has a trap worth knowing before
 * anyone starts: a Bun `RedisClient` that has `subscribe`d blocks almost every
 * other command, so the subscriber must be its OWN connection, never the
 * singleton the rate limiter uses.
 */
export type SseTenantRouteConfig<TSnapshot> = {
  /** REQUIRED, same reasoning as `defineTenantRoute`. */
  workClass: WorkClass;
  queueTimeoutMs?: number;
  authorize: AccessRequest;
  authorizeOptions?: {
    hierarchyPort?: BusinessScopeHierarchyPort;
    sodRules?: readonly SoDRuleDescriptor[];
  };
  /**
   * How often the stream re-decides AND re-reads. REQUIRED and unbounded by
   * default on purpose: this is the number that sets the cost of not having a
   * standing permission (one guard chain per tick per connection) and the
   * staleness of a revocation, so it must be chosen at every call site rather
   * than inherited.
   */
  tickIntervalMs: number;
  /**
   * Hard ceiling on one connection. A stream that never ends is a connection
   * slot that never returns, and `EventSource` reconnects on its own — so the
   * cost of ending one is a reconnect, and the cost of not ending it is
   * unbounded.
   */
  maxConnectionMs: number;
  /** SSE `event:` name for each snapshot frame. */
  eventName: string;
  /** Runs INSIDE the tick's transaction, only after that tick's authorize allowed. */
  read: (context: {
    tx: Bun.TransactionSQL;
    auth: Extract<AuthorizeResult, { allowed: true }>;
    tenantId: string;
    now: Date;
  }) => Promise<TSnapshot>;
};

export function defineSseTenantRoute<TSnapshot>(
  config: SseTenantRouteConfig<TSnapshot>
): APIRoute {
  return async ({ request, cookies, clientAddress }) => {
    const { tenantId, token } = resolveAuthInputs(request, cookies);

    if (!tenantId) {
      return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
    }
    if (!token) {
      return fail(401, "AUTH_REQUIRED", "Authentication required.");
    }

    const sql = sqlClientForRoute();
    const tokenHash = hashSessionToken(token);
    const deadline = Date.now() + config.maxConnectionMs;
    // Resolved ONCE, at stream open, and reused by every tick: a long-lived SSE
    // connection has one peer, and re-deriving it per tick from a `request`
    // that never changes would only invite the two to disagree.
    const clientIp = resolveClientIp(request, clientAddress);

    /**
     * One tick: one transaction, decision first, read second.
     *
     * The two must share a transaction for the same reason `loadAdminScreen`
     * documents — deciding against one snapshot and reading against another is
     * how a scope filter computed for one set of rows gets applied to a
     * different set.
     */
    const authorizeAndRead = async (): Promise<SseTickOutcome<TSnapshot>> => {
      try {
        // `withTenant` — not `withTenantOrThrow` — RETURNS a `Response` when
        // the pool or the circuit breaker refuses, rather than throwing. The
        // `catch` below therefore covers only a read that threw; the refusal
        // path is the `instanceof Response` narrowing further down, and missing
        // it would have made a busy database indistinguishable from a snapshot.
        const outcome = await withTenant<SseTickOutcome<TSnapshot>>(
          sql,
          tenantId,
          async (tx) => {
            const now = new Date();
            const auth = await authorizeInTransaction(
              tx,
              tenantId,
              tokenHash,
              now,
              config.authorize,
              // ADR-0092 — the write-class IP condition denies when the address
              // is absent, so the factory supplies it for every route it owns.
              // Merged rather than replaced: `authorizeOptions` is static
              // config and this one value is per-request.
              { ...config.authorizeOptions, clientIp }
            );

            if (!auth.allowed) {
              return { state: "denied", status: auth.denied.status };
            }

            return {
              state: "ok",
              snapshot: await config.read({ tx, auth, tenantId, now })
            };
          },
          {
            workClass: config.workClass,
            queueTimeoutMs: config.queueTimeoutMs
          }
        );

        return outcome instanceof Response ? { state: "error" } : outcome;
      } catch {
        // A read that threw. Reported as a distinct terminal outcome rather
        // than folded into `denied`: telling a client its authorization was
        // revoked when the database was merely busy is a lie in the direction
        // that gets investigated as a permissions bug.
        return { state: "error" };
      }
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;

        const abort = () => {
          closed = true;
        };

        request.signal.addEventListener("abort", abort, { once: true });

        try {
          await runSseLoop<TSnapshot>({
            authorizeAndRead,
            write: (chunk) => {
              if (closed) return;
              controller.enqueue(encoder.encode(chunk));
            },
            waitForNextTick: () =>
              new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, config.tickIntervalMs);

                request.signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timer);
                    resolve();
                  },
                  { once: true }
                );
              }),
            isFinished: () =>
              closed || request.signal.aborted || Date.now() >= deadline,
            serialize: (snapshot) => JSON.stringify(snapshot),
            eventName: config.eventName
          });
        } finally {
          request.signal.removeEventListener("abort", abort);
          controller.close();
        }
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        // A stream describing one tenant's live state must never be held by any
        // shared cache, and `no-transform` stops a proxy from buffering it into
        // uselessness.
        "cache-control": "private, no-store, no-transform",
        connection: "keep-alive",
        // Nginx-family proxies buffer by default and would hold every frame
        // until the response ended — which, for a stream, is never.
        "x-accel-buffering": "no"
      }
    });
  };
}

/** One place every factory reaches the pool, so none can drift onto its own client. */
function sqlClientForRoute(): Bun.SQL {
  return getDatabaseClient();
}

/**
 * The any-of rule for `authorize`'s array form, as a pure function over
 * already-evaluated results — mirrors `loadAdminScreen`'s `selectEntryOutcome`
 * (`lib/auth/admin-screen.ts`), kept as a separate, smaller function here
 * because a route needs the original `Response` a denial carries (its `code`/
 * `message` body), where a screen only ever needed a status number to decide
 * what to render.
 *
 * Kept pure and separate from the transaction it runs inside for the same
 * reason `selectEntryOutcome` is: the interesting part is not "does it call
 * the chokepoint" (the caller already did, once per candidate) but what it
 * does with N answers, which is where an off-by-one reads as an access grant.
 *
 * Exported (mirroring `selectEntryOutcome`'s own export) so it has a direct,
 * DB-free unit test — `tests/tenant-route-any-of.test.ts` — instead of being
 * reachable only through a full `defineTenantRoute` call. ADR-0121.
 */
export function selectAnyAllowed(
  results: readonly AuthorizeResult[]
): AuthorizeResult {
  // An empty array denies — "no request authorizes this route" must never
  // read as "any request does". Unreachable through `defineTenantRoute`'s own
  // call sites today (every array literal used has two entries), kept
  // explicit rather than left to fall through to `results[0]`, which would
  // throw on an empty array instead of denying.
  if (results.length === 0) {
    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", "Access denied.")
    };
  }

  // The FIRST candidate's denial when none allowed: routes list their primary
  // permission first, so the response describes the refusal a caller is most
  // likely asking about, and it does not shift with which permission a given
  // caller happens to be missing.
  return results.find((result) => result.allowed) ?? results[0]!;
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

    /**
     * A refusal from `prepare` is HELD, not returned — authorization decides
     * first.
     *
     * `prepare` reads and validates the body, and returning its `400` straight
     * away meant a caller with no permission for this endpoint learned its
     * schema — field names, enum values, length limits — and, worse, left no
     * row behind: `authorizeInTransaction` is what writes the decision log, and
     * a request that never reached it was never recorded. Endpoint probing was
     * invisible.
     *
     * The obvious fix — authorize before parsing — is wrong here, and the
     * reason is two doc-blocks up: `await request.json()` waits on the CLIENT,
     * so parsing inside `withTenant` would hold a reserved connection and its
     * work-class slot for as long as a caller chooses to take. Holding the
     * refusal keeps both properties: the body is still parsed outside the
     * transaction, and the invalid-input answer still comes after the
     * permission answer.
     *
     * Cost: a request with a malformed body from an ALLOWED caller now also
     * pays the authorization it was always going to pay. Nothing pays twice.
     */
    let heldPrepareRefusal: Response | null = null;

    if (config.prepare) {
      const prepareResult = await config.prepare(requestContext);

      if (prepareResult instanceof Response) {
        heldPrepareRefusal = prepareResult;
      } else {
        prepared = prepareResult;
      }
    }

    /**
     * The two routes whose guard is a FUNCTION of the body cannot defer:
     * `POST /api/v1/partners/:id/status` and
     * `POST /api/v1/access/machine-credentials` pick a stricter permission
     * based on what was submitted, so with no valid `prepared` there is no
     * guard to evaluate. They return the refusal early, and the exposure that
     * leaves is bounded to callers who already hold a live session — the
     * middleware boundary (`lib/security/api-body-auth-boundary.ts`) refuses
     * anonymous ones before the body is read at all.
     *
     * The ARRAY form is deliberately NOT `typeof ... === "function"` and never
     * hits this branch: it does not read `prepared` at all, so it stays
     * evaluable — and evaluated — even when `prepare` refused. A route that
     * matched this check only because its guard happened to be computed from a
     * function, without actually needing the body to pick a permission, is the
     * exact defect Issue #794/PR #797 found (`PATCH /api/v1/media/objects/
     * {id}`) — the fix was moving it to the array form below, not widening this
     * carve-out to a third name.
     */
    if (heldPrepareRefusal && typeof config.authorize === "function") {
      return heldPrepareRefusal;
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
        // Array form: any ONE of these allowed is enough to reach `handler` —
        // see `authorize`'s own doc comment. Every candidate still goes through
        // `authorizeInTransaction` (never a separate, ad-hoc check), and a
        // shared read cache means the session/tenant-state reads happen once
        // regardless of how many candidates there are (the same memo
        // `loadAdminScreen` uses for its own any-of form, `authorization-read-
        // cache.ts`).
        //
        // Unlike `loadAdminScreen`, this STOPS at the first allow rather than
        // evaluating every candidate: a route's `handler` has no `entry`-style
        // per-candidate readout to fill (nothing here reads "which of the N did
        // this caller hold" the way a multi-panel screen does), so evaluating a
        // permission the caller was never asked about would only write an extra
        // decision-log row that reads as "adjudicate_rights was checked and
        // denied" for a request that never needed it. The route's `handler`
        // still makes its OWN body-shape-specific `authorizeInTransaction` calls
        // afterwards — this loop only answers "is it worth opening the handler
        // at all".
        const requests: readonly AccessRequest[] = Array.isArray(guard)
          ? guard
          : [guard];

        const authorizeOptions = {
          ...config.authorizeOptions,
          clientIp: resolveClientIp(request, clientAddress),
          readCache: createAuthorizationReadCache()
        };

        const results: AuthorizeResult[] = [];

        for (const request of requests) {
          const result = await authorizeInTransaction(
            tx,
            tenantId,
            tokenHash,
            requestContext.now,
            request,
            authorizeOptions
          );

          results.push(result);

          if (result.allowed) break;
        }

        const auth = selectAnyAllowed(results);

        if (!auth.allowed) {
          return auth.denied;
        }

        // Allowed — so the caller is entitled to be told what is wrong with
        // their input, and the decision log now carries the row saying they
        // were here.
        if (heldPrepareRefusal) {
          return heldPrepareRefusal;
        }

        return config.handler({
          ...requestContext,
          tx,
          auth,
          tokenHash,
          prepared
        });
      },
      {
        workClass: config.workClass,
        queueTimeoutMs: config.queueTimeoutMs
      }
    );
  };
}
