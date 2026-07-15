import { defineModule } from "../_shared/module-contract";

export const loggingModule = defineModule({
  key: "logging",
  name: "Logging & Audit Trail",
  version: "1.0.0",
  status: "active",
  description:
    "Cross-module audit trail (awcms_audit_events) and correlation ID propagation. Complements, not replaces, domain events and structured logs.",
  dependencies: ["tenant_admin"],
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/logs"
  },
  permissions: [
    {
      activityCode: "audit_trail",
      action: "read",
      description: "Read audit trail events"
    }
  ]
});
