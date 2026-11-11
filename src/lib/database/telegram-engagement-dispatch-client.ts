/**
 * The connection of `telegram-engagement:dispatch` ONLY (Issue #1156, audits H-2
 * and H-A of PR #1260): role `awcms_telegram_engagement_dispatch` (`sql/353`),
 * whose view of `awcms_channel_secrets` is bounded to customer bot tokens and
 * webhook seeds by a RESTRICTIVE policy.
 *
 * `TELEGRAM_ENGAGEMENT_DATABASE_URL` has NO fallback, unlike the worker and
 * setup seams: falling back to the app connection would silently run the job as
 * `awcms_app`, which sees every channel secret of every tenant, so a missing
 * value refuses instead (fail closed). Its own file so that no other job's
 * import graph reaches the code that reads this secret (job-scoped env).
 *
 * Three more refusals, so that the key ring this job holds never sits next to a
 * broader login (audit H-A):
 *
 *   - `assertNoSharedLogins`: the job refuses to start if a shared-role
 *     connection string (the app, worker or setup one) is present in its
 *     environment. The runner withholds them (`dedicatedRoleTargets`); this is
 *     the second line for a host that runs the job some other way.
 *   - `assertConnectedAsDispatchRole`: after connecting it asks the server who
 *     it is, and stops unless it is exactly the dispatch role, not SUPERUSER and
 *     not BYPASSRLS (a URL pointing at another login is refused, audit L-A).
 */
import { buildDedicatedRoleClient, readConfiguredUrl } from "./client";

export const TELEGRAM_ENGAGEMENT_DISPATCH_ROLE_NAME =
  "awcms_telegram_engagement_dispatch";

/**
 * The shared-role connection strings, spelled by construction rather than as
 * literals: the job-env tracer (`needsAppConnectionString`) reads a quoted
 * literal of the app login's name as "this job needs the app connection", and
 * this file needs the names only to REFUSE them.
 */
export const SHARED_LOGIN_ENV_NAMES = ["", "WORKER_", "SETUP_"].map(
  (prefix) => `${prefix}DATABASE_URL`
);

let client: Bun.SQL | undefined;

export function assertNoSharedLogins(
  env: Record<string, string | undefined> = process.env
): void {
  const present = SHARED_LOGIN_ENV_NAMES.filter(
    (name) => (env[name] ?? "").trim() !== ""
  );

  if (present.length > 0) {
    throw new Error(
      `telegram-engagement:dispatch refuses to run with a shared database login in its environment (${present.join(", ")}): next to the channel key ring it would be broader than the dispatch role.`
    );
  }
}

export function getTelegramEngagementDispatchDatabaseClient(): Bun.SQL {
  if (client) return client;

  const databaseUrl = readConfiguredUrl("TELEGRAM_ENGAGEMENT_DATABASE_URL");

  if (!databaseUrl) {
    throw new Error(
      "TELEGRAM_ENGAGEMENT_DATABASE_URL is required (role awcms_telegram_engagement_dispatch); there is deliberately no fallback to the app connection."
    );
  }

  client = buildDedicatedRoleClient(databaseUrl);

  return client;
}

/** Throws unless the server says this connection IS the dispatch role, without SUPERUSER or BYPASSRLS. */
export async function assertConnectedAsDispatchRole(
  sql: Bun.SQL
): Promise<void> {
  const rows = (await sql`
    SELECT current_user AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypass
    FROM pg_roles r
    WHERE r.rolname = current_user
  `) as { name: string; superuser: boolean; bypass: boolean }[];
  const who = rows[0];

  if (
    !who ||
    who.name !== TELEGRAM_ENGAGEMENT_DISPATCH_ROLE_NAME ||
    who.superuser ||
    who.bypass
  ) {
    throw new Error(
      `telegram-engagement:dispatch must connect as ${TELEGRAM_ENGAGEMENT_DISPATCH_ROLE_NAME} (non-superuser, no BYPASSRLS); connected as ${who?.name ?? "unknown"}${who?.superuser ? " (SUPERUSER)" : ""}${who?.bypass ? " (BYPASSRLS)" : ""}.`
    );
  }
}
