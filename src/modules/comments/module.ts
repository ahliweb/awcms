import { defineModule } from "../_shared/module-contract";
import {
  COMMENTS_MODERATION_ACTIVITY_CODE,
  COMMENTS_MODULE_KEY,
  COMMENTS_SETTINGS_ACTIVITY_CODE
} from "./domain/comments-permissions";
import {
  COMMENT_APPROVED_EVENT_TYPE,
  COMMENT_SUBMITTED_EVENT_TYPE,
  REPLY_CREATED_EVENT_TYPE
} from "./domain/comment-events";

/** data_lifecycle registry keys for `comments`'s purgeable/held tables. */
export const COMMENTS_ABUSE_EVENTS_LIFECYCLE_KEY = "comments.abuse_events";
export const COMMENTS_REPLY_SUBSCRIPTIONS_LIFECYCLE_KEY =
  "comments.reply_subscriptions";
export const COMMENTS_CONTENT_LIFECYCLE_KEY = "comments.comments";

/**
 * `comments` — admitted by ADR-0041, ported from awcms-micro Issue #271 as a
 * Gelombang-1 row of `docs/awcms/absorb-awcms-micro-roadmap.md`. Admission and
 * the first runtime code land together, taking the base registry 20 → 21.
 *
 * ## What this module OWNS
 *
 * A tenant-scoped, MODERATION-FIRST commenting system over PUBLISHED, PUBLIC
 * commentable resources — threads (`awcms_comments_threads`), comments
 * (`awcms_comments_comments`, `sql/066`, RLS FORCE'd, bounded reply depth,
 * privacy-minimized author fields), append-only moderation history + abuse
 * reports, per-tenant settings, minimized anti-abuse telemetry, and minimized,
 * encrypted reply-notify subscriptions. It serves the PUBLIC submit/list/reply/
 * edit/report/delete-request API and the ABAC-guarded, audited admin moderation
 * API under `/api/v1/comments/*`.
 *
 * ## Direction of the arrow (ADR-0041 §2) — depends on nothing but Core
 *
 * `comments` is the CONSUMER/aggregator: content modules PROVIDE reviewed,
 * pure-data `CommentableResourceDescriptor`s via
 * `ModuleDescriptor.commentableResources` (declarative table/column mapping +
 * publication filter — never an executable extractor), which this module's
 * generic engine reads through `listModules()`. It does NOT declare a
 * `commentable_resource` capability `provides` (that would trip
 * `capability_provider_conflict`) — the descriptor-list riding `listModules()` is
 * the multi-provider, derived-safe seam (`site_search`/`reporting` precedent). No
 * existing module depends on `comments`, and its lifecycle `dependencies` are ONLY
 * the two Core modules, so the DAG is a clean inward leaf.
 *
 * ## Email is CONSUMED via events/outbox, not a hard dependency (ADR-0041 §4)
 *
 * Reply notifications are published as domain events (`domain_event_runtime`
 * outbox, same-commit, ADR-0006); an email dispatcher (documented follow-up
 * consumer) resolves the ENCRYPTED, minimized recipient at send time, OUTSIDE any
 * DB transaction. Recipient addresses are NEVER carried in an event/response/log.
 *
 * ## Security spine (ADR-0041 threat model)
 *
 * Publication-state is enforced at the resource→thread boundary (a comment is
 * only ever accepted/shown against a PUBLISHED, PUBLIC resource); every query is
 * tenant + resource scoped (RLS FORCE + explicit predicates); comment bodies are
 * stored as raw plain text and HTML-escaped on render (no stored HTML → no stored
 * XSS), with only safe http(s) autolinks (`rel="nofollow ugc noopener
 * noreferrer"`); the public list returns approved-only rows with NO moderation
 * metadata; anti-abuse (honeypot, timing floor, blocked terms, duplicate
 * fingerprint, per-IP rate limits; Turnstile is a stored setting, not yet
 * enforced) runs server-side; author contact data is minimized (sha256 hash + mask, never raw).
 */
