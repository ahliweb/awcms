/**
 * The CLOSED vocabulary of free-text values the social dispatcher writes as
 * `awcms_social_dispatch` (the #1145 credential-path review, L1).
 *
 * A column grant says WHICH columns the role may write, not WHAT VALUES. Before
 * `sql/427` the role could write anything up to 300 characters into
 * `awcms_social_publish_jobs.last_error` and
 * `awcms_social_publish_attempts.error_message`, and any message and any
 * attributes into its own audit rows, so a compromised dispatcher could copy a
 * decrypted token into a row the app role, backups and exports all read. The
 * RESTRICTIVE policies of `sql/427` now accept only the values listed here, and
 * `security:readiness` builds its exact pins from these same lists: a phrase
 * added here without a migration (or the reverse) fails readiness instead of
 * failing the dispatcher's finalise transaction in production.
 *
 * Pure: no I/O, type-only imports. Changing a value is a migration AND an edit
 * here.
 *
 * What a closed vocabulary does NOT remove (the re-audit of #1483): a role that
 * may choose among valid values (which code, which attempt number, which valid
 * post id) can still encode a few bits per row. The bound removes free text,
 * not every covert channel; the residual is stated in the module README.
 */
import type { PublisherUnavailableReason } from "../../_shared/ports/channel-account-port";

/** Fixed, code-defined phrases: a provider body or a thrown message never reaches a row. */
export const SOCIAL_DISPATCH_PHRASES = {
  PUBLISHED: "Published.",
  PROVIDER_ADAPTER_UNAVAILABLE: "No adapter is registered for this provider.",
  ADAPTER_ERROR: "The provider adapter failed unexpectedly.",
  PROVIDER_TIMEOUT: "The provider did not answer in time.",
  INVALID_POST_ID:
    "The provider reported a post this adapter cannot identify: the post may exist. An operator must check before it is sent again.",
  UNKNOWN_OUTCOME:
    "The outcome is unknown: the post may already exist. An operator must check before it is sent again.",
  CIRCUIT_OPEN: "The provider was failing; the attempt was not made.",
  RETRIES_EXHAUSTED: "The retry budget is spent.",
  HOLD_EXHAUSTED: "The account stayed unavailable for too long.",
  NEEDS_REAUTH: "The account must be re-authorised.",
  REJECTED: "The provider refused this content.",
  SOURCE_RETRACTED:
    "The source article is no longer published; nothing was sent.",
  MEDIA_UNAVAILABLE:
    "The media object is no longer available; nothing was sent.",
  MEDIA_RIGHTS_REVOKED:
    "The media object's rights no longer clear it; nothing was sent.",
  SOURCE_CHECK_UNAVAILABLE:
    "Whether the source may still be published could not be checked; nothing was sent."
} as const satisfies Record<string, string>;

const ACCOUNT_PHRASE = "The account cannot publish.";
const HELD_PHRASE = "Waiting for the account to be usable.";
const FALLBACK_PHRASE = "The attempt did not succeed.";

/** The phrase stored for a failure code. Never echoes the code or any adapter text. */
export function phraseFor(code: string): string {
  if (Object.hasOwn(SOCIAL_DISPATCH_PHRASES, code)) {
    return SOCIAL_DISPATCH_PHRASES[
      code as keyof typeof SOCIAL_DISPATCH_PHRASES
    ];
  }
  if (code.startsWith("ACCOUNT_")) return ACCOUNT_PHRASE;
  if (code.startsWith("HELD_")) return HELD_PHRASE;

  return FALLBACK_PHRASE;
}

/** Every value `phraseFor` can return: what `last_error` and `error_message` may hold when the role writes them. */
export const SOCIAL_DISPATCH_ALLOWED_PHRASES: readonly string[] = [
  ...Object.values(SOCIAL_DISPATCH_PHRASES),
  ACCOUNT_PHRASE,
  HELD_PHRASE,
  FALLBACK_PHRASE
];

/** The audit messages of the dispatcher, keyed by where they are written. */
export const SOCIAL_DISPATCH_AUDIT_MESSAGES = {
  LEASE_LOST:
    "A social publish job lost its lease while in flight; its outcome is unknown and it waits for an operator.",
  ACCOUNT_UNAVAILABLE:
    "A social publish job failed because its account cannot publish.",
  PUBLISHED: "A social publish job was accepted by the provider.",
  OUTCOME_UNKNOWN:
    "A social publish job's outcome is unknown; it waits for an operator and will not be retried automatically.",
  SOURCE_WITHDRAWN:
    "A social publish job was stopped before sending: its source can no longer be published.",
  FAILED: "A social publish job failed."
} as const satisfies Record<string, string>;

/** The three audit actions the dispatcher writes. */
export const SOCIAL_DISPATCH_AUDIT_ACTIONS: readonly string[] = [
  "social_publishing.job.published",
  "social_publishing.job.failed",
  "social_publishing.job.outcome_unknown"
];

/**
 * The only attribute keys a dispatcher audit row may carry, each with its value
 * shape (enforced by `sql/427`): two uuids, a provider key, an attempt number,
 * two failure codes and a boolean. No key can hold free text.
 */
