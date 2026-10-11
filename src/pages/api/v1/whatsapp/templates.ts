import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { listWhatsappTemplates } from "../../../../modules/whatsapp-delivery/domain/whatsapp-templates";

/**
 * `GET /api/v1/whatsapp/templates` (Issue #963) — the registered templates: key,
 * version, the ONE purpose it is registered with, the variable allow-list and
 * which variables are secret. The wording (`body`) is not returned: it is the
 * owning module's copy, and this endpoint exists so an operator can see what
 * may be sent and under which consent rules, not to edit or harvest it.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "templates",
    action: "read"
  },
  handler: async () =>
    ok({
      templates: listWhatsappTemplates().map((template) => ({
        key: template.key,
        version: template.version,
        purpose: template.purpose,
        variables: [...template.variables],
        secretVariables: [...(template.secretVariables ?? [])],
        hasApprovedProviderTemplate: template.providerTemplate !== undefined
      }))
    })
});
