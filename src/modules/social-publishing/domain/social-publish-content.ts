/**
 * The content snapshot, its eligibility rules, and the provider-support check
 * (Issue #1145, ADR-0157 sections 3 and 4). Pure: no database, no network.
 *
 * Everything that decides "what exactly will be published, and may this account
 * carry it" is here so that the enqueue path, the manual route and the tests
 * apply ONE rule.
 */
import { createHash } from "node:crypto";

import type { SocialPublishCapabilities } from "./social-publish-adapter";
import {
  MAX_CAPTION_LENGTH,
  MAX_LINK_LENGTH,
  MAX_TITLE_LENGTH,
  SOCIAL_IMAGE_MIME_TYPES,
  SOCIAL_MEDIA_MAX_BYTES,
  type PublishVariant
} from "./social-publishing-constants";

/** The subset of `ResolvedMediaReferenceDTO` this module consumes. Kept as its own shape: this file imports no port. */
export type MediaFacts = {
  publicUrl: string;
  altText: string | null;
  mimeType: string;
  sizeBytes: number | null;
  creditLine: string | null;
  copyrightStatus: string | null;
};

export type MediaSnapshot = {
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  creditLine: string | null;
  copyrightStatus: string;
};

export type ContentRefusalCode =
  "TITLE_INVALID" | "CAPTION_INVALID" | "LINK_INVALID" | "MEDIA_NOT_ELIGIBLE";

export type SnapshotInput = {
  title: string;
  caption: string;
  linkUrl: string | null;
  media: MediaFacts | null;
};

export type ContentSnapshot = {
  title: string;
  caption: string;
  linkUrl: string | null;
  media: MediaSnapshot | null;
  variant: PublishVariant;
  contentHash: string;
};

/** Control characters other than tab and newline never belong in a caption. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Collapses an article's excerpt or title into a caption within the storage
 * ceiling. Truncation here is of SOURCE text into this module's own storage
 * limit, on a word boundary with an ellipsis; a provider's own length limit is
 * a REFUSAL at enqueue, never a truncation (ADR-0157 section 3).
 */
export function composeArticleCaption(
  title: string,
  excerpt: string | null
): string {
  const source = (excerpt ?? "").replace(/\s+/g, " ").trim();
  const base = source.length > 0 ? source : title.replace(/\s+/g, " ").trim();

  if (base.length <= MAX_CAPTION_LENGTH) return base;

  const room = MAX_CAPTION_LENGTH - 1;
  const cut = base.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** A plain `https` URL on a named host: no credentials, no spaces, no IP literal, no single-label host. Never fetched by this module. */
export function isSafeLinkUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LINK_LENGTH) return false;
  if (/[\s@]/.test(value)) return false;

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;

  const host = url.hostname;

  if (!host.includes(".")) return false;
  if (host.startsWith("[") || /^[0-9.]+$/.test(host)) return false;

  return true;
}

/**
 * Whether a media object may go onto a PUBLIC social platform under the
 * tenant's name: an allowed image type, a known size within the ceiling, an
 * https URL, and a rights status that is KNOWN (a media object whose rights
 * `media_library` has not verified reports no rights status, and `unknown` is
 * refused as well). Fail closed on every missing fact.
 */
export function evaluateMediaEligibility(
  media: MediaFacts
): { ok: true; snapshot: MediaSnapshot } | { ok: false } {
  if (
    !(SOCIAL_IMAGE_MIME_TYPES as readonly string[]).includes(media.mimeType)
  ) {
    return { ok: false };
  }

  if (
    media.sizeBytes === null ||
    !Number.isInteger(media.sizeBytes) ||
    media.sizeBytes <= 0 ||
    media.sizeBytes > SOCIAL_MEDIA_MAX_BYTES
  ) {
    return { ok: false };
  }

  if (!isSafeLinkUrl(media.publicUrl)) return { ok: false };

  if (media.copyrightStatus === null || media.copyrightStatus === "unknown") {
    return { ok: false };
  }

  return {
    ok: true,
    snapshot: {
      publicUrl: media.publicUrl,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      altText: media.altText,
      creditLine: media.creditLine,
      copyrightStatus: media.copyrightStatus
    }
  };
}

