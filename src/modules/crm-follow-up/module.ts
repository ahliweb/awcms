import { defineModule } from "../_shared/module-contract";
import type { SubjectDataDescriptor } from "../_shared/module-contract";
import {
  CONSUMED_LEAD_EVENT_TYPES,
  CRM_FOLLOW_UP_MODULE_KEY,
  RULES_ACTIVITY_CODE,
  STOP_SIGNALS_ACTIVITY_CODE,
  TASKS_ACTIVITY_CODE
} from "./domain/crm-follow-up-constants";

function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${CRM_FOLLOW_UP_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: CRM_FOLLOW_UP_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

/** Nothing about the prospect is stored here, so there is nothing of theirs to answer. */
const NO_LEAD_DATA =
  "No column holds anything about the prospect: the lead is an opaque id with no foreign key (ADR-0153: no lead copy), and a lead's own data-subject request is answered by crm_leads.";

/**
 * `crm_follow_up` — rule-versioned STAFF follow-up tasks keyed by lead events
 * (Issue #1165, ADR-0159 Proposed, extending ADR-0153 N5).
 *
 * ## Status
 *
 * `experimental` and OFF at three levels: the deployment switch
 * `CRM_FOLLOW_UP_ENABLED`, Module Management's per-tenant enable, and the
 * module's own tenant switch (default off). It declares no `navigation` entry:
 * the worklist screen is a recorded follow-up (a nav entry without a page is a
 * permanent 404), and every route is default-deny.
 */
export const crmFollowUpModule = defineModule({
  key: CRM_FOLLOW_UP_MODULE_KEY,
  name: "CRM Follow-up",
  version: "0.1.0",
  status: "experimental",
  description:
    "Rule-versioned follow-up tasks for STAFF, keyed by crm_leads events (Issue #1165, ADR-0159, extending ADR-0153 N5). A tenant defines rules whose revisions are IMMUTABLE once published (database trigger and no UPDATE grant): a CLOSED trigger (lead created, stage entered, lead assigned) with optional pipeline, stage-category and stage-key filters, a due offset and an optional escalation offset in WORKING minutes over the revision's own calendar (IANA zone, working weekdays, daily window, holidays), an assignee mode (the lead's owner or a fixed user), which staff notices to send and a per-lead cap on open tasks. No expression language. A read-only simulation evaluates a draft revision against a sample trigger and writes nothing. A descriptor-declared consumer creates at most one task per (rule, source event), reassigns lead-owner tasks when the owner changes, and records STOP SIGNALS from conversion, loss and merge; staff record reply, consent-withdrawn, sender-blocked and manual stops. A stop cancels the lead's open tasks and pending notices and WINS every race: creation, stop, reassignment and dispatch serialise on a per-lead advisory lock, and a database trigger refuses a task for a stopped lead. Tasks move open -> escalated -> completed/cancelled with optimistic concurrency, a closed outcome and an append-only action history. `crm-follow-up:dispatch` escalates overdue tasks and hands due notices to the existing workflow_notification port (e-mail, three fixed categories whose variables cannot carry anything about the lead) after re-checking the task, the stop signals, that the recipient is still an ACTIVE user, quiet hours and an hourly per-recipient cap. Nothing is ever sent to the lead; no lead copy is stored; no second workflow engine, no cross-channel facade.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "module_management",
    // The consumer is declared against domain_event_runtime (ADR-0134).
    "domain_event_runtime",
    // The only source of triggers and of the event-sourced stop signals.
    "crm_leads"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/crm-follow-up.openapi.yaml",
    basePath: "/api/v1/crm-follow-up"
  },
  /**
   * The staff notices go through `email`'s `workflow_notification` adapter,
   * injected by the dispatch job's composition root. Optional and NOT a
   * `dependencies` edge: with `email` off or the tenant's `crm.follow_up_*`
   * templates absent the port is a silent no-op and the tasks still work.
   */
  capabilities: {
    consumes: [
      // A staff stop signal is accepted only for a lead that exists in the
      // tenant (audit of PR #1266, LOW-4), read through `CrmLeadPort`.
      { capability: "crm_lead", providedBy: "crm_leads" },
      {
        capability: "workflow_notification",
        providedBy: "email",
        optional: true
      }
    ]
  },
  domainEventConsumers: [
    {
      name: "crm_follow_up.lead_signals",
      description:
        "crm_follow_up consumer — turns crm_leads events into follow-up work: lead.created, lead.stage_changed and lead.assigned create the tasks matching active rules (at most one per rule and source event) and lead.assigned moves live lead-owner tasks to the new owner; lead.converted, lead.lost and lead.merged record a stop signal that cancels the lead's live tasks and pending notices. Trigger events for a tenant where the module is not active are ignored; stop events are recorded whenever the deployment switch is on, so a stop still wins after the module is switched back on.",
      eventTypes: [...CONSUMED_LEAD_EVENT_TYPES],
      eventVersions: ["1.0"],
      handle: async (tx, event, ctx) => {
        const { handleLeadSignal } =
          await import("./application/lead-event-consumer");

        await handleLeadSignal(tx, ctx.tenantId, event);
      }
    }
  ],
  jobs: [
    {
      command: "bun run crm-follow-up:dispatch",
      schedule: {
        mode: "cron",
        expression: "* * * * *",
        backlog: "bounded"
      },
      purpose:
        "Escalates open follow-up tasks whose escalation instant has passed (status, action row, an escalation notice for the rule's recipient) and hands due staff notices to the workflow_notification port (e-mail outbox) after re-checking that the task is live, the lead has no stop signal, the recipient is still the assignee and an ACTIVE user, the notice is inside the rule's working hours and the recipient is under the tenant's hourly cap; otherwise the notice is cancelled, suppressed or deferred. Never sends anything to a lead.",
      recommendedSchedule: "Every minute via cron/systemd timer.",
      environmentNotes:
        "Database-only operation, no external network dependency and no credential: the port's enqueue adds one row to the e-mail module's outbox, sent later by `email:dispatch`. Runs as `awcms_worker` under a per-tenant context with the grants of sql/369 (no rule or revision write, no DELETE) and the e-mail category allow-list of sql/371. Inert (visits no tenant) unless CRM_FOLLOW_UP_ENABLED=true; a tenant is visited only when Module Management and its own switch are on. Bounded per-tenant passes (50 items) in the maintenance work class; per-lead advisory lock plus SKIP LOCKED, safe alongside request traffic. `--dry-run` counts the escalations and notices due now.",
      safeInOfflineLan: true
    }
  ],
  permissions: [
    {
      activityCode: RULES_ACTIVITY_CODE,
      action: "read",
      description:
        "Read follow-up rules and their immutable revisions, the tenant switch, and simulate a draft revision without writing anything"
    },
    {
      activityCode: RULES_ACTIVITY_CODE,
      action: "configure",
      description:
        "Create a follow-up rule, publish a new immutable revision, archive a rule, and switch the module on or off for the tenant (high-risk, audited at warning)"
    },
    {
      activityCode: TASKS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read the follow-up task queue, a task with its action history and staff notifications, and a lead's stop signals"
    },
    {
      activityCode: TASKS_ACTIVITY_CODE,
      action: "update",
      description:
        "Complete a follow-up task with a closed outcome or cancel it (optimistic concurrency, audited)"
    },
    {
      activityCode: STOP_SIGNALS_ACTIVITY_CODE,
      action: "create",
      description:
        "Record a stop signal for a lead (reply received, consent withdrawn, sender blocked, manual): cancels its open tasks and pending notifications and blocks new ones (high-risk, audited at warning)"
    }
  ],
  subjectData: [
    stamps({
      key: "settings",
      tableName: "awcms_crm_follow_up_settings",
      columns: ["updated_by"],
      rationale:
        "The tenant switch and pacing cap. The only person-shaped column is the stamp of the administrator who last changed them."
    }),
    stamps({
      key: "rules",
      tableName: "awcms_crm_follow_up_rules",
      columns: ["created_by", "updated_by"],
      rationale:
        "A tenant's follow-up rule. It describes a process, not a person; its only person-shaped columns are administrator stamps."
    }),
    stamps({
      key: "rule_revisions",
      tableName: "awcms_crm_follow_up_rule_revisions",
      columns: [
        "published_by",
        "escalation_tenant_user_id",
        "fixed_assignee_tenant_user_id"
      ],
      rationale:
        "An immutable revision of a rule. Its person-shaped columns are the publishing administrator and the staff members it names as fixed assignee or escalation recipient."
    }),
    stamps({
      key: "tasks",
      tableName: "awcms_crm_follow_up_tasks",
      columns: ["assignee_tenant_user_id", "closed_by"],
      rationale: `A follow-up task for a member of staff: the assignee and who closed it. ${NO_LEAD_DATA}`
    }),
    stamps({
      key: "task_actions",
      tableName: "awcms_crm_follow_up_task_actions",
      columns: ["actor_tenant_user_id", "assignee_tenant_user_id"],
      rationale: `The append-only history of a task: who acted and who it was assigned to, with closed codes only. ${NO_LEAD_DATA}`
    }),
    stamps({
      key: "stop_signals",
      tableName: "awcms_crm_follow_up_stop_signals",
      columns: ["recorded_by"],
      rationale: `An append-only stop fact about a lead (a closed kind and instants). The only tenant-user column is the staff member who recorded it. ${NO_LEAD_DATA}`
    }),
    stamps({
      key: "notifications",
      tableName: "awcms_crm_follow_up_notifications",
      columns: ["recipient_tenant_user_id"],
      rationale: `A staff notice intent: the recipient (a tenant user), a kind, instants and a closed settlement reason. ${NO_LEAD_DATA}`
    })
  ]
});
