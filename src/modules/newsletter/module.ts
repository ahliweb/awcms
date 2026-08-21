import { defineModule } from "../_shared/module-contract";
import {
  NEWSLETTER_ACTIVITY_CODE,
  NEWSLETTER_MODULE_KEY
} from "./domain/newsletter-permissions";

/**
 * `newsletter` — a reader can join a list (Issue #598, ADR-0103).
 *
 * ## Why this is not part of `email`
 *
 * That module can SEND: templates, an outbox with lease claiming, retry,
 * backoff, a circuit breaker, per-address suppression. What it answers is "may
 * this address be written to, and did the message arrive" — an OPERATIONAL
 * question about deliverability.
 *
 * A subscription answers a different one: "did a person ask for this, when, from
 * where, and can they prove they stopped asking". That is a question about
 * CONSENT, and its record has to survive independently of whether any message
 * was ever sent.
 *
 * Folding them together would make `awcms_email_suppressions` mean both "this
 * address bounced" and "this person withdrew consent" — the first an operational
 * fact an operator may clear, the second a decision they must not. One word
 * covering two things, where the half that ends up wrong is the legal one.
 *
 * ## Three anonymous endpoints, and none of them says anything
 *
 * Subscribe, confirm and unsubscribe are all public. Each answers the same
 * neutral body for every outcome, so none can be used to ask "is this person on
 * this newsroom's list". The tenant is resolved from the request HOST rather
 * than a header, so a caller cannot choose whose list they are writing to.
 *
 * `email` is a dependency because the confirmation mail goes through its outbox.
 * The arrow points one way: `email` knows nothing about subscriptions.
 */
export const newsletterModule = defineModule({
  key: NEWSLETTER_MODULE_KEY,
  name: "Newsletter",
  version: "0.1.0",
  status: "active",
  description:
    "Per-tenant newsletter subscriber list (Issue #598, ADR-0103, PRD §22/§30, FR-NWL-002/004/005). The `email` module could already SEND mail — templates, outbox, retry, circuit breaker, suppression — and there was no list a reader could join: no subscriber table, no endpoint anyone could POST to, no double opt-in, no unsubscribe, no admin screen. The legacy portal has all of it and is live, so migrating a second tenant without this would be a functional regression rather than a gap. Four lifecycle states, and the fourth is not the third: `pending` -> `active` with `unsubscribed` and `suppressed` as terminal branches, kept apart because re-subscribing is allowed from one and not the other — somebody who unsubscribed in March may sign up again in June, while an address suppressed for abuse must not be re-addable by whoever is abusing it. Double opt-in: `consent_at` is written when the confirmation link is FOLLOWED, never at submission, so the record says what happened. Both the confirmation and unsubscribe tokens are stored HASHED because both are bearer credentials, and the unsubscribe token is stable for the row's lifetime because it is printed in the footer of every message the subscriber will ever receive. The three public endpoints are anonymous, per-IP rate-limited, and answer the SAME neutral body for every outcome — a new address, an already-active one, a suppressed one, an unresolved tenant — because a distinguishing response turns a public endpoint into a way to ask whether a named person subscribes to a particular newsroom. Idempotency (FR-NWL-005) rests on the unique index over `(tenant_id, email_normalized)` and a single ON CONFLICT statement, not on a read-then-write two concurrent submissions could interleave with. Unsubscribing takes the token and nothing else — no session, no tenant header, no address (PRD §30) — and keeps the row, because 'this person asked to stop on this date' is what answers a later complaint; subject-rights erasure is the different request that removes it.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "email",
    // `profile_identity` for `normalizeIdentifierValue`/`maskIdentifierValue`
    // only. The SAME normalizer the identity module uses, deliberately: an
    // address that is one person there must be one subscriber here, and a second
    // lower-casing rule would eventually disagree with the first. The masker is
    // what keeps an audit row from becoming a second copy of the list.
    "profile_identity"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/newsletter.openapi.yaml",
    basePath: "/api/v1/newsletter"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_newsletter",
      path: "/admin/newsletter",
      order: 71,
      requiredPermission: "newsletter.subscribers.read"
    }
  ],
  permissions: [
    {
      activityCode: NEWSLETTER_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's newsletter subscriber list and its status counts"
    },
    {
      activityCode: NEWSLETTER_ACTIVITY_CODE,
      action: "configure",
      description: "Suppress a subscriber, or remove one at their request"
    }
  ],
  dataLifecycle: [
    {
      key: "newsletter.subscribers",
      tableName: "awcms_newsletter_subscribers",
      ownerModuleKey: NEWSLETTER_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "communication_log",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "A tenant's subscriber list is thousands of rows, not millions, and the purge below touches only the unconfirmed slice of it. Partitioning would add operational surface to a table whose whole point is that it stays small enough to read."
      },
      archive: {
        archivable: false,
        rationale:
          "The rows this retention removes are `pending` — a request somebody started and never finished. Archiving an address nobody consented to would be keeping exactly what the purge exists to stop keeping."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "An unconfirmed subscription is not a record of anything that happened; it is a record of something that did not. `active`, `unsubscribed` and `suppressed` rows are NEVER touched by this — an unsubscribe record is what answers a later complaint, and a suppression is a decision that must outlive the address."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_newsletter_subscribers_created_at_idx (sql/139) — the (tenant, cursor) composite the generic purge engine filters and orders by."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "A restore that omits this table loses the subscriber list, including the record of who unsubscribed — which is the half that matters legally. It is small; back it up.",
      executionMode: "generic"
    }
  ],
  subjectData: [
    {
      key: "newsletter.subscribers",
      tableName: "awcms_newsletter_subscribers",
      ownerModuleKey: NEWSLETTER_MODULE_KEY,
      // A subscriber has no account, no session and no tenant membership, so
      // there is no `tenant_user_id` to reach them by. ADR-0094 scopes a subject
      // request to a MEMBER, and a subscriber is not one — which is why this is
      // declared unreachable rather than given a column that does not exist.
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "An email address, the moment consent was given, and the moment it was withdrawn. Personal data, and the reason it is retained rather than erased on request is the same reason it is kept at all: the unsubscribe record is what proves a person asked to stop. A subscriber who wants the row gone asks through the unsubscribe link and then through the tenant, which is the path that also stops the mail.",
      redactedColumns: [
        "confirmation_token_hash",
        "unsubscribe_token_hash",
        "consent_ip_hash"
      ]
    }
  ]
});
