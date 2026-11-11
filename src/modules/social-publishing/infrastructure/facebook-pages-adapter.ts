/**
 * The Facebook Pages connector (Issue #1146, ADR-0157 section 3, ADR-0148
 * capability C3): ONE Graph API call per job, for ONE Page, with that Page's
 * own Page access token, through the dispatcher's `ssrfSafeFetch` client.
 *
 * ## What it calls (verified against developers.facebook.com on 2026-11-11)
 *
 * - Graph API **v27.0** (`https://graph.facebook.com/v27.0`), the version every
 *   example of the Pages API documentation used on that date.
 * - Text or link post: `POST /{page-id}/feed` with `message` and, optionally,
 *   `link` (Pages API, "Posts"). Answer: `{ "id": "{page-id}_{post-id}" }`.
 * - Photo post: `POST /{page-id}/photos` with `url` (a photo already on the
 *   internet, which Facebook fetches itself), `caption` (`message` is
 *   documented as deprecated for this edge) and `alt_text_custom`. Answer:
 *   `{ "id": "{photo-id}", "post_id": "{page-id}_{post-id}" }`. Documented
 *   formats .jpeg, .bmp, .png, .gif, .tiff, at most 4 MB; this connector
 *   accepts JPEG and PNG only (the intersection with what `social_publishing`
 *   snapshots), so a WebP is REFUSED at enqueue, never converted.
 * - Token: a **Page access token** of a person who can perform `CREATE_CONTENT`
 *   on the Page; permissions `pages_manage_posts`, `pages_read_engagement`,
 *   `pages_show_list` (photos), plus `pages_manage_engagement` and
 *   `pages_read_user_engagement` listed for the posts edge. Obtaining those
 *   grants needs Meta App Review: a BUSINESS step, not code. Sent as an
 *   `Authorization: Bearer` header, never in the URL or the body.
 *
 * ## Errors (Graph API "Handle errors" and "Rate limiting" guides)
 *
 * | Graph answer                                            | Outcome                                  |
 * | ------------------------------------------------------- | ---------------------------------------- |
 * | `code` 190 or 102, or subcode 458/459/460/463/464/467/492 | `needs_reauth` (token expired/revoked)  |
 * | `code` 10 or 200-299 (permission missing or withdrawn)  | `needs_reauth` (a person must re-grant)  |
 * | `code` 4, 17, 32, 341, 613, 80001 (throttling)          | `rate_limited` (BUC header sets the wait) |
 * | `code` 2 on a 503 that says `is_transient: true`         | `retryable`                              |
 * | `code` 2 otherwise (the guide says "retry", not "nothing was done") | `unknown`                  |
 * | `code` 506 (duplicate post)                             | `unknown` (our earlier post may exist)   |
 * | `code` 368 (temporarily blocked for policy)             | `rejected` (never retried automatically) |
 * | `code` 100, 324, other 4xx                              | `rejected`                               |
 * | 5xx without a Graph error envelope, `code` 1, 2xx without a readable id, a lost answer | `unknown` |
 *
 * The Graph API documents no idempotency key for these edges, so
 * `supportsIdempotencyKey` is `false`: every UNKNOWN outcome becomes
 * `needs_reconciliation` and waits for an operator (ADR-0157 section 6, M-1).
 * A request that provably never left (an invalid URL, a blocked address, a DNS
 * failure) is `retryable`; one that may have been processed is `unknown`.
 *
 * ## What it never does
 *
 * - Fetch the media itself, follow a redirect, or call any host but the Graph
 *   API origin (fixed here; tests may point it elsewhere and are refused by the
 *   SSRF guard when that is an internal address).
 * - Put the token, a Graph error message or a response body into a code, a log
 *   line or an error: codes are this file's closed vocabulary.
 * - Read a user profile, a private message or a contact: engagement (reply,
 *   comments, dm, inbound) is not in this slice (see the module README).
 */
import type {
  SocialPublishAdapter,
  SocialPublishCapabilities,
  SocialPublishOutcome,
  SocialPublishRequest
} from "../domain/social-publish-adapter";
import { isSafeLinkUrl } from "../domain/social-publish-content";

export const FACEBOOK_GRAPH_API_VERSION = "v27.0";
export const FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com";

/** A Page id is numeric. Anything else is never sent anywhere. */
export const FACEBOOK_PAGE_ID = /^[0-9]{1,32}$/;

/** `{page-id}_{post-id}`, the shape both edges answer with. */
export const FACEBOOK_POST_ID = /^[0-9]{1,32}_[0-9]{1,32}$/;