export const commentsModule = defineModule({
  key: COMMENTS_MODULE_KEY,
  name: "Comments",
  version: "0.1.0",
  status: "active",
  description:
    "Tenant-scoped, MODERATION-FIRST commenting over PUBLISHED, PUBLIC commentable resources (ADR-0041, ported from awcms-micro Issue #271). Owns threads, bounded-depth comments (sql/066 — RLS FORCE'd, privacy-minimized author fields: sha256 email hash + mask, hashed ip/ua, never raw), append-only moderation history + abuse reports, per-tenant settings, minimized anti-abuse telemetry, and minimized/encrypted double-opt-in reply-notify subscriptions. It is the CONSUMER/aggregator of reviewed, pure-data `CommentableResourceDescriptor`s that content modules declare via `ModuleDescriptor.commentableResources` (declarative table/column mapping + declarative publication filter — never an executable extractor or tenant SQL); the generic engine reads them through `listModules()`, so any content module's resources can accept comments without this module knowing any specific one and without a content module depending on `comments`. A comment is only ever accepted or shown against a resource that satisfies its source's declarative publicationFilter, so a draft/private/deleted/scheduled resource never receives or exposes comments. Comment bodies are stored as raw plain text and HTML-escaped on render (no stored HTML → no stored XSS), permitting only safe http(s) autolinks with rel=\"nofollow ugc noopener noreferrer\". The public list returns approved-only rows and NEVER moderation metadata (reason codes/actor/hashes). Anti-abuse is server-side: honeypot, submit-timing floor, per-comment link/length bounds, configurable blocked terms, duplicate fingerprinting, and per-IP rate limits. `turnstileEnabled` is PERSISTED as a tenant setting but NOT yet enforced on the submit path — wiring it is a documented follow-up, and the verification call must run OUTSIDE any DB transaction when it lands (ADR-0006). The admin moderation API (queue, approve/reject/spam, archive/restore/delete, bulk, settings) is ABAC-guarded, audited with reason codes, idempotency-keyed on high-risk mutations, and observable. Reply notifications go through the domain-event outbox with address-free payloads; the email dispatcher resolves the encrypted recipient at send time. Soft delete + append-only history + a legal-hold-aware retention/anonymization sweep (`bun run comments:retention`) keep content coherent and privacy-minimized. The commenting surface is never an authorization source for the underlying resource.",
  // Three of these were imported without being declared until 2026-07-26
  // (`tests/module-boundary.test.ts` now catches that class):
  //   `domain_event_runtime` — reply notifications go through the outbox
  //     (`application/reply-notifications.ts`), so the runtime must be present.
  //   `module_management`    — the public route gates on `fetchTenantModuleEntry`
  //     to confirm this module is enabled for the tenant before serving.
  //   `profile_identity`     — `application/comment-service.ts` resolves the
  //     commenter's profile.
  // None introduces a cycle: all three depend only on `tenant_admin`/
  // `identity_access`/`logging` and none references `comments`.
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "profile_identity",
    "domain_event_runtime"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/comments.openapi.yaml",
    basePath: "/api/v1/comments"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      COMMENT_SUBMITTED_EVENT_TYPE,
      COMMENT_APPROVED_EVENT_TYPE,
      REPLY_CREATED_EVENT_TYPE
    ]
  },
  navigation: [
    {
      // `labelKey` is now genuinely rendered: `AdminLayout.astro` builds the
      // sidebar from `listModules()` via
      // `module-management/domain/sidebar-menu.ts`, and the key resolves
      // through `SIDEBAR_LABELS` there. The previous note here — "the sidebar
      // entry is added there by hand. Both must be kept in step" — described
      // the drift accurately; keeping two lists in step by hand is what let
      // three sibling modules ship nav entries pointing at 404s.
      //
      // `group: "content"` was dropped rather than corrected. `comments` sits
      // in `DEFAULT_MODULE_TYPE` as `engagement`, and that map wins over
      // `group`, so the value could never take effect.
      labelKey: "admin.layout.nav_comments",
      path: "/admin/comments",
      order: 60,
      requiredPermission: "comments.moderation.read"
    }
  ],
  permissions: [
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's comment moderation queue (pending/reported/rejected/spam), search and filter by status"
    },
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "approve",
      description:
        "Approve a pending comment so it is shown publicly — high-risk, idempotency-keyed, audited"
    },
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "reject",
      description:
        "Reject a comment or mark it as spam (deny publication) — reason code required, audited"
    },
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "archive",
      description:
        "Archive an approved comment (remove from public view, retain for history) — audited"
    },
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "restore",
      description:
        "Restore a rejected/spam/archived comment back to pending review — high-risk, audited"
    },
    {
      activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
      action: "delete",
      description:
        "Soft-delete a comment (retain the row, remove content from public view) — high-risk, audited"
    },
    {
      activityCode: COMMENTS_SETTINGS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's comment configuration (policy mode, moderation, anti-abuse thresholds, blocked terms)"
    },
    {
      activityCode: COMMENTS_SETTINGS_ACTIVITY_CODE,
      action: "update",
      description:
        "Update this tenant's comment configuration — changes the public comment surface (high-risk, audited)"
    }
  ],
  jobs: [
    {
      command: "bun run comments:retention",
      schedule: {
        mode: "cron",
        expression: "0 4 * * *",
        backlog: "bounded"
      },
      purpose:
        "Bounded, per-tenant retention/anonymization sweep: NULL author identity fields on comments older than the retention cutoff (retaining row + body + append-only moderation history), and delete unconfirmed reply subscriptions past the confirmation window. Skips a tenant whose comment content descriptor is under an active legal hold (legal hold overrides retention).",
      recommendedSchedule: "daily (off-peak)",
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094 wave 2 (Issue #557).
   *
   * The module with the most personal data per row in the whole base, and the
   * only one where the subject is frequently NOT a tenant user at all: a guest
   * commenter is identified by a hashed email and a hashed IP. ADR-0094 answers
   * per tenant user, so those rows are honestly out of reach here — each
   * descriptor says so rather than implying a coverage it does not have.
   */
  subjectData: [
    {
      key: "comments.comments",
      tableName: "awcms_comments_comments",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      subjectColumns: [{ column: "author_user_id", references: "tenant_user" }],
      exportable: true,
      // `author_display_name`, `author_email_masked` and `author_ip_hash` are
      // copied onto the comment at write time, so severing the identity leaves
      // the person's name sitting under their published words.
      erasure: "anonymize",
      rationale:
        "What this person wrote publicly, with the name, masked address and hashed IP captured alongside it. Their own words are theirs to export; the comment itself survives erasure with the author detached, because deleting a thread's replies would rewrite a conversation other people took part in. A comment left by a GUEST carries no tenant-user id and cannot be reached from a per-tenant subject request — ADR-0094 gives a non-member no request to make.",
      redactedColumns: ["author_email_hash", "author_ip_hash"]
    },
    {
      key: "comments.moderation_events",
      tableName: "awcms_comments_moderation_events",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      subjectColumns: [{ column: "actor_user_id", references: "tenant_user" }],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Moderation decisions this person made: what they approved, hid or removed, and the note they wrote. Held as their action rather than as content about them, and carrying nothing beyond their id."
    },
    {
      key: "comments.reports",
      tableName: "awcms_comments_reports",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      // Reporters are identified by hashed email and hashed IP only — by
      // design, so a moderator cannot read who reported whom. That design is
      // exactly what puts the rows beyond a per-tenant subject request.
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Abuse reports, deliberately pseudonymous: a report stores only a hash of the reporter's address and IP, with no tenant-user id, so no subject request can be matched to one. Retained rather than erased because the rows are the evidence behind a moderation decision, and because there is no key by which to find the right ones — a state the module owns and this descriptor states instead of implying coverage.",
      redactedColumns: ["reporter_email_hash", "reporter_ip_hash"]
    },
    {
      key: "comments.abuse_events",
      tableName: "awcms_comments_abuse_events",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Rate-limit and abuse telemetry keyed by hashed IP and a browser fingerprint hash, with no account link at all. Kept as the anti-abuse record it is; there is no column by which a subject could be found, and inventing one would mean attaching identity to traffic that was deliberately never attached.",
      redactedColumns: ["ip_hash", "fingerprint_hash"]
    },
    {
      key: "comments.reply_subscriptions",
      tableName: "awcms_comments_reply_subscriptions",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Reply notifications, addressed by an encrypted email and keyed by its hash rather than by an account — a subscriber need never have signed in. Unsubscribing is the in-band control for these rows and every notification carries the link; a per-tenant subject request has no id to match them on.",
      redactedColumns: [
        "subscriber_email_hash",
        "subscriber_email_encrypted",
        "unsubscribe_token_hash"
      ]
    },
    {
      key: "comments.settings",
      tableName: "awcms_comments_settings",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "One row of tenant-wide comment policy. The subject appears only as the administrator who last changed it."
    },
    {
      key: "comments.threads",
      tableName: "awcms_comments_threads",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A thread is the page comments hang from — a resource reference, a locale and counters. It holds no person at all; the people are in `comments.comments`, and the thread must outlive any one of them or their replies lose the conversation they belong to."
    }
  ],
  dataLifecycle: [
    {
      key: COMMENTS_ABUSE_EVENTS_LIFECYCLE_KEY,
      tableName: "awcms_comments_abuse_events",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "occurred_at",
      retentionClass: "system_event",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Minimized anti-abuse telemetry (ip/fingerprint HASHES + reason + counts only), written only on a blocked submission — volume is bounded by abuse attempts. A short retention window plus the (tenant, occurred_at) index keeps the age-based purge cheap without partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Privacy-first, minimized telemetry (hashes only, no raw PII). Retaining it longer via an archive would work against the module's own privacy posture; it is simply purged when stale."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "A straight age-based DELETE of stale abuse-telemetry rows — no soft-delete lifecycle, nothing references these rows once purged."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "occurred_at"],
          purpose:
            "awcms_comments_abuse_events_tenant_occurred_idx (sql/066) — the (tenant, cursor) composite the generic purge engine filters + orders by for its bounded age-based DELETE."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "No special backup/restore implications: minimized, derived, purgeable telemetry. A restore that omits this table loses only historical abuse counters.",
      executionMode: "generic"
    },
    {
      key: COMMENTS_REPLY_SUBSCRIPTIONS_LIFECYCLE_KEY,
      tableName: "awcms_comments_reply_subscriptions",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "communication_log",
      retentionMinDays: 90,
      retentionMaxDays: 1095,
      defaultRetentionDays: 365,
      partition: {
        eligible: false,
        rationale:
          "Opt-in reply-notify pointers (email HASH + encrypted reference), bounded by opted-in commenters. A moderate retention window plus the (tenant, created_at) index keeps the age-based purge cheap without partitioning. The comments:retention job separately deletes UNCONFIRMED subscriptions early; this generic purge ages out long-stale confirmed ones."
      },
      archive: {
        archivable: false,
        rationale:
          "Minimized, encrypted notify pointers — never a durable archive candidate (retaining a recipient reference longer would work against the module's privacy posture)."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "An age-based DELETE of long-stale subscriptions — deleting one only stops future reply notifications; nothing references the row afterward."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_comments_reply_subscriptions_created_idx (sql/066) — the (tenant, cursor) composite the generic purge engine filters + orders by."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "No special implications: minimized, purgeable opt-in pointers. A restore that omits this table loses only pending reply-notify opt-ins.",
      executionMode: "generic"
    },
    {
      key: COMMENTS_CONTENT_LIFECYCLE_KEY,
      tableName: "awcms_comments_comments",
      ownerModuleKey: COMMENTS_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "communication_log",
      retentionMinDays: 90,
      retentionMaxDays: 3650,
      defaultRetentionDays: 365,
      partition: {
        eligible: false,
        rationale:
          "User-generated content with an append-only moderation history and soft-delete lifecycle — updated in place (status transitions, edits), so it is NOT a safe age-based range-partition candidate. Retention here is anonymization (NULL author identity), not row deletion, owned by the comments:retention job."
      },
      archive: {
        archivable: false,
        rationale:
          "Comment content stays in the primary store for its lifetime; retention minimizes author PII in place rather than exporting an archive artifact."
      },
      deletion: {
        mode: "anonymize",
        rationale:
          "The retention sweep NULLs author identity fields on aged comments (retaining the row + body + moderation history) — a privacy minimization, never a hard delete, so threads/history stay coherent. Soft delete (status='deleted') is a separate moderator/author action, also non-destructive."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "created_at"],
          purpose:
            "awcms_comments_comments_status_created_idx (sql/066) — supports the moderation queue and the retention sweep's aged-candidate scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact (archive.archivable is false). A restore reinstates content in its last-persisted moderation/anonymization state.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run comments:retention",
        purgeFunctionRef:
          "src/modules/comments/application/comment-retention.ts#anonymizeAgedComments",
        description:
          "Anonymizes (NULLs author identity on) comments older than COMMENTS_RETENTION_DAYS (default 365d) in bounded batches, skipping a tenant under an active legal hold on this descriptor. data_lifecycle may read this table for dry-run counts (read-only); the retention job owns all mutation."
      }
    }
  ]
});
