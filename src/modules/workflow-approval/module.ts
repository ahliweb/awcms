import { defineModule } from "../_shared/module-contract";

export const workflowApprovalModule = defineModule({
  key: "workflow",
  name: "Workflow Approval",
  version: "2.0.0",
  status: "active",
  description:
    "Managed, versioned workflow-definition engine ported from awcms-mini's proven workflow-approval module: draft/publish/retire lifecycle with immutable published/retired versions and version pinning per instance, generic nodes/transitions (sequential approval, bounded conditional routing, parallel/join fan-out/fan-in, notify), quorum/any/all approval rules, effective-dated delegation/substitution, escalation/timeout policies processed by a scheduled worker job, and administrative recovery (reassign/cancel/force-decision) with explicit permissions, reason, Idempotency-Key, and full audit. Self-approval guard reused unchanged from identity_access's ABAC evaluator. Module-contributed condition resolvers/actions are a static, reviewed-source-code registry (`infrastructure/condition-action-registry.ts`) — never runtime-registered or arbitrary tenant-supplied code (doc 21 §3 decision tree, node Q5). See README.",
  dependencies: ["tenant_admin", "identity_access", "domain_event_runtime"],
  type: "system",
  // No `navigation` entries yet — an admin UI for the approval inbox
  // (src/pages/admin/workflows/*.astro) does not exist in this base;
  // declaring a nav entry with no matching page would be a real 404. Add
  // navigation once that UI ships, matching every other ported module's
  // convention (a real page always exists first).
  permissions: [
    {
      activityCode: "approval",
      action: "read",
      description: "Read workflow tasks and instances"
    },
    {
      activityCode: "approval",
      action: "approve",
      description: "Record a workflow task decision"
    },
    {
      activityCode: "definition",
      action: "read",
      description: "Read workflow definitions and version history"
    },
    {
      activityCode: "definition",
      action: "create",
      description: "Create a new draft workflow definition"
    },
    {
      activityCode: "definition",
      action: "update",
      description: "Update an existing draft workflow definition"
    },
    {
      activityCode: "definition",
      action: "publish",
      description: "Publish/activate a draft workflow definition version"
    },
    {
      activityCode: "definition",
      action: "retire",
      description: "Retire an active workflow definition version"
    },
    {
      activityCode: "definition",
      action: "delete",
      description: "Soft-delete a draft workflow definition"
    },
    {
      activityCode: "recovery",
      action: "reassign",
      description: "Reassign a pending workflow task to another tenant user"
    },
    {
      activityCode: "recovery",
      action: "cancel",
      description: "Cancel a running workflow instance"
    },
    {
      activityCode: "recovery",
      action: "force_decide",
      description:
        "Force-approve or force-reject a pending workflow task, bypassing quorum"
    },
    {
      activityCode: "delegation",
      action: "read",
      description: "Read workflow delegation/substitute assignments"
    },
    {
      activityCode: "delegation",
      action: "create",
      description: "Create a workflow delegation/substitute assignment"
    },
    {
      activityCode: "delegation",
      action: "revoke",
      description: "Revoke a workflow delegation/substitute assignment"
    }
  ],
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      "awcms.workflow.instance.started",
      "awcms.workflow.instance.advanced",
      "awcms.workflow.instance.approved",
      "awcms.workflow.instance.rejected",
      "awcms.workflow.instance.cancelled",
      "awcms.workflow.task.escalated",
      "awcms.workflow.delegation.created",
      "awcms.workflow.delegation.revoked"
    ]
  },
  jobs: [
    {
      command: "bun run workflow:escalations:dispatch",
      purpose:
        "Escalate awcms_workflow_tasks rows past their due_at for every active tenant (bounded batch, advisory lock, idempotent per escalation step).",
      recommendedSchedule: "Every 1-5 minutes via cron/systemd timer.",
      environmentNotes:
        "Pure PostgreSQL/in-process operation — no external network egress. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    }
  ],
  api: {
    openApiPath: "openapi/modules/workflow-approval.openapi.yaml",
    basePath: "/api/v1/workflows"
  }
});