export const FACEBOOK_CAPABILITIES: SocialPublishCapabilities = {
  // Video and reels need the `publish_video` permission and a resumable upload
  // the matrix does not distinguish yet; they stay refused (never downgraded).
  variants: ["text", "image"],
  // Far below the Page post limit; `social_publishing` stores at most 2000
  // characters of caption anyway. Counted with the link.
  maxCaptionLength: 5000,
  imageMimeTypes: ["image/jpeg", "image/png"],
  maxImageBytes: 4 * 1024 * 1024
};

export const FACEBOOK_ERROR_CODES = [
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
] as const;

export type FacebookErrorCode = (typeof FACEBOOK_ERROR_CODES)[number];

const REAUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
const THROTTLE_CODES = new Set([4, 17, 32, 341, 613, 80001]);

/** At most a day: a provider header can lengthen a wait, never park a job forever. */
const MAX_RETRY_AFTER_SECONDS = 24 * 3600;

type GraphError = {
  code: number | null;
  subcode: number | null;
  /** `error.is_transient === true`; not documented on the error-handling guide, so only ever a NARROWING signal. */
  transient: boolean;
};

/** Only the two numbers are kept: the message, `fbtrace_id` and user texts are discarded unread. */
export function parseGraphError(body: unknown): GraphError | null {
  if (!body || typeof body !== "object") return null;

  const error = (body as { error?: unknown }).error;

  if (!error || typeof error !== "object") return null;

  const asInt = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) ? value : null;

  return {
    code: asInt((error as { code?: unknown }).code),
    subcode: asInt((error as { error_subcode?: unknown }).error_subcode),
    transient: (error as { is_transient?: unknown }).is_transient === true
  };
}

/**
 * The wait the `X-Business-Use-Case-Usage` header asks for, in seconds: the
 * largest `estimated_time_to_regain_access` (minutes) of any entry, bounded.
 * `undefined` when the header is missing or unreadable.
 */
export function retryAfterFromUsageHeader(
  header: string | null
): number | undefined {
  if (!header || header.length > 10_000) return undefined;

  let parsed: unknown;

  try {
    parsed = JSON.parse(header);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") return undefined;

  let minutes = 0;

  for (const entries of Object.values(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const value = (entry as { estimated_time_to_regain_access?: unknown })
        ?.estimated_time_to_regain_access;

      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        minutes = Math.max(minutes, value);
      }
    }
  }

  return minutes > 0
    ? Math.min(Math.ceil(minutes * 60), MAX_RETRY_AFTER_SECONDS)
    : undefined;
}

/**
 * Turns one Graph answer into an outcome. Pure: the status, the parsed body
 * (or `null` when it was not JSON), and the usage header.
 */
export function classifyGraphResponse(
  status: number,
  body: unknown,
  usageHeader: string | null
): SocialPublishOutcome {
  if (status >= 200 && status < 300) {
    const record =
      body && typeof body === "object"
        ? (body as { id?: unknown; post_id?: unknown })
        : {};
    // The photos edge answers with the PHOTO id and the post id; the post id
    // is the Page post that now exists.
    const postId =
      typeof record.post_id === "string" ? record.post_id : record.id;

    if (typeof postId === "string" && FACEBOOK_POST_ID.test(postId)) {
      return {
        outcome: "published",
        externalPostId: postId,
        externalPostUrl: `https://www.facebook.com/${postId}`
      };
    }

    // 2xx without an identifiable post: the post may exist.
    return { outcome: "unknown", errorCode: "FB_RESPONSE_UNREADABLE" };
  }

  const graph = parseGraphError(body);

  if (graph === null) {
    // No Graph envelope. A 5xx from a gateway or a proxy says nothing about
    // whether the post was created: never a blind retry.
    return status >= 500
      ? { outcome: "unknown", errorCode: "FB_UPSTREAM_UNKNOWN" }
      : { outcome: "rejected", errorCode: "FB_REQUEST_REJECTED" };
  }

  const { code, subcode } = graph;

  if (
    code === 190 ||
    code === 102 ||
    (subcode !== null && REAUTH_SUBCODES.has(subcode))
  ) {
    return { outcome: "needs_reauth", errorCode: "FB_TOKEN_INVALID" };
  }

  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return { outcome: "needs_reauth", errorCode: "FB_PERMISSION_DENIED" };
  }

  if (code !== null && THROTTLE_CODES.has(code)) {
    const retryAfterSeconds = retryAfterFromUsageHeader(usageHeader);

    return retryAfterSeconds === undefined
      ? { outcome: "rate_limited", errorCode: "FB_RATE_LIMITED" }
      : {
          outcome: "rate_limited",
          errorCode: "FB_RATE_LIMITED",
          retryAfterSeconds
        };
  }

  // "Temporary outage, wait and retry" (code 2). The guide tells a client to
  // retry; it does NOT say the post was not created (the #1271 audit, L4). For
  // a publish without a dedupe key that is an UNKNOWN outcome, reconciled by an
  // operator. Only a 503 that also flags itself `is_transient` (Service
  // Unavailable: the request was not served) is retried automatically.
  if (code === 2) {
    return status === 503 && graph.transient
      ? { outcome: "retryable", errorCode: "FB_TEMPORARY_OUTAGE" }
      : { outcome: "unknown", errorCode: "FB_TEMPORARY_OUTAGE" };
  }

  // An identical post was published just before: possibly OUR earlier attempt
  // whose answer was lost. Reconcile, never retry and never fail silently.
  if (code === 506) {
    return { outcome: "unknown", errorCode: "FB_DUPLICATE_POST" };
  }

  if (code === 368) {
    return { outcome: "rejected", errorCode: "FB_POLICY_BLOCK" };
  }

  if (code === 324) {
    return { outcome: "rejected", errorCode: "FB_MEDIA_REJECTED" };
  }

  if (code === 100) {
    return { outcome: "rejected", errorCode: "FB_INVALID_PARAMETER" };
  }

  // `code` 1 ("unknown, likely a temporary outage") and any other 5xx: the
  // Graph API does not say nothing happened.
  if (code === 1 || status >= 500) {
    return { outcome: "unknown", errorCode: "FB_UPSTREAM_UNKNOWN" };
  }

  return { outcome: "rejected", errorCode: "FB_REQUEST_REJECTED" };
}

