/**
 * `social_publishing` -- account-scoped publication intents and per-account
 * publish jobs behind the existing `SocialPublishingPort` (Issue #1145,
 * ADR-0157, ADR-0148 capability C3).
 */
import { defineModule } from "../_shared/module-contract";
import type { SubjectDataDescriptor } from "../_shared/module-contract";
import {
  SOCIAL_JOB_FAILED_EVENT_TYPE,
  SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
  SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
  SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
  SOCIAL_PUBLISHING_MODULE_KEY
} from "./domain/social-publishing-constants";

/** Tenant-user stamps only: the row says nothing ABOUT a person, so anonymising the identity makes each stamp resolve to nobody (ADR-0094). */
function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${SOCIAL_PUBLISHING_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

export const socialPublishingModule = defineModule({
  key: SOCIAL_PUBLISHING_MODULE_KEY,
  name: "Social Publishing",
  version: "0.1.0",
  /**
   * `experimental`: the operator screen is a recorded follow-up and ADR-0021
   * criterion 1 asks every ACTIVE module for an admin screen. No `navigation`
   * entry until that screen lands in the same change (a nav entry without a
   * page is a permanent 404). The API is complete.
   */
  status: "experimental",
  description:
    "Account-scoped social publishing (Issue #1145, ADR-0157, ADR-0148 capability C3) behind the existing `SocialPublishingPort` that `blog_content` calls when an article is published. One publication (an immutable content snapshot: text, link and a media object verified through `media_library` for type, size and rights status) fans out to ONE JOB PER TARGET `channel_account`, idempotent per (article, trigger, account) by a unique key; a job names the account and holds no token and no secret reference, because the dispatcher resolves the credential for that account at dispatch time through the dispatcher-only `ChannelPublisherCredentialPort`. A tenant can require approval (the default; a manual publication cannot be approved by its creator) and schedule a publication. Provider adapters are plug-ins behind a `SocialPublishAdapter` interface with a per-provider capability map that is a CEILING and never a grant: content the map cannot carry is REFUSED, never downgraded, and an account still needs a granted `publish` capability with evidence, a connected account and an active connection, re-checked at enqueue and at dispatch (revoked or disabled fails the job, degraded or expired holds it, nothing is ever rerouted to another account or provider). The dispatcher claims with a lease, enforces fair share and a per-account daily cap under an advisory lock, calls the provider OUTSIDE any transaction through an `ssrfSafeFetch` client with a timeout and a per-account circuit breaker, and finalises with a compare-and-set; a published job is terminal (database trigger), so a partial failure of a sibling never replays it and never alters the source article. Ships with NO real provider adapter (connectors are #1146 to #1151, each with its own provider approval): until one registers, enabling the module publishes nothing. Off by default (SOCIAL_PUBLISHING_ENABLED); the composition roots swap `blog_content`'s no-op adapter for the real one only when it is on, and each tenant also opts in (auto_publish_enabled, default false).",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "domain_event_runtime"
  ],
  type: "system",
  capabilities: {
    provides: ["social_publishing"],
    // Soft edges, NOT `dependencies`: switching `channel_accounts` or
    // `media_library` off must not strand a tenant's queue or break an article's
    // publication. `channel_accounts` is loaded lazily
    // (`infrastructure/channel-account-port-loader.ts`); the credential adapter is
    // composed only by `scripts/social-publishing-dispatch.ts`.
    consumes: [
      {
        capability: "channel_account",
        providedBy: "channel_accounts",
        optional: true
      },
      {
        capability: "media_library",
        providedBy: "media_library",
        optional: true
      }
    ]
  },
  api: {
    openApiPath: "openapi/modules/social-publishing.openapi.yaml",
    basePath: "/api/v1/social-publishing"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
      SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
      SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
      SOCIAL_JOB_FAILED_EVENT_TYPE
    ],
    subscribes: []
  },
  /**
   * Nine permissions, every one enforced by an endpoint added in the same change
   * and seeded by `sql/331`. Using an account is additionally gated by the
   * per-account access of `channel_accounts`.
   */
  permissions: [
    {
      activityCode: "publications",
      action: "read",
      description:
        "Read this tenant's social publications, their per-account jobs and derived status (never a credential)"
    },
    {
      activityCode: "publications",
      action: "publish",
      description:
        "Create a social publication for chosen connected accounts, now or at a scheduled time (high-risk, audited at warning)"
    },
    {
      activityCode: "publications",
      action: "schedule",
      description:
        "Change when a social publication that has not been dispatched goes out (high-risk, audited)"
    },
    {
      activityCode: "publications",
      action: "approve",
      description:
        "Approve a social publication that is waiting for approval; the creator cannot approve their own (high-risk, audited at warning)"
    },
    {
      activityCode: "publications",
      action: "cancel",
      description:
        "Cancel a social publication; jobs already published are untouched (high-risk, audited)"
    },
    {
      activityCode: "jobs",
      action: "retry",
      description:
        "Retry one failed per-account social publish job; a published job can never be retried (audited)"
    },
    {
      activityCode: "rules",
      action: "read",
      description:
        "Read the social publish rules and this tenant's social publishing settings"
    },
    {
      activityCode: "rules",
      action: "configure",
      description:
        "Add, enable or disable the rule that publishes an article event to a connected account (high-risk, audited at warning)"
    },
    {
      activityCode: "settings",
      action: "configure",
      description:
        "Switch automatic publishing and the approval requirement for this tenant (high-risk, audited at warning)"
    }
  ],
  jobs: [
    {
      command: "bun run social-publishing:dispatch",
      schedule: {
        mode: "cron",
        expression: "*/2 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Drain the due social publish queue (claim lease, per-account fair share and daily cap, account re-check, provider call outside any transaction, retry/backoff, per-account circuit breaker) for every active tenant.",
      recommendedSchedule: "Every 2 minutes via cron/systemd timer.",
      environmentNotes:
        'No-op when SOCIAL_PUBLISHING_ENABLED is not "true" and publishes nothing until a provider adapter is registered. Holds CHANNEL_SECRETS_ENCRYPTION_KEYS (job-scoped) to decrypt a tenant-owned account credential in memory for the call. Requires outbound HTTPS to the providers; on an offline/LAN deployment it stays a no-op.',
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094. The module records WHO composed, approved or cancelled a
   * publication and who configured a rule; it says nothing about the person.
   * Anonymising the identity makes each stamp resolve to nobody. The content is
   * the tenant's own public communication, not data about a person.
   */
  subjectData: [
    stamps({
      key: "settings",
      tableName: "awcms_social_publishing_settings",
      columns: ["updated_by"],
      rationale:
        "Two tenant switches. The only person-shaped column is the stamp of the administrator who last changed them."
    }),
    stamps({
      key: "rules",
      tableName: "awcms_social_publish_rules",
      columns: ["created_by", "updated_by"],
      rationale:
        "Which connected account an article event publishes to. The only person-shaped columns are the stamps of the administrators who added or changed the rule."
    }),
    stamps({
      key: "publications",
      tableName: "awcms_social_publications",
      columns: ["created_by", "approved_by", "cancelled_by"],
      rationale:
        "A publication the tenant composed for its own public social accounts: an immutable snapshot of content the tenant chose to publish. It is not data about a person; its only person-shaped columns are the stamps of who composed, approved or cancelled it, which resolve to nobody once that identity is anonymised."
    }),
    stamps({
      key: "jobs",
      tableName: "awcms_social_publish_jobs",
      columns: ["created_by"],
      rationale:
        "One publish job per target account. It names an account and the provider's post id; the only person-shaped column is the stamp of the person who composed the publication."
    }),
    {
      key: `${SOCIAL_PUBLISHING_MODULE_KEY}.attempts`,
      tableName: "awcms_social_publish_attempts",
      ownerModuleKey: SOCIAL_PUBLISHING_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-attempt outcome of a job: an outcome word, a fixed code and a fixed phrase. No column names a person and none holds a caption, a provider body or a credential, so there is nothing to export or anonymise."
    }
  ]
});
