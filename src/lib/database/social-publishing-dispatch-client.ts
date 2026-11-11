/**
 * The connection of `social-publishing:dispatch` ONLY (Issue #1146, ADR-0157
 * section 6): role `awcms_social_dispatch` (`sql/358` + `sql/373`), whose view
 * of `awcms_channel_secrets` is bounded to the access token of a live social
 * account with a granted `publish` capability by a RESTRICTIVE policy.
 *
 * `SOCIAL_PUBLISHING_DATABASE_URL` has NO fallback, unlike the worker and setup
 * seams: falling back would silently run the job as `awcms_app` (which sees
 * every channel secret of every tenant) or `awcms_worker` (which sees every
 * WhatsApp sender credential), next to the channel key ring this job holds. A
 * missing value refuses instead (fail closed). Its own file, so that no other
 * job's import graph reaches the code that reads this secret (job-scoped env,
 * `scripts/jobs-env-allowlist.ts`, "dedicated-role job").
 *
 * Two more refusals, so that the key ring never sits next to a broader login:
 *
 *   - {@link assertNoSharedLogins}: the job refuses to start if a shared-role
 *     connection string (the app, worker or setup one) is in its environment.
 *     The runner withholds them (`dedicatedRoleTargets`); this is the second
 *     line for a host that runs the job some other way.
 *   - {@link assertConnectedAsSocialDispatchRole}: after connecting it asks the
 *     server who it is, and stops unless it is exactly `awcms_social_dispatch`,
 *     not SUPERUSER and not BYPASSRLS (a URL pointing at another login is
 *     refused).
 */
import { buildDedicatedRoleClient } from "./client";

export const SOCIAL_DISPATCH_ROLE_NAME = "awcms_social_dispatch";

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
      `social-publishing:dispatch refuses to run with a shared database login in its environment (${present.join(", ")}): next to the channel key ring it would be broader than the social dispatch role.`
    );
  }
}

export function getSocialPublishingDispatchDatabaseClient(): Bun.SQL {
  if (client) return client;

  // Blank counts as unset, exactly as `readConfiguredUrl` reads the shared seams.
  const databaseUrl =
    process.env.SOCIAL_PUBLISHING_DATABASE_URL?.trim() || undefined;

  if (!databaseUrl) {
    throw new Error(
      "SOCIAL_PUBLISHING_DATABASE_URL is required (role awcms_social_dispatch); there is deliberately no fallback to another connection."
    );
  }

  client = buildDedicatedRoleClient(databaseUrl);

  return client;
}

/** Throws unless the server says this connection IS the social dispatch role, without SUPERUSER or BYPASSRLS. */
export async function assertConnectedAsSocialDispatchRole(
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
    who.name !== SOCIAL_DISPATCH_ROLE_NAME ||
    who.superuser ||
    who.bypass
  ) {
    throw new Error(
      `social-publishing:dispatch must connect as ${SOCIAL_DISPATCH_ROLE_NAME} (non-superuser, no BYPASSRLS); connected as ${who?.name ?? "unknown"}${who?.superuser ? " (SUPERUSER)" : ""}${who?.bypass ? " (BYPASSRLS)" : ""}.`
    );
  }
}
