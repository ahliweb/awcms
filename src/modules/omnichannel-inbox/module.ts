import { defineModule } from "../_shared/module-contract";
import type {
  HighVolumeTableDescriptor,
  SubjectDataDescriptor
} from "../_shared/module-contract";
import {
  CONVERSATIONS_ACTIVITY_CODE,
  OMNICHANNEL_INBOX_MODULE_KEY,
  CONSUMED_EVENT_TYPES,
  PROJECTED_EVENT_VERSIONS,
  PROJECTION_ACTIVITY_CODE,
  PROJECTOR_CONSUMER_NAME,
  SLA_POLICIES_ACTIVITY_CODE,
  TAGS_ACTIVITY_CODE
} from "./domain/inbox-constants";

function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${OMNICHANNEL_INBOX_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

/**
 * A table that answers the retention question on the record without its own
 * purge: it goes with its conversation (ON DELETE CASCADE from the purged
 * `awcms_inbox_conversations`), or it is authored configuration.
 */
function delegated(input: {
  key: string;
  tableName: string;
  cursorColumn: string;
  indexColumns: string[];
  indexPurpose: string;
  why: string;
  adopter: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    scope: "tenant",
    cursorColumn: input.cursorColumn,
    retentionClass: "system_event",
    retentionMinDays: 30,
    retentionMaxDays: 1095,
    defaultRetentionDays: 365,
    partition: {
      eligible: false,
      rationale:
        "Bounded by a tenant's conversations (or by what an administrator authors); the parent purge removes rows through the (tenant, cursor) index."
    },
    archive: { archivable: false, rationale: input.why },
    deletion: {
      mode: "hard_delete",
      rationale:
        "Removed with the conversation it belongs to (ON DELETE CASCADE), or authored configuration that is retired/soft-deleted rather than aged out."
    },
    legalHold: { applicable: false, precedence: "not_applicable" },
    requiredIndexes: [
      { columns: input.indexColumns, purpose: input.indexPurpose }
    ],
    batchLimit: 1000,
    backupRestoreNotes:
      "Included in ordinary backups. The conversation projection can be rebuilt from awcms_domain_events (POST /api/v1/omnichannel-inbox/projection/rebuild); staff work state cannot and comes back only from a backup.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef: input.adopter,
      description:
        "No age-based purge of its own; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

/**
 * `omnichannel_inbox` -- a rebuildable, body-free staff work projection over
 * verified inbound envelopes (Issue #1164, ADR-0160 `Accepted`, refining
 * ADR-0150 section 1 for staff work state only).
 *
 * ## Status
 *
 * `active`: the operator screens (`/admin/omnichannel-inbox`, its
 * `/{id}` detail and `/settings`) land with the `navigation` entry in this same
 * change (ADR-0021 criterion 1). The capability itself ships INERT: off by
 * default at the deployment (`OMNICHANNEL_INBOX_ENABLED`), module and tenant
 * level; with the switch off the routes answer `404`, the screens say so, the
 * projector does nothing and the SLA job is inert.
 */
export const omnichannelInboxModule = defineModule({
  key: OMNICHANNEL_INBOX_MODULE_KEY,
  name: "Omnichannel Inbox",
  version: "0.1.0",
  status: "active",
  description:
    "A tenant-scoped staff work queue over verified inbound envelopes (Issue #1164, ADR-0160, Accepted). A descriptor-declared consumer, run by the domain-event dispatcher as awcms_worker on column-level grants (never the assignee or the response stamps), projects awcms.telegram_engagement.interaction.received and awcms.website_engagement.submission.received / withdrawn into one conversation row per (source kind, opaque envelope reference): the account-scoped contact id or the submission id, the channel account and its business scope (brand), first/last inbound time and a customer state. Never a message body, a content reference, a sender address, a Telegram id, a name or media. awcms.telegram_engagement.consent.changed is projected but NOT subscribed (its dispatcher role may not write delivery rows): it is read back when a conversation is created and swept by the SLA job, which also re-applies website withdrawals a delivery missed. The projection is idempotent by value (a duplicate or replayed event has one effect; a customer-state change applies only if its event sequence is newer; a withdrawal is terminal) and can be rebuilt from the event log inside the retention window (365 days, the purge's only setting: there is no per-tenant override) without touching staff work state. Staff work state is authored: status (open, pending, resolved, closed; an unanswered inbound reopens a settled conversation), assignment with an append-only history, tags from a per-tenant catalogue, and first/next-response SLA in business minutes on a working calendar (IANA zone, weekday hours, holidays). Every write is optimistic-concurrency guarded; assignment and rebuild are idempotent and audited. Visibility follows channel_accounts' confinement rule: only a caller who is not scope-confined AND holds the route's permission on a tenant-wide grant sees everything (and may configure tags, the tenant default SLA policy and the rebuild); anyone else, including one whose confinement has not started yet, sees only conversations of the scopes they cover and never a tenant-wide one. An assignee must be an active user holding conversations.update tenant-wide and, if confined, an active assignment on the conversation's scope or an ancestor; the SLA job re-checks that (bounded, least recently checked first) and unassigns anyone who lost it, stamps breaches once and notifies only the assignee through the existing workflow_notification e-mail port. The inbox sends nothing to a customer and has no send facade; a reply goes through the arrival channel's own route.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "module_management",
    "domain_event_runtime",
    // A conversation carries its channel account's business scope, and the
    // confinement rules are channel_accounts' own.
    "channel_accounts"
  ],
  capabilities: {
    consumes: [
      {
        capability: "workflow_notification",
        providedBy: "email",
        optional: true
      }
    ]
  },
  type: "system",
  api: {
    openApiPath: "openapi/modules/omnichannel-inbox.openapi.yaml",
    basePath: "/api/v1/omnichannel-inbox"
  },
  domainEventConsumers: [
    {
      name: PROJECTOR_CONSUMER_NAME,
      description:
        "omnichannel_inbox consumer -- projects the verified Telegram interactions and website submissions/withdrawals into body-free conversation rows (ADR-0160). Telegram consent changes are NOT subscribed (their dispatcher role may not write delivery rows, sql/374); the SLA job sweeps them from the log. A no-op while OMNICHANNEL_INBOX_ENABLED is off or the tenant's module is off; the projection can be rebuilt from the log later.",
      eventTypes: CONSUMED_EVENT_TYPES,
      eventVersions: PROJECTED_EVENT_VERSIONS,
      handle: async (tx, event, ctx) => {
        const { isOmnichannelInboxEnabled } =
          await import("./domain/inbox-config");

        if (!isOmnichannelInboxEnabled()) return;

        const { resolveModuleEnabled } =
          await import("../identity-access/application/auth-context");

        if (
          !(await resolveModuleEnabled(
            tx,
            ctx.tenantId,
            OMNICHANNEL_INBOX_MODULE_KEY
          ))
        ) {
          return;
        }

        const { projectEvent } =
          await import("./application/conversation-projector");
        await projectEvent(tx, ctx.tenantId, {
          id: event.id,
          eventType: event.eventType,
          payload: event.payload
        });
      }
    }
  ],
  permissions: [
    {
      activityCode: CONVERSATIONS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read inbox conversations within the business scopes the caller covers: source kind, opaque references, status, assignee, tags, SLA state and the activity history (never a message body or a customer identifier)"
    },
    {
      activityCode: CONVERSATIONS_ACTIVITY_CODE,
      action: "update",
      description:
        "Change a conversation's status, its tags, and record that a response was sent through the arrival channel; also what makes a person eligible to be an assignee"
    },
    {
      activityCode: CONVERSATIONS_ACTIVITY_CODE,
      action: "assign",
      description:
        "Assign a conversation to an eligible staff member or unassign it (high-risk, Idempotency-Key, audited)"
    },
    {
      activityCode: TAGS_ACTIVITY_CODE,
      action: "configure",
      description: "Create and delete the tenant's inbox tags (audited)"
    },
    {
      activityCode: SLA_POLICIES_ACTIVITY_CODE,
      action: "read",
      description:
        "Read the tenant's inbox SLA policies (budgets, timezone, working hours, holidays)"
    },
    {
      activityCode: SLA_POLICIES_ACTIVITY_CODE,
      action: "configure",
      description:
        "Create and retire inbox SLA policies per tenant or business scope (audited at warning, Idempotency-Key)"
    },
    {
      activityCode: PROJECTION_ACTIVITY_CODE,
      action: "configure",
      description:
        "Rebuild the conversation projection by replaying the verified inbound events still inside the retention window; staff work state is never touched (high-risk, Idempotency-Key, audited at warning)"
    }
  ],
  navigation: [
    {
      labelKey: "admin.layout.nav_omnichannel_inbox",
      path: "/admin/omnichannel-inbox",
      order: 84,
      requiredPermission: "omnichannel_inbox.conversations.read"
    },
    {
      labelKey: "admin.layout.nav_omnichannel_inbox_settings",
      path: "/admin/omnichannel-inbox/settings",
      order: 85,
      requiredPermission: "omnichannel_inbox.sla_policies.read"
    }
  ],
  jobs: [
    {
      command: "bun run omnichannel-inbox:sla",
      schedule: { mode: "cron", expression: "*/5 * * * *", backlog: "bounded" },
      purpose:
        "For every active tenant with the inbox on: apply the Telegram consent changes and website withdrawals of the last 48 hours that the projection has not applied yet, unassign assignees who are no longer eligible (deactivated, permission lost, confinement no longer covering the conversation), stamp SLA breaches once and notify each affected assignee through the e-mail outbox. Database-only: no provider call.",
      recommendedSchedule: "Every five minutes via cron/systemd timer.",
      environmentNotes:
        'No-op when OMNICHANNEL_INBOX_ENABLED is not "true". Runs as awcms_app through DATABASE_URL (it reads role grants to decide eligibility and enqueues e-mail, which only the runtime role may do); it decrypts nothing. Safe offline: it never leaves the database.',
      safeInOfflineLan: true
    }
  ],
  dataLifecycle: [
    {
      key: "omnichannel_inbox.conversations",
      tableName: "awcms_inbox_conversations",
      ownerModuleKey: OMNICHANNEL_INBOX_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "last_inbound_at",
      retentionClass: "communication_log",
      retentionMinDays: 30,
      retentionMaxDays: 1095,
      // ADR-0160 section 5: proposed default for the controller to confirm.
      defaultRetentionDays: 365,
      partition: {
        eligible: false,
        rationale:
          "One row per customer conversation of a tenant's bots and website forms: thousands, not millions. The purge removes aged rows through the (tenant, last_inbound_at) index."
      },
      archive: {
        archivable: false,
        rationale:
          "The row holds opaque references and staff work state, not a record anyone must keep: the conversation itself lives in the channel modules and downstream. Archiving would only keep who-worked-what longer than the window."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Past the window a conversation that has not seen a message is stale; its activity history and tag links go with it (ON DELETE CASCADE). A rebuild replays only events inside the window, so it does not resurrect it."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "last_inbound_at"],
          purpose:
            "awcms_inbox_conversations_retention_idx (sql/382) -- the (tenant, cursor) composite the generic purge filters and orders by."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Included in ordinary backups. After a restore, the projected columns can be refreshed with the rebuild endpoint; staff work state comes back only from the backup.",
      executionMode: "generic"
    },
    delegated({
      key: "omnichannel_inbox.activity",
      tableName: "awcms_inbox_activity",
      cursorColumn: "created_at",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_inbox_activity_created_at_idx (sql/382) -- the (tenant, cursor) composite a delegated sweep would walk.",
      why: "The history of one conversation, removed with it; ids and closed codes only.",
      adopter:
        "cascade from the omnichannel_inbox.conversations generic purge (ON DELETE CASCADE, sql/382)"
    }),
    delegated({
      key: "omnichannel_inbox.conversation_tags",
      tableName: "awcms_inbox_conversation_tags",
      cursorColumn: "created_at",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_inbox_conversation_tags_created_at_idx (sql/382) -- the (tenant, cursor) composite a delegated sweep would walk.",
      why: "At most twenty links per conversation, removed with it.",
      adopter:
        "cascade from the omnichannel_inbox.conversations generic purge (ON DELETE CASCADE, sql/382)"
    }),
    delegated({
      key: "omnichannel_inbox.tags",
      tableName: "awcms_inbox_tags",
      cursorColumn: "created_at",
      indexColumns: ["tenant_id", "code"],
      indexPurpose:
        "awcms_inbox_tags_live_code_key (sql/382) -- the per-tenant catalogue an administrator authors.",
      why: "A catalogue an administrator authors; soft-deleted, never accumulated by traffic.",
      adopter:
        "none -- authored configuration, soft-deleted through DELETE /api/v1/omnichannel-inbox/tags/{id}"
    }),
    delegated({
      key: "omnichannel_inbox.sla_policies",
      tableName: "awcms_inbox_sla_policies",
      cursorColumn: "created_at",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_inbox_sla_policies_list_idx (sql/382) -- the per-tenant history an administrator authors.",
      why: "A policy is retired, never deleted, so a breach always names the terms it was measured against.",
      adopter:
        "none -- authored configuration, retired through POST /api/v1/omnichannel-inbox/sla-policies/{id}/retire"
    })
  ],
  subjectData: [
    {
      key: `${OMNICHANNEL_INBOX_MODULE_KEY}.conversations`,
      tableName: "awcms_inbox_conversations",
      ownerModuleKey: OMNICHANNEL_INBOX_MODULE_KEY,
      // The CUSTOMER has no tenant user here; the only member column is the
      // assignee, a staff stamp.
      subjectColumns: [
        { column: "assignee_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "A customer conversation's work state. The customer is reachable only through the channel module that owns the opaque reference (telegram_engagement's erase route, website_engagement's withdrawal, which closes the conversation here at once). The only tenant-member column is the staff assignee, which resolves to nobody once that identity is anonymised."
    },
    stamps({
      key: "activity",
      tableName: "awcms_inbox_activity",
      columns: ["actor_tenant_user_id", "subject_tenant_user_id"],
      rationale:
        "Who assigned, answered, tagged or changed the status of a conversation, and to whom it was assigned. Ids and closed codes only; no customer data."
    }),
    stamps({
      key: "conversation_tags",
      tableName: "awcms_inbox_conversation_tags",
      columns: ["created_by"],
      rationale: "Which staff member linked a tag to a conversation."
    }),
    stamps({
      key: "tags",
      tableName: "awcms_inbox_tags",
      columns: ["created_by", "deleted_by"],
      rationale:
        "The administrators who created or deleted a catalogue tag; the tag itself is configuration."
    }),
    stamps({
      key: "sla_policies",
      tableName: "awcms_inbox_sla_policies",
      columns: ["created_by", "retired_by"],
      rationale:
        "The administrators who created or retired an SLA policy; the policy itself is configuration."
    })
  ]
});
