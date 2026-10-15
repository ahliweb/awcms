import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { listTelegramTemplates } from "../../../../modules/telegram-delivery/domain/telegram-templates";

/**
 * `GET /api/v1/telegram/templates` (Issue #965) — the registered templates: key,
 * version, the ONE purpose (`staff_ops`) and the typed variable allow-list. The
 * wording (`body`) is not returned: it is the owning module's copy, and this
 * endpoint exists so an operator can see what may be sent, not to edit or harvest
 * it.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "templates",
    action: "read"
  },
  handler: async () =>
    ok({
      templates: listTelegramTemplates().map((template) => ({
        key: template.key,
        version: template.version,
        purpose: template.purpose,
        variables: template.variables.map((variable) => ({
          name: variable.name,
          kind: variable.kind
        }))
      }))
    })
});
