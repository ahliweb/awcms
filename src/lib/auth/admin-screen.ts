/**
 * `loadAdminScreen` (issue #450, PROJECT_STATE §4 R3) — the one place an admin
 * screen's access decision and its data read happen, in that order, inside one
 * transaction.
 *
 * ## The defect
 *
 * All 32 `src/pages/admin/**\/*.astro` files decided what to render from
 * `ssr.permissions.has(...)`. That set is `fetchGrantedPermissionKeys` — raw
 * RBAC. It skips `authorizeInTransaction`, and therefore skips everything that
 * only exists there: ABAC policy evaluation (a tenant's `deny` written through
 * `/api/v1/access/policies` was enforced on the API and inert on the screen),
 * `resolveModuleAvailability` (a tenant that disabled a module still saw its
 * screen full of data), business-scope facts, action-time SoD, and
 * `recordDecisionLog` — so a read that happened left no row saying it did.
 *
 * What was NOT lost, stated so the finding is not inflated: basic RBAC still
 * held, and there was never cross-tenant leakage — `withTenantOrThrow` and
 * FORCE RLS were always in the path.
 *
 * ## Why it must be fixed before scoped grants (Gelombang 3)
 *
 * Today `ssr.permissions` answers "is this key granted anywhere". Once a grant
 * carries its own scope, that stops meaning "may read THIS", and R3 turns from
 * a missing policy layer into real read-side over-disclosure.
 *
 * ## Why this EXECUTES instead of returning a wrapper
 *
 * `defineTenantRoute` returns an `APIRoute` because a route module exports a
 * handler that something else calls. An `.astro` frontmatter has no handler to
 * wrap — it is a script that runs top-to-bottom — so the honest shape is a
 * function the page awaits. The program plan called this `defineAdminScreen`;
 * the name changed rather than the shape being bent to fit it.
 *
 * ## One transaction, and the order inside it
 *
 * `authorizeInTransaction` and `load` share one `tx`. Splitting them would mean
 * deciding against one snapshot and reading against another — and once grants
 * carry scope, the scope filter a decision computed could be applied to rows
 * fetched under a different one. It is also the same connection discipline
 * `defineTenantRoute` documents: `tx` is ONE reserved connection, so `load`
 * must `await` in sequence and never `Promise.all` over it.
 *
 * ## Deny RENDERS, it does not redirect
 *
 * Over twenty `tests/admin-*-page-contract.test.ts` assert a denied element id
 * (`#users-denied`, `#form-drafts-denied`, …). A redirect would also hand a
 * tenant that authored a `deny` policy a login loop instead of a refusal. So
 * the outcome is data for the template, never a `Response`.
 *
 * ## `error` is a THIRD state, never a denial
 *
 * `withTenantOrThrow` throws when the pool or circuit breaker refuses. A
 * refusal rendered as "you may not see this" is a lie in the direction that
 * gets investigated as a permissions bug; rendered as "there are no rows" it is
 * worse. Screens already distinguish this (`loadError`), and the type keeps
 * them honest by making the three outcomes mutually exclusive.
 */
import type { WorkClass } from "../database/work-class";
import { getDatabaseClient } from "../database/client";
import { withTenantOrThrow } from "../database/tenant-context";
import {
  authorizeInTransaction,
  type AuthorizeResult
} from "../../modules/identity-access/application/access-guard";
import type { AccessRequest } from "../../modules/identity-access/domain/access-control";
import type { BusinessScopeHierarchyPort } from "../../modules/_shared/ports/business-scope-hierarchy-port";
import type { SoDRuleDescriptor } from "../../modules/_shared/module-contract";
import type { SsrContext } from "./ssr-session";

/** The `allowed: true` half, so `auth.context.tenantUserId` reads as in a route. */
export type AuthorizedScreenAccess = Extract<
  AuthorizeResult,
  { allowed: true }
>;

export type AdminScreenLoadContext = {
  tx: Bun.TransactionSQL;
  auth: AuthorizedScreenAccess;
  /**
   * A SECOND decision, for the affordances a screen shows or hides (a create
   * form, a delete button) once the entry decision has allowed the page.
   *
   * It runs the full chokepoint on the same transaction, so a `deny` policy
   * hides the button rather than merely failing when it is pressed. These
   * remain UX-only in the sense that matters — the endpoint behind the button
   * is still the authority — but "UX-only" is no longer an excuse for the
   * affordance to be decided by a different rule than the endpoint uses.
   */
  can: (request: AccessRequest) => Promise<boolean>;
};

export type AdminScreenOutcome<TData> =
  | { state: "allowed"; data: TData; auth: AuthorizedScreenAccess }
  /**
   * The chokepoint refused. `status` is the decision's own — 403 for a policy
   * refusal, and NOT flattened, because a screen that wants to say something
   * more specific later should not have to re-derive it.
   */
  | { state: "denied"; status: number }
  /** The transaction never ran, or `load` threw. NOT a denial. */
  | { state: "error" };

export type AdminScreenConfig<TData> = {
  /** The resolved session. `null` cannot happen behind the SSR guard, but see below. */
  ssr: SsrContext;
  /**
   * REQUIRED, no default — the same reasoning `defineTenantRoute` writes down.
   * Screens are `"interactive"` unless they run a genuinely heavy report.
   */
  workClass: WorkClass;
  queueTimeoutMs?: number;
  /** The screen's ENTRY permission: what it takes to see the page at all. */
  authorize: AccessRequest;
  authorizeOptions?: {
    hierarchyPort?: BusinessScopeHierarchyPort;
    sodRules?: readonly SoDRuleDescriptor[];
  };
  /** Runs inside the same transaction, only when access was ALLOWED. */
  load: (context: AdminScreenLoadContext) => Promise<TData>;
  /**
   * Called with whatever was thrown, before `{ state: "error" }` is returned.
   * Logging stays with the screen so `logAdminPageError`'s message names the
   * page and carries its correlation id.
   */
  onError: (error: unknown) => void;
  /** Injectable for tests. Defaults to the process-wide pool. */
  sql?: Bun.SQL;
  /** One clock for the whole render. */
  now?: Date;
};

export async function loadAdminScreen<TData>(
  config: AdminScreenConfig<TData>
): Promise<AdminScreenOutcome<TData>> {
  const now = config.now ?? new Date();
  const sql = config.sql ?? getDatabaseClient();

  try {
    return await withTenantOrThrow(
      sql,
      config.ssr.tenantId,
      async (tx): Promise<AdminScreenOutcome<TData>> => {
        const auth = await authorizeInTransaction(
          tx,
          config.ssr.tenantId,
          config.ssr.tokenHash,
          now,
          config.authorize,
          config.authorizeOptions
        );

        if (!auth.allowed) {
          // The refusal is already recorded — `authorizeInTransaction` writes
          // the decision log itself, which is most of the point of routing
          // screens through it. Nothing is re-derived here.
          return { state: "denied", status: auth.denied.status };
        }

        const can = async (request: AccessRequest): Promise<boolean> => {
          const secondary = await authorizeInTransaction(
            tx,
            config.ssr.tenantId,
            config.ssr.tokenHash,
            now,
            request,
            config.authorizeOptions
          );

          return secondary.allowed;
        };

        const data = await config.load({ tx, auth, can });

        return { state: "allowed", data, auth };
      },
      { workClass: config.workClass, queueTimeoutMs: config.queueTimeoutMs }
    );
  } catch (error) {
    config.onError(error);

    return { state: "error" };
  }
}