/** `ssrfSafeFetch` refusals that mean the request never left this process. */
const NOT_SENT_REASONS: ReadonlySet<string> = new Set([
  "invalid_url",
  "scheme_not_allowed",
  "credentials_in_url",
  "dns_resolution_failed",
  "blocked_address"
]);

function formBody(fields: Record<string, string | null>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) params.set(key, value);
  }

  return params.toString();
}

export type FacebookPagesAdapterOptions = {
  /** Tests only: another Graph origin (still behind the SSRF guard). */
  graphOrigin?: string;
};

export function createFacebookPagesAdapter(
  options: FacebookPagesAdapterOptions = {}
): SocialPublishAdapter {
  const origin = options.graphOrigin ?? FACEBOOK_GRAPH_ORIGIN;

  return {
    provider: "facebook",
    capabilities: FACEBOOK_CAPABILITIES,
    errorCodes: FACEBOOK_ERROR_CODES,
    supportsIdempotencyKey: false,
    externalPostIdPattern: FACEBOOK_POST_ID,
    postUrlHosts: ["www.facebook.com"],

    async publish(
      request: SocialPublishRequest
    ): Promise<SocialPublishOutcome> {
      // The page id comes from the account record; it is still checked, because
      // it becomes a URL path segment.
      if (!FACEBOOK_PAGE_ID.test(request.externalId)) {
        return { outcome: "rejected", errorCode: "FB_PAGE_ID_INVALID" };
      }

      const { content } = request;
      let path: string;
      let body: string;

      if (content.variant === "text" && content.media === null) {
        path = "feed";
        body = formBody({ message: content.caption, link: content.linkUrl });
      } else if (content.variant === "image" && content.media !== null) {
        const media = content.media;

        // Re-checked here although enqueue checked it: the snapshot is what
        // Facebook will fetch, so only a plain https URL of an accepted type
        // and size is ever handed over.
        if (
          !isSafeLinkUrl(media.publicUrl) ||
          !FACEBOOK_CAPABILITIES.imageMimeTypes.includes(media.mimeType) ||
          !Number.isInteger(media.sizeBytes) ||
          media.sizeBytes <= 0 ||
          media.sizeBytes > FACEBOOK_CAPABILITIES.maxImageBytes
        ) {
          return { outcome: "rejected", errorCode: "FB_MEDIA_INVALID" };
        }

        path = "photos";
        // The photos edge has no `link` field: the link rides in the caption,
        // as the capability check at enqueue already counted it.
        body = formBody({
          url: media.publicUrl,
          caption:
            content.linkUrl === null
              ? content.caption
              : `${content.caption}\n${content.linkUrl}`,
          alt_text_custom: media.altText
        });
      } else {
        return { outcome: "rejected", errorCode: "FB_VARIANT_UNSUPPORTED" };
      }

      const result = await request.http(
        `${origin}/${FACEBOOK_GRAPH_API_VERSION}/${request.externalId}/${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.credential}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );

      if (!result.ok) {
        return NOT_SENT_REASONS.has(result.reason)
          ? { outcome: "retryable", errorCode: "FB_NETWORK_NOT_SENT" }
          : { outcome: "unknown", errorCode: "FB_ANSWER_LOST" };
      }

      const response = result.response;
      let parsed: unknown = null;

      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }

      return classifyGraphResponse(
        response.status,
        parsed,
        response.headers.get("x-business-use-case-usage")
      );
    }
  };
}

/** The process-wide instance the registry returns while the connector is switched on. */
export const facebookPagesAdapter = createFacebookPagesAdapter();
