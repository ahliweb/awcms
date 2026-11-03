/**
 * `SocialPublishAdapter` (Issue #1145, ADR-0157): the ONE seam a per-provider
 * connector (#1146 to #1151) implements. This slice ships the interface, the
 * registry and a test-only fake; it contains no provider call.
 *
 * ## What an adapter is, and is not
 *
 * An adapter turns an already-approved, already-snapshotted publication into
 * ONE provider call for ONE account. It is handed everything it may use and
 * nothing else:
 *
 * - the account's provider-stable identity (read from the account record by the
 *   dispatcher, never from a request);
 * - the immutable content snapshot;
 * - the credential, decrypted by the dispatcher for this call only, in memory;
 * - an HTTP client that IS `ssrfSafeFetch` (see {@link SocialPublishHttp}): an
 *   adapter receives no raw `fetch`, so a provider response cannot steer a call
 *   to an internal address and a redirect is re-validated, by construction.
 *
 * ## The capability map is a ceiling, never a grant
 *
 * {@link SocialPublishCapabilities} says what the PROVIDER INTERFACE can carry.
 * It cannot make an account publish: that needs a `granted` `publish`
 * capability row with evidence (ADR-0148 I2), a connected account and an active
 * connection. Content the map cannot carry is REFUSED at enqueue, never
 * downgraded (an image to a text-only provider is refused, not posted as text).
 */
import type { SsrfGuardResult } from "../../../lib/auth/ssrf-guard";
import type { PublishVariant } from "./social-publishing-constants";

export type SocialPublishCapabilities = {
  /** Content shapes the provider interface can carry. */
  variants: readonly PublishVariant[];
  /** Caption length ceiling, counting the link (plus one separator) when there is one. */
  maxCaptionLength: number;
  /** MIME types of an image the provider accepts. Empty when it takes no image. */
  imageMimeTypes: readonly string[];
  /** Largest image, in bytes, the provider accepts. */
  maxImageBytes: number;
};

export type SocialPublishMedia = {
  /** The verified public URL `media_library` reported at enqueue. */
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  creditLine: string | null;
};

export type SocialPublishContent = {
  variant: PublishVariant;
  title: string;
  caption: string;
  linkUrl: string | null;
  media: SocialPublishMedia | null;
};

/** `ssrfSafeFetch` bound to a timeout and a response-size cap. The ONLY network primitive an adapter has. */
export type SocialPublishHttp = (
  url: string,
  init?: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  }
) => Promise<SsrfGuardResult>;

export type SocialPublishRequest = {
  tenantId: string;
  accountId: string;
  provider: string;
  accountKind: string;
  /** The provider-stable identity of the account (page id, channel id, profile id). */
  externalId: string;
  /**
   * The provider bearer credential, in memory for this call only. It must not be
   * logged, stored, evented, audited or returned in an error message.
   */
  credential: string;
  content: SocialPublishContent;
  /**
   * Deterministic per (tenant, source, trigger, account). Pass it to the
   * provider's own idempotency mechanism where one exists: it is what makes a
   * re-claim after a crash between "provider accepted" and "job finalised" safe.
   */
  idempotencyKey: string;
  correlationId?: string;
  http: SocialPublishHttp;
  signal: AbortSignal;
};

export type SocialPublishOutcome =
  | { outcome: "published"; externalPostId: string; externalPostUrl?: string }
  | {
      /** Transient (network, 5xx): backoff and try again. */
      outcome: "retryable";
      errorCode: string;
    }
  | {
      outcome: "rate_limited";
      errorCode: string;
      retryAfterSeconds?: number;
    }
  | {
      /** The credential is no longer accepted: a person must re-authorise. Never retried by backoff. */
      outcome: "needs_reauth";
      errorCode: string;
    }
  | {
      /** The provider refused THIS content (policy, validation). Never retried. */
      outcome: "rejected";
      errorCode: string;
    };

export interface SocialPublishAdapter {
  /** The provider key this adapter serves (`facebook`, `threads`, ...), as in the provider matrix. */
  readonly provider: string;
  readonly capabilities: SocialPublishCapabilities;
  /**
   * The CLOSED vocabulary of failure codes this adapter returns in
   * `errorCode` (`^[A-Z][A-Z0-9_]{2,63}$`, e.g. `POLICY_BLOCK`,
   * `UPSTREAM_5XX`). The dispatcher records a code only if it is listed here;
   * anything else is recorded as the generic code for that outcome. An adapter
   * never gets to write an arbitrary string into a row, so a provider body or a
   * credential cannot reach one through a "code".
   */
  readonly errorCodes: readonly string[];
  /**
   * Performs the provider call. Never throws for an ordinary provider outcome
   * (those are values); throwing is reserved for a bug or an unexpected
   * condition, which the dispatcher treats as a retryable failure with a
   * generic code (the thrown message is never stored).
   */
  publish(request: SocialPublishRequest): Promise<SocialPublishOutcome>;
}
