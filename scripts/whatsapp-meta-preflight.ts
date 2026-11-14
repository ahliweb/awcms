/**
 * whatsapp-meta-preflight.ts — `bun run whatsapp:meta:preflight`.
 *
 * Issue #1298, finding L5 of the independent audit of #1267. READ-ONLY: three
 * SELECTs per tenant as `awcms_worker` (the dispatcher's own role, whose
 * verdict this predicts), no migration, no write, no provider call, no
 * credential decrypted.
 *
 * Run it BEFORE `WHATSAPP_ENABLED=true` reaches a deployment that already holds
 * Meta numbers (see docs/awcms/whatsapp-meta-enable-runbook.md). It lists what
 * would go TERMINAL at its next dispatch:
 *
 *   - a connected Meta number with no live WABA parent: every row queued on it
 *     (OTP included) fails with an invalid WABA binding;
 *   - a queued row whose template has no sendable approval of the right
 *     category on the number's WABA (`TEMPLATE_NOT_APPROVED`), or a free-text
 *     row whose recipient has no open 24-hour window (`OUTSIDE_SERVICE_WINDOW`).
 *
 * It uses the dispatcher's own rule (`decideMetaSend`), not a copy of it.
 * Output names tenant codes, account ids, template keys and counts only: never
 * a number, a recipient, a hash, a body or a token.
 *
 * Exit code: 0 when nothing would fail, 1 when something would (or a tenant
 * could not be read). The template registry is process-local, like the
 * dispatcher's, so a consumer's templates are registered here too.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { registerBookingWhatsappTemplates } from "../src/modules/booking/infrastructure/booking-whatsapp-templates";
import { runMetaEnablementPreflight } from "../src/modules/whatsapp-delivery/application/whatsapp-meta-preflight";

type TenantRow = { id: string; tenant_code: string };

async function main(): Promise<void> {
  const sql = getWorkerDatabaseClient();

  registerBookingWhatsappTemplates();

  const tenants = (await sql`
    SELECT id, tenant_code FROM awcms_tenants ORDER BY tenant_code
  `) as TenantRow[];
  let blockedRows = 0;
  let blockedSecurityRows = 0;
  let numbers = 0;
  let problems = 0;

  console.log("whatsapp:meta:preflight — READ-ONLY\n");

  for (const tenant of tenants) {
    try {
      const report = await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) => runMetaEnablementPreflight(tx, tenant.id),
        { workClass: "background_sync" }
      );

      numbers += report.numbersChecked;
      blockedRows += report.blockedRows;
      blockedSecurityRows += report.blockedSecurityRows;

      if (report.approvalsTruncated) {
        problems += 1;
        console.log(
          `[${tenant.tenant_code}] the approval list was truncated; a "not approved" line below may be a row that was not read.`
        );
      }

      for (const finding of report.findings) {
        problems += 1;

        if (finding.kind === "number_without_waba") {
          console.log(
            `[${tenant.tenant_code}] number ${finding.accountId} has NO live WABA parent: ` +
              `${finding.pendingRows} queued row(s) (${finding.pendingSecurityRows} security) will fail terminally. ` +
              "Register the number under its waba container."
          );
        } else {
          const need = finding.providerTemplate
            ? ` Meta must show ${finding.providerTemplate.name}/${finding.providerTemplate.language} as APPROVED on WABA ${finding.wabaId}; record it with evidence.`
            : "";

          console.log(
            `[${tenant.tenant_code}] number ${finding.accountId}: ${finding.rows} ${finding.purpose} row(s) of ${finding.templateKey} will fail (${finding.reason}).${need}`
          );
        }
      }
    } catch (error) {
      problems += 1;
      console.log(
        `[${tenant.tenant_code}] could not be read: ${error instanceof Error ? error.name : "unknown"}`
      );
    }
  }

  console.log(
    `\ntenants=${tenants.length} metaNumbers=${numbers} rowsThatWouldFail=${blockedRows} ` +
      `(security=${blockedSecurityRows}) problems=${problems}`
  );

  if (problems > 0) {
    console.log(
      "NOT READY: fix the lines above (or drain the rows) before enabling the Meta path."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "READY: nothing queued on a Meta number would fail terminally."
    );
  }
}

if (import.meta.main) {
  await main()
    .catch((error) => {
      logScriptFailure("whatsapp:meta:preflight FAILED", error);
      process.exitCode = 1;
    })
    .finally(() => getWorkerDatabaseClient().close({ timeout: 1 }));
}
