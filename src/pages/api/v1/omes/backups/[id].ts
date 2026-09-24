import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchBackupDetail } from "../../../../../modules/omes-control/application/backup-directory";

/** `GET /api/v1/omes/backups/{id}` (Issue ahliweb/omes#198) — `{id}` is `awcms_omes_backup_snapshots.id`. */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.backups.read,
  handler: async ({ tx, tenantId, now, params }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Backup id is required.");
    }

    const backup = await fetchBackupDetail(tx, tenantId, id, now);

    if (!backup) {
      return fail(404, "RESOURCE_NOT_FOUND", "Backup not found.");
    }

    return ok({ backup });
  }
});
