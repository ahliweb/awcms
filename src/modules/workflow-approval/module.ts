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
  /**
   * ADR-0094 wave 2 (Issue #557).
   *
   * Approval history is evidence, and the reasons written in it are about
   * PEOPLE: who approved, who was asked and did not, who acted on somebody
   * else's behalf. All of it exports, none of it is deleted, and the
   * severance chain is what detaches it.
   */
  subjectData: [
    {
      key: "workflow.workflow_decisions",
      tableName: "awcms_workflow_decisions",
      ownerModuleKey: "workflow",
      subjectColumns: [
        { column: "decided_by_tenant_user_id", references: "tenant_user" },
        { column: "on_behalf_of_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Approvals and rejections this person made, the reason they gave, and any administrative override they used. Both columns are named because acting FOR somebody is a different fact from acting AS them, and a descriptor naming only the decider would lose every delegated decision."
    },
    {
      key: "workflow.workflow_task_assignments",
      tableName: "awcms_workflow_task_assignments",
      ownerModuleKey: "workflow",
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "reassigned_to_tenant_user_id", references: "tenant_user" },
        { column: "reassigned_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "What this person was asked to decide, and what was taken off them and given to somebody else. A reassignment away from a person is a fact about them that no other table records."
    },
    {
      key: "workflow.workflow_delegations",
      tableName: "awcms_workflow_delegations",
      ownerModuleKey: "workflow",
      subjectColumns: [
        { column: "delegator_tenant_user_id", references: "tenant_user" },
        { column: "delegate_tenant_user_id", references: "tenant_user" },
        { column: "created_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Standing authority this person handed to somebody else, or received. Four columns because a delegation names two people and its lifecycle names two more, and each is the subject of a different request."
    },
    {
      key: "workflow.workflow_instances",
      tableName: "awcms_workflow_instances",
      ownerModuleKey: "workflow",
      subjectColumns: [
        { column: "requested_by_tenant_user_id", references: "tenant_user" },
        { column: "cancelled_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Approvals this person started or withdrew, with the reason they gave for cancelling. `facts` is the business payload under review, which is about the RESOURCE rather than the requester.",
      redactedColumns: ["facts"]
    },
    {
      key: "workflow.workflow_definitions",
      tableName: "awcms_workflow_definitions",
      ownerModuleKey: "workflow",
      subjectColumns: [
        { column: "created_by_tenant_user_id", references: "tenant_user" },
        { column: "published_by_tenant_user_id", references: "tenant_user" },
        { column: "retired_by_tenant_user_id", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "The tenant's approval rules themselves. Not personal data — the graph describes a process — but every lifecycle step is stamped with who took it, so five columns reach a person."
    },
    {
      key: "workflow.workflow_tasks",
      tableName: "awcms_workflow_tasks",
      ownerModuleKey: "workflow",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A task is a node in a running approval — quorum rule, due date, status — and names nobody. The people are in the assignments and decisions that hang off it, which answer for themselves; the task must survive them or those rows lose the thing they decided."
    },
    {
      key: "workflow.workflow_join_arrivals",
      tableName: "awcms_workflow_join_arrivals",
      ownerModuleKey: "workflow",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Bookkeeping for parallel approval branches reaching a join node. Pure graph state with no person in it and no column a subject could be matched on."
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
      schedule: {
        mode: "cron",
        expression: "*/5 * * * *",
        backlog: "review-before-first-run",
        backlogNote:
          "Escalates every approval task already past its timeout. On a system where this never ran, that is every overdue task at once, each one notifying a human."
      },
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
  },
  // The inbox half of this module's admin surface (ADR-0051). Definition
  // authoring is deliberately NOT here — it needs a graph editor, not a corner
  // of the inbox — so it will arrive as its own entry alongside this one.
  // Gated on `approval.read`: an approver who can see nothing else on the page
  // should still reach it.
  navigation: [
    {
      labelKey: "admin.layout.nav_approvals",
      path: "/admin/approvals",
      order: 62,
      requiredPermission: "workflow.approval.read"
    }
  ]
});
