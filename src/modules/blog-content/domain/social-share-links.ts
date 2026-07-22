import { escapeHtml } from "../../../lib/html/escape";
import { isAbsoluteHttpUrl } from "./seo-validation";

/**
 * Public social share buttons (Issue #642, epic `news_portal`). Pure — no
 * I/O, no `process.env` reads (the caller passes in an already-resolved
 * config, e.g. `news-portal/domain/news-share-config.ts`'s
 * `resolveNewsShareConfig()`, structurally compatible with
 * `SocialShareRenderConfig` below by field name — no cross-module import
 * needed, same "composition root wires modules together, domain layers stay
 * decoupled" convention Issue #681 established for this epic).
 *
 * ## Canonical URL only — never the request's raw querystring
 *
 * Every function here takes an already-resolved `canonicalUrl` (the same
 * value `seo-rendering.ts`'s `resolveCanonicalUrl` produces and
 * `renderPublicPageShell` already emits as `<link rel="canonical">`), never
 * `Astro`/`request.url` directly. That value is server-constructed from
 * `url.origin` + the post's own slug (`/news/[slug].ts`,
 * `/blog/[tenantCode]/[slug].ts`) — it can never carry a tracking
 * querystring, an admin preview flag, a session id, or any other private
 * query parameter a visitor's actual browser URL might contain, satisfying
 * the issue's "do not leak admin preview URLs, draft URLs, session IDs, or
 * private query parameters" requirement structurally rather than by
 * filtering.
 *
 * ## Instagram — no fake web-share URL
 *
 * There is no supported Instagram "share to feed/story from an arbitrary
 * external URL" web intent (unlike WhatsApp/Telegram/Facebook/LinkedIn/X,
 * which all have documented `https://` share-intent endpoints). Instagram
 * sharing is therefore NEVER a static `<a href>` in `STATIC_SHARE_LINK_BUILDERS`
 * below — it is reachable only through the native `navigator.share` share
 * sheet (when the visitor's OS/browser lists Instagram as an installed
 * share target) or the copy-link fallback, both already rendered for other
 * reasons. `renderSocialShareButtonsHtml`'s `instagramNativeOnly` flag only
 * controls a short static text note clarifying this, never a dedicated
 * button of its own — see that function's doc comment.
 */

export type SocialShareArticle = {
  /** Already-resolved, already-validated canonical URL — see module doc comment. */
  canonicalUrl: string;
  title: string;
  /** Falls back to `title` when null/empty for platforms that share a text snippet (WhatsApp/X/email body). */
  excerpt: string | null;
};

/** Structurally compatible with `news-portal/domain/news-share-config.ts`'s `NewsShareConfig` — see module doc comment for why this isn't imported from there directly. */
export type SocialShareRenderConfig = {
  buttonsEnabled: boolean;
  native: boolean;
  whatsapp: boolean;
  telegram: boolean;
  facebook: boolean;
  linkedin: boolean;
  x: boolean;
  email: boolean;
  instagramNativeOnly: boolean;
};

export type SocialSharePlatform =
  "whatsapp" | "telegram" | "facebook" | "linkedin" | "x_twitter" | "email";

export type SocialShareLink = {
  platform: SocialSharePlatform;
  label: string;
  href: string;
};

function shareText(article: SocialShareArticle): string {
  return article.excerpt && article.excerpt.trim().length > 0
    ? article.excerpt
    : article.title;
}

/**
 * Every entry's `buildHref` receives the already-validated `canonicalUrl` +
 * article fields and returns a fully `encodeURIComponent`-escaped share
 * intent URL. This array IS the platform allowlist (issue: "keep all share
 * URLs encoded and allowlisted by platform") — no caller can request a
 * platform outside this fixed set, and no raw/unencoded value is ever
 * concatenated into a URL.
 */
