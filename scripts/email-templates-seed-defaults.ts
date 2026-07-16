/**
 * email-templates-seed-defaults.ts — `bun run email:templates:seed-defaults
 * -- --tenant=<tenantId> --actor=<tenantUserId>`.
 *
 * Issue #498 (epic #492) §"Default system templates are seeded or
 * documented". `DEFAULT_EMAIL_TEMPLATES` (`src/modules/email/domain/
 * email-default-templates.ts`) has no migration-time seed — a migration
 * cannot INSERT rows for a tenant that doesn't exist yet — so this is an
 * operator-run CLI instead, called once per tenant (e.g. right after
 * tenant setup, or when a derived app wants the base defaults present).
 * Idempotent: `seedDefaultEmailTemplates` skips any `template_key` that
 * already has an active row, so re-running never overwrites a tenant's
 * customized copy.
 *
 * `--actor` must be a real `tenant_users.id` for that tenant (attributed
 * as `created_by`/`updated_by` and the audit event's actor) — there is no
 * "system user" placeholder in this codebase; the operator supplies one.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { withTenant } from "../src/lib/database/tenant-context";
import { recordAuditEvent } from "../src/modules/logging/application/audit-log";
import { DEFAULT_EMAIL_TEMPLATES } from "../src/modules/email/domain/email-default-templates";
import { seedDefaultEmailTemplates } from "../src/modules/email/application/email-template-directory";

function readArg(name: string): string | undefined {
  const flag = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return flag?.split("=")[1];
}

async function main() {
  const tenantId = readArg("tenant");
  const actorTenantUserId = readArg("actor");

  if (!tenantId || !actorTenantUserId) {
    console.error(
      "email:templates:seed-defaults FAILED — --tenant=<tenantId> and --actor=<tenantUserId> are required."
    );
    process.exitCode = 1;
    return;
  }

  const sql = getDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const result = await withTenant(sql, tenantId, async (tx) => {
      const seeded = await seedDefaultEmailTemplates(
        tx,
        tenantId,
        actorTenantUserId,
        DEFAULT_EMAIL_TEMPLATES
      );

      if (seeded.created > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId,
          moduleKey: "email",
          action: "create",
          resourceType: "email_template",
          severity: "info",
          message: `Seeded ${seeded.created} default email template(s) (${seeded.skipped} already present).`,
          correlationId
        });
      }

      return seeded;
    });

    console.log(
      `email:templates:seed-defaults complete — correlationId=${correlationId} ` +
        `tenant=${tenantId} created=${result.created} skipped=${result.skipped}`
    );
  } catch (error) {
    logScriptFailure("email:templates:seed-defaults FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
