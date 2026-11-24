/**
 * The connection of `email:senders:verify` ONLY (Issue #1479, ADR-0162 O1,
 * owner decision K19.1): role `awcms_email_senders_verify` (`sql/460`), whose
 * view of `awcms_channel_secrets` is bounded to the `api_token` of a live
 * Mailketing ESP account by a RESTRICTIVE policy, and whose writes are bounded
 * per row and per value.
 *
 * `EMAIL_SENDERS_VERIFY_DATABASE_URL` has NO fallback, unlike the worker and
 * setup seams: falling back would silently run the job as `awcms_app` (which
 * sees every channel secret of every tenant) next to the channel key ring this
 * job holds. A missing value refuses instead (fail closed). Its own file, so
 * that no other job's import graph reaches the code that reads this variable
 * (job-scoped env, `scripts/jobs-env-allowlist.ts`, "dedicated-role job").
 *
 * Two more refusals, so that the key ring never sits next to a broader login:
 *
 *   - {@link assertNoSharedLogins}: the job refuses to start if a shared-role
 *     connection string (the app, worker or setup one) is in its environment.
 *     The runner withholds them (`dedicatedRoleTargets`); this is the second
 *     line for a host that runs the job some other way.
 *   - {@link assertConnectedAsEmailSendersVerifyRole}: after connecting it asks
 *     the server who it is, and stops unless both its login (`session_user`)
 *     and its current user are exactly `awcms_email_senders_verify`, not
 *     SUPERUSER and not BYPASSRLS.
 */
import {
  assertConnectedAsDedicatedRole,
  buildDedicatedRoleClient
} from "./client";

export const EMAIL_SENDERS_VERIFY_ROLE_NAME = "awcms_email_senders_verify";

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
      `email:senders:verify refuses to run with a shared database login in its environment (${present.join(", ")}): next to the channel key ring it would be broader than the sender verification role.`
    );
  }
}

export function getEmailSendersVerifyDatabaseClient(): Bun.SQL {
  if (client) return client;

  // Blank counts as unset, exactly as `readConfiguredUrl` reads the shared seams.
  const databaseUrl =
    process.env.EMAIL_SENDERS_VERIFY_DATABASE_URL?.trim() || undefined;

  if (!databaseUrl) {
    throw new Error(
      "EMAIL_SENDERS_VERIFY_DATABASE_URL is required (role awcms_email_senders_verify); there is deliberately no fallback to another connection."
    );
  }

  client = buildDedicatedRoleClient(databaseUrl);

  return client;
}

/**
 * Throws unless the server says this connection IS the sender verification
 * role, as its login AND its current user, without SUPERUSER or BYPASSRLS.
 */
export async function assertConnectedAsEmailSendersVerifyRole(
  sql: Bun.SQL
): Promise<void> {
  await assertConnectedAsDedicatedRole(
    sql,
    EMAIL_SENDERS_VERIFY_ROLE_NAME,
    "email:senders:verify"
  );
}