const STATIC_SHARE_LINK_BUILDERS: ReadonlyArray<{
  platform: SocialSharePlatform;
  label: string;
  isEnabled: (config: SocialShareRenderConfig) => boolean;
  buildHref: (article: SocialShareArticle) => string;
}> = [
  {
    platform: "whatsapp",
    label: "WhatsApp",
    isEnabled: (config) => config.whatsapp,
    buildHref: (article) =>
      `https://wa.me/?text=${encodeURIComponent(`${article.title} ${article.canonicalUrl}`)}`
  },
  {
    platform: "telegram",
    label: "Telegram",
    isEnabled: (config) => config.telegram,
    buildHref: (article) =>
      `https://t.me/share/url?url=${encodeURIComponent(article.canonicalUrl)}&text=${encodeURIComponent(article.title)}`
  },
  {
    platform: "facebook",
    label: "Facebook",
    isEnabled: (config) => config.facebook,
    buildHref: (article) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(article.canonicalUrl)}`
  },
  {
    platform: "linkedin",
    label: "LinkedIn",
    isEnabled: (config) => config.linkedin,
    buildHref: (article) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(article.canonicalUrl)}`
  },
  {
    platform: "x_twitter",
    label: "X",
    isEnabled: (config) => config.x,
    buildHref: (article) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(article.canonicalUrl)}&text=${encodeURIComponent(article.title)}`
  },
  {
    platform: "email",
    label: "Email",
    isEnabled: (config) => config.email,
    buildHref: (article) =>
      `mailto:?subject=${encodeURIComponent(article.title)}&body=${encodeURIComponent(`${shareText(article)}\n\n${article.canonicalUrl}`)}`
  }
];

/**
 * Builds the enabled static-link platforms only (native share + copy link
 * are not part of this list — they need client-side JS, rendered separately
 * by `renderSocialShareButtonsHtml`). Returns `[]` when the canonical URL
 * isn't a safe absolute http(s) URL — same "degrade, don't render an unsafe
 * link" convention `resolveOgImageUrl`/`resolveCanonicalUrl` use.
 */
export function buildSocialShareLinks(
  article: SocialShareArticle,
  config: SocialShareRenderConfig
): SocialShareLink[] {
  if (!isAbsoluteHttpUrl(article.canonicalUrl)) {
    return [];
  }

  return STATIC_SHARE_LINK_BUILDERS.filter((entry) =>
    entry.isEnabled(config)
  ).map((entry) => ({
    platform: entry.platform,
    label: entry.label,
    href: entry.buildHref(article)
  }));
}

function renderInstagramNote(config: SocialShareRenderConfig): string {
  if (!config.instagramNativeOnly) {
    return "";
  }

  const message = config.native
    ? "Instagram: use the Share button above, or Copy link."
    : "Instagram: use Copy link to share this article.";

  return `<p class="news-share__note">${escapeHtml(message)}</p>`;
}

/**
 * Full public share widget for one article — the ONLY function route files
 * (`/news/[slug].ts`, `/blog/[tenantCode]/[slug].ts`) need to call. Returns
 * `""` (renders nothing) when `config.buttonsEnabled` is `false` or the
 * canonical URL isn't safe — callers can splice the result straight into
 * `bodyHtml` unconditionally.
 *
 * Native share and copy-link are rendered as `hidden`/plain `<button>`
 * elements with `data-share-*` attributes read by `scriptSrc`
 * (`public/js/news-share.js`, loaded same-origin via `<script src>` — never
 * inline, so this widget adds zero new Content-Security-Policy surface: no
 * hash/nonce bookkeeping, just an ordinary `'self'` same-origin script).
 * That script progressively enhances: the native-share button starts
 * `hidden` and is only revealed when `navigator.share` actually exists in a
 * secure context (issue: "native share uses `navigator.share` only after
 * user activation and only in secure context") — with JS disabled or
 * unsupported, it silently stays hidden rather than rendering a dead
 * button.
 */
export function renderSocialShareButtonsHtml(
  article: SocialShareArticle,
  config: SocialShareRenderConfig,
  scriptSrc: string
): string {
  if (!config.buttonsEnabled || !isAbsoluteHttpUrl(article.canonicalUrl)) {
    return "";
  }

  const staticLinks = buildSocialShareLinks(article, config);
  const staticLinkItems = staticLinks
    .map(
      (link) =>
        `<li><a class="news-share__link news-share__link--${escapeHtml(link.platform)}" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" aria-label="Share on ${escapeHtml(link.label)}">${escapeHtml(link.label)}</a></li>`
    )
    .join("\n");

  const nativeItem = config.native
    ? `<li><button type="button" class="news-share__native js-news-share-native" hidden data-share-url="${escapeHtml(article.canonicalUrl)}" data-share-title="${escapeHtml(article.title)}" data-share-text="${escapeHtml(shareText(article))}" aria-label="Share this article">Share</button></li>`
    : "";

  const copyItem = `<li><button type="button" class="news-share__copy js-news-share-copy" data-share-url="${escapeHtml(article.canonicalUrl)}" aria-label="Copy article link">Copy link</button></li>`;

  return `<nav class="news-share" aria-label="Share this article">
<ul class="news-share__list">
${nativeItem}
${copyItem}
${staticLinkItems}
</ul>
<p class="news-share__status js-news-share-status" role="status" aria-live="polite" hidden></p>
${renderInstagramNote(config)}
<script src="${escapeHtml(scriptSrc)}" defer></script>
</nav>`;
}