export const SOCIAL_DISPATCH_AUDIT_ATTRIBUTE_KEYS: readonly string[] = [
  "publicationId",
  "accountId",
  "provider",
  "attemptNo",
  "code",
  "failureCode",
  "accountDegraded"
];

/**
 * The six providers the social tables admit (sql/330). Closed, so a `provider`
 * value in an audit row or an event payload cannot carry text.
 */
export const SOCIAL_DISPATCH_PROVIDERS: readonly string[] = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "linkedin"
];

/** Every value of {@link PublisherUnavailableReason}; the compile-time check below keeps it exhaustive. */
export const PUBLISHER_UNAVAILABLE_REASONS = [
  "CHANNEL_ACCOUNTS_DISABLED",
  "ACCOUNT_NOT_FOUND",
  "NOT_A_WHATSAPP_SENDER",
  "ACCOUNT_PENDING",
  "ACCOUNT_DEGRADED",
  "ACCOUNT_REVOKED",
  "ACCOUNT_DISABLED",
  "CONNECTION_NOT_ACTIVE",
  "CONNECTION_EXPIRED",
  "CAPABILITY_DENIED",
  "RISK_ACKNOWLEDGEMENT_REQUIRED",
  "PROVIDER_ADAPTER_DISABLED",
  "CREDENTIAL_UNAVAILABLE",
  "SECRET_STORE_UNAVAILABLE",
  "CONTAINER_BINDING_INVALID",
  "NOT_A_PUBLISHER"
] as const satisfies readonly PublisherUnavailableReason[];

type MissingReason = Exclude<
  PublisherUnavailableReason,
  (typeof PUBLISHER_UNAVAILABLE_REASONS)[number]
>;
/** Fails to compile when the port gains a reason this list does not name. */
export const PUBLISHER_REASONS_ARE_EXHAUSTIVE: MissingReason extends never
  ? true
  : MissingReason = true;

/** The codes the dispatcher itself decides (its own verdicts and the fallbacks of `sanitizeCode`). */
const DISPATCHER_CODES = [
  "ADAPTER_ERROR",
  "CIRCUIT_OPEN",
  "CREDENTIAL_UNAVAILABLE",
  "HOLD_EXHAUSTED",
  "INVALID_POST_ID",
  "LEASE_EXPIRED_UNKNOWN",
  "MEDIA_RIGHTS_REVOKED",
  "MEDIA_UNAVAILABLE",
  "NEEDS_REAUTH",
  "OUTCOME_UNKNOWN",
  "PROVIDER_ADAPTER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "RATE_LIMITED",
  "REJECTED",
  "RETRIES_EXHAUSTED",
  "SOURCE_CHECK_UNAVAILABLE",
  "SOURCE_RETRACTED"
] as const;

/**
 * The error codes of every ADMITTED adapter (`SocialPublishAdapter.errorCodes`).
 * Only Facebook today; a test holds this list equal to the adapter's own. A
 * second connector (#1147) adds its codes here and in a migration.
 */
export const ADMITTED_ADAPTER_ERROR_CODES: readonly string[] = [
  "FB_TOKEN_INVALID",
  "FB_PERMISSION_DENIED",
  "FB_RATE_LIMITED",
  "FB_TEMPORARY_OUTAGE",
  "FB_DUPLICATE_POST",
  "FB_POLICY_BLOCK",
  "FB_INVALID_PARAMETER",
  "FB_MEDIA_REJECTED",
  "FB_REQUEST_REJECTED",
  "FB_UPSTREAM_UNKNOWN",
  "FB_RESPONSE_UNREADABLE",
  "FB_NETWORK_NOT_SENT",
  "FB_ANSWER_LOST",
  "FB_PAGE_ID_INVALID",
  "FB_MEDIA_INVALID",
  "FB_VARIANT_UNSUPPORTED"
];

/**
 * Every failure code the role may write (`failure_code`, `error_code`, the
 * audit `code`/`failureCode`, the `job.failed` event's `failureCode`): the
 * dispatcher's own codes, the admitted adapters' codes, and `ACCOUNT_<reason>`
 * / `HELD_<reason>` for every publisher reason. Sorted, deduplicated.
 */
export const SOCIAL_DISPATCH_FAILURE_CODES: readonly string[] = [
  ...new Set([
    ...DISPATCHER_CODES,
    ...ADMITTED_ADAPTER_ERROR_CODES,
    ...PUBLISHER_UNAVAILABLE_REASONS.map((reason) =>
      `ACCOUNT_${reason}`.slice(0, 64)
    ),
    ...PUBLISHER_UNAVAILABLE_REASONS.map((reason) =>
      `HELD_${reason}`.slice(0, 64)
    )
  ])
].sort();

/** The post id shape of the admitted adapters (Facebook: `<page>_<post>`). */
export const ADMITTED_EXTERNAL_POST_ID_PATTERN = "^[0-9]{1,32}_[0-9]{1,32}$";

/** The post URL the admitted adapter stores: exactly this prefix followed by the post id. */
export const ADMITTED_EXTERNAL_POST_URL_PREFIX = "https://www.facebook.com/";
