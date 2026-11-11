import { defineModule } from "../_shared/module-contract";
import type { SubjectDataDescriptor } from "../_shared/module-contract";
import {
  SOURCES_ACTIVITY_CODE,
  SUBMISSIONS_ACTIVITY_CODE,
  WEBSITE_ENGAGEMENT_MODULE_KEY,
  WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
  WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE
} from "./domain/website-engagement-constants";

function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${WEBSITE_ENGAGEMENT_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
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
 * `website_engagement` -- tenant-scoped website lead/contact capture and inbound
 * website interaction events (Issue #1153, ADR-0155). INTAKE ONLY.
 *
 * ## What it is not
 *
 * Not a CRM, not a lead pipeline, not a forms engine and not a chat widget. It
 * creates, matches and merges no person (ADR-0148 I7); stages, owners, scoring,
 * deduplication and conversion are downstream (`awcms-one`, ADR-0153). The
 * embeddable widget was assessed and NOT built: see docs/awcms/website-engagement.md
 * section "Widget decision".
 *
 * ## Status
 *
 * `experimental`: ADR-0021 criterion 1 asks every ACTIVE module for an admin
 * screen, and the operator screen is a follow-up. The module therefore declares
 * no `navigation` entry (a nav entry without a page is a permanent 404); the API
 * is complete and every admin route is default-deny.
 */
export const websiteEngagementModule = defineModule({
  key: WEBSITE_ENGAGEMENT_MODULE_KEY,
  name: "Website Engagement",
  version: "0.1.0",
  status: "experimental",
  description:
    "Tenant-scoped website lead/contact capture and inbound website interaction events (Issue #1153, ADR-0155). A website posts a contact request, a lead or an interaction to ONE public, unauthenticated endpoint that is authenticated by an opaque per-source token (stored only as a keyed hash, shown once, rotatable, revocable; the tenant is opened FROM the token and a tenant id in the body or query is never believed) and by the request's verified Origin host against the domains registered for that source; rate-limited per address and per source, behind an optional Turnstile challenge that falls back visibly to token, Origin, honeypot, fill-time and rate limit on offline/LAN, validated against a closed versioned field set (no HTML, no upload, no URL fetch), idempotent on (source, eventId), and stored with explicit consent provenance (a separate, never-implied marketing purpose against the exact consent copy version shown) and source attribution. A visitor's contact details are one AES-256-GCM envelope plus keyed hashes and masked projections, never an IP, fingerprint or cookie. The only outward surface is an outbox event carrying an opaque submission reference; a CRM adapter reads details through the audited reveal endpoint under its own permission. Withdrawal by the controller emits a withdrawal event downstream must honour; retention is declared on day one through data_lifecycle. It creates, matches and merges no person.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "module_management",
    // The ADR-0155 section 3 provenance check is against domains registered in
    // `tenant_domain`; a source lists `awcms_tenant_domains` rows.
    "tenant_domain",
    // The outbox: the submission and its event commit in one transaction.
    "domain_event_runtime",
    // `normalizeIdentifierValue` / `maskIdentifierValue` only: the SAME
    // normalizer the identity module uses, so an address that is one person
    // there is one hash here.
    "profile_identity"
  ],
  type: "system",
  api: {
    openApiPath: "openapi/modules/website-engagement.openapi.yaml",
    basePath: "/api/v1/website-engagement"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
      WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE
    ]
  },
  permissions: [
    {
      activityCode: SOURCES_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's website sources (name, status, hosts, consent copy version, challenge mode and the non-sensitive token prefix; never the token)"
    },
    {
      activityCode: SOURCES_ACTIVITY_CODE,
      action: "manage",
      description:
        "Create, change, pause, revoke and delete a website source, edit the hosts it accepts, and rotate its token. The token is shown once (high-risk, audited at warning)"
    },
    {
      activityCode: SUBMISSIONS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read website submissions with masked contact details, consent provenance and source attribution"
    },
    {
      activityCode: SUBMISSIONS_ACTIVITY_CODE,
      action: "reveal",
      description:
        "Decrypt and read a submission's contact details and message. Every reveal is audited (high-risk, audited at warning)"
    },
    {
      activityCode: SUBMISSIONS_ACTIVITY_CODE,
      action: "withdraw",
      description:
        "Withdraw a submission at the data subject's request or on a consent withdrawal, and announce the withdrawal to downstream consumers (audited at warning)"
    }
  ],
  dataLifecycle: [
    {
      key: "website_engagement.submissions",
      tableName: "awcms_engagement_submissions",
      ownerModuleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "received_at",
      retentionClass: "communication_log",
      retentionMinDays: 30,
      retentionMaxDays: 730,
      // ADR-0155 section 5: a proposed default for the maintainer to confirm;
      // the controller (the tenant) sets the final window within these bounds.
      defaultRetentionDays: 180,
      partition: {
        eligible: false,
        rationale:
          "A tenant's website submissions are inquiries a person reads, not telemetry: hundreds to low thousands a month. The purge removes aged rows through the (tenant, received_at) index; partitioning would add operational surface to a table that stays small."
      },
      archive: {
        archivable: false,
        rationale:
          "The rows are a visitor's own words and identifiers, held under their consent for a stated purpose. Archiving them would keep personal data beyond the window the controller set, which is exactly what retention exists to stop; the downstream CRM, not this intake, is where a lead that became a customer is kept."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Once the retention window passes, the consent that justified holding the contact details has lapsed. The outbox event carries only an opaque reference, so nothing else needs the row. A withdrawn submission is removed by the same purge; withdrawal marks it and stops downstream use immediately."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "received_at"],
          purpose:
            "awcms_engagement_submissions_received_at_idx (sql/325) -- the (tenant, cursor) composite the generic purge engine filters and orders by."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "A restore without the WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS ring (every key id the restored rows carry) keeps the rows but cannot decrypt contact details (fail closed; masked reads still work); without the WEBSITE_ENGAGEMENT_HASH_KEYS ring (or, for tokens hashed before Issue #1262, WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS) no source token verifies. Back both rings up OUTSIDE the database. A restore must not resurrect rows past their retention window: run the retention purge after restoring.",
      executionMode: "generic"
    }
  ],
  subjectData: [
    stamps({
      key: "sources",
      tableName: "awcms_engagement_sources",
      columns: ["created_by", "updated_by", "deleted_by"],
      rationale:
        "A tenant's website/form channel. The row describes a website, not a person; its only person-shaped columns are the stamps of the administrators who created, changed or deleted it. The token is stored only as a keyed hash and is never exported."
    }),
    stamps({
      key: "source_domains",
      tableName: "awcms_engagement_source_domains",
      columns: ["created_by"],
      rationale:
        "Which tenant domains a source accepts submissions from. The only person-shaped column is the stamp of the administrator who linked it."
    }),
    {
      key: "website_engagement.submissions",
      tableName: "awcms_engagement_submissions",
      ownerModuleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
      // A website visitor has no account, no session and no tenant membership,
      // so there is no `tenant_user_id` to reach them by. ADR-0094 scopes a
      // subject request to a MEMBER; a visitor is not one. The visitor is
      // reachable only through the keyed email/phone hashes, which a controller
      // uses with the withdraw endpoint, not through this registry.
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "What a visitor typed into a website form, held under the explicit consent recorded on the same row (the purpose, the exact consent copy version, the page and the moment). Personal data, and `retain_under_obligation` here means 'until the controller-set retention window, or a withdrawal by the controller which stops downstream use at once': the registry cannot find a visitor by tenant user, so a subject request is answered by the controller through the keyed email/phone hashes and the withdraw endpoint, then removed by retention.",
      redactedColumns: [
        "contact_encrypted",
        "email_hash",
        "phone_hash",
        "email_masked",
        "phone_masked"
      ]
    }
  ]
});