export function selectVariant(media: MediaSnapshot | null): PublishVariant {
  return media ? "image" : "text";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/** Validates and freezes the content. Returns a refusal CODE (never the value) when something is not publishable. */
export function buildContentSnapshot(
  input: SnapshotInput
):
  | { ok: true; snapshot: ContentSnapshot }
  | { ok: false; code: ContentRefusalCode } {
  const title = input.title.trim();

  if (
    title.length === 0 ||
    title.length > MAX_TITLE_LENGTH ||
    FORBIDDEN_CONTROL.test(title)
  ) {
    return { ok: false, code: "TITLE_INVALID" };
  }

  const caption = input.caption.trim();

  if (
    caption.length === 0 ||
    caption.length > MAX_CAPTION_LENGTH ||
    FORBIDDEN_CONTROL.test(caption)
  ) {
    return { ok: false, code: "CAPTION_INVALID" };
  }

  if (input.linkUrl !== null && !isSafeLinkUrl(input.linkUrl)) {
    return { ok: false, code: "LINK_INVALID" };
  }

  let media: MediaSnapshot | null = null;

  if (input.media !== null) {
    const verdict = evaluateMediaEligibility(input.media);

    if (!verdict.ok) return { ok: false, code: "MEDIA_NOT_ELIGIBLE" };

    media = verdict.snapshot;
  }

  const variant = selectVariant(media);
  const contentHash = createHash("sha256")
    .update(
      stableStringify({
        title,
        caption,
        linkUrl: input.linkUrl,
        media,
        variant
      })
    )
    .digest("hex");

  return {
    ok: true,
    snapshot: {
      title,
      caption,
      linkUrl: input.linkUrl,
      media,
      variant,
      contentHash
    }
  };
}

export type AdapterSupportCode =
  | "VARIANT_UNSUPPORTED"
  | "MEDIA_TYPE_UNSUPPORTED"
  | "MEDIA_TOO_LARGE"
  | "CONTENT_TOO_LONG";

/**
 * Whether one provider's capability map can carry this content. A refusal is
 * final for that account: there is no downgrade to a smaller variant, no
 * truncation to fit and no other provider tried (ADR-0157 section 3).
 */
export function checkAdapterSupport(
  capabilities: SocialPublishCapabilities,
  content: Pick<ContentSnapshot, "variant" | "caption" | "linkUrl" | "media">
): { ok: true } | { ok: false; code: AdapterSupportCode } {
  if (!capabilities.variants.includes(content.variant)) {
    return { ok: false, code: "VARIANT_UNSUPPORTED" };
  }

  const length =
    content.caption.length +
    (content.linkUrl === null ? 0 : 1 + content.linkUrl.length);

  if (length > capabilities.maxCaptionLength) {
    return { ok: false, code: "CONTENT_TOO_LONG" };
  }

  if (content.media !== null) {
    if (!capabilities.imageMimeTypes.includes(content.media.mimeType)) {
      return { ok: false, code: "MEDIA_TYPE_UNSUPPORTED" };
    }

    if (content.media.sizeBytes > capabilities.maxImageBytes) {
      return { ok: false, code: "MEDIA_TOO_LARGE" };
    }
  }

  return { ok: true };
}

/**
 * Deterministic idempotency key for a job: the SAME (tenant, source, trigger,
 * account) always yields the SAME key, which is what makes a repeated publish
 * event, a re-run scheduled-publish worker and a double submit create nothing
 * new. `sourceKey` is the article id for an article source and the publication
 * id for a manual one.
 */
export function buildSocialPublishIdempotencyKey(
  tenantId: string,
  sourceKey: string,
  trigger: string,
  accountId: string
): string {
  return createHash("sha256")
    .update(
      ["social_publish", tenantId, sourceKey, trigger, accountId].join(":")
    )
    .digest("hex");
}
