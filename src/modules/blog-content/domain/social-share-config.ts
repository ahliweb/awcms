/**
 * `BLOG_SHARE_*` configuration gate — public social share buttons for the
 * `/blog/{tenantCode}/{slug}` article page.
 *
 * PORT-TIME RELOCATE (not a straight file copy from awcms-mini): mini's
 * equivalent (`news-portal/domain/news-share-config.ts`, its
 * `resolveNewsShareConfig`) lived in `news_portal` purely for
 * organizational reasons — it is a pure, dependency-free env-flag reader
 * with NO actual coupling to `news_portal`'s own tables/state, and
 * `blog-content/domain/social-share-links.ts`'s `renderSocialShareButtonsHtml`
 * already took its config as a plain, structurally-typed value
 * (`SocialShareRenderConfig`) rather than importing `NewsShareConfig`
 * directly — the exact "composition root wires modules together, domain
 * layers stay decoupled" convention this repo already uses everywhere else.
 * Since `news_portal` is not ported to this base (and mini's `/news/**`
 * route family that also used to call this isn't ported either — see
 * `blog-content/module.ts`'s `description` field), this resolver now lives
 * directly in `blog_content`, the one module that actually needs it here.
 * Env var names are renamed `NEWS_SHARE_*` -> `BLOG_SHARE_*` to match
 * (there is no `news_portal` in this base to share the vocabulary with).
 *
 * Every var here is a simple boolean feature flag gating whether a given
 * share platform's button/link is rendered on the public article page —
 * there is no per-tenant override table (unlike `blog_content`'s own
 * module settings). Defaults `true` (deviating from this repo's usual
 * "opt-in, default off" convention for new feature flags): no data is
 * collected, no third-party script is loaded, no secret needs provisioning
 * — every link is a same-origin `<a href>`/`<button>` built entirely from
 * data the page already renders publicly (title/excerpt/canonical URL).
 * Operators who need to disable a specific platform still can, per-flag.
 *
 * `BLOG_SHARE_INSTAGRAM_NATIVE_ONLY` does not gate a dedicated "Instagram"
 * button at all (there is no supported Instagram web-share intent URL — see
 * `social-share-links.ts`'s own architecture note) — it only toggles a
 * short, non-interactive accessibility note next to the native-share button
 * clarifying that Instagram sharing goes through the OS share sheet (native
 * share) or copy-link, never a fake Instagram URL.
 */
import type { SocialShareRenderConfig } from "./social-share-links";

function readBooleanFlag(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === "true";
}

export function resolveBlogShareConfig(
  env: NodeJS.ProcessEnv = process.env
): SocialShareRenderConfig {
  return {
    buttonsEnabled: readBooleanFlag(env.BLOG_SHARE_BUTTONS_ENABLED, true),
    native: readBooleanFlag(env.BLOG_SHARE_NATIVE_ENABLED, true),
    whatsapp: readBooleanFlag(env.BLOG_SHARE_WHATSAPP_ENABLED, true),
    telegram: readBooleanFlag(env.BLOG_SHARE_TELEGRAM_ENABLED, true),
    facebook: readBooleanFlag(env.BLOG_SHARE_FACEBOOK_ENABLED, true),
    linkedin: readBooleanFlag(env.BLOG_SHARE_LINKEDIN_ENABLED, true),
    x: readBooleanFlag(env.BLOG_SHARE_X_ENABLED, true),
    email: readBooleanFlag(env.BLOG_SHARE_EMAIL_ENABLED, true),
    instagramNativeOnly: readBooleanFlag(
      env.BLOG_SHARE_INSTAGRAM_NATIVE_ONLY,
      true
    )
  };
}
