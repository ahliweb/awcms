/**
 * Theme preview composition root (ADR-0034 Fase 3; ported from awcms-micro
 * Issue #269/ADR-0029 §6). Resolves a preview URL token to a renderable DRAFT
 * theme context, and serves the preview's token CSS — both NON-INDEXABLE and
 * isolated from the public cache.
 *
 * The URL token is `${tenantId}~${rawToken}` (see `domain/preview-token.ts`): the
 * tenant id lets us open the correct tenant transaction so RLS can then confirm
 * the SHA-256 of `rawToken` matches a live session for THAT tenant — a token can
 * never resolve a session belonging to another tenant. Security rests on the
 * 256-bit `rawToken`, not on the (non-secret) tenant id. Because the tenant id is
 * carried in the token itself, this preview surface needs NO host/tenant-code
 * resolution (unlike the public `/theming/{tenantCode}/tokens.css` stylesheet).
 */
import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import { fetchVersionById } from "../../modules/theming/application/theme-config-directory";
import { findActivePreviewSession } from "../../modules/theming/application/theme-preview-directory";
import { resolveVersionThemeCss } from "../../modules/theming/application/theme-render-resolver";
import type { ThemeConfig } from "../../modules/theming/domain/theme-config";
import type { ThemeDescriptor } from "../../modules/theming/domain/theme-descriptor";
import {
  hashPreviewToken,
  parsePreviewUrlToken
} from "../../modules/theming/domain/preview-token";
import { getThemeDescriptor } from "../../modules/theming/theme-registry";
import { resolveThemeAssetUrls, type ResolvedThemeAsset } from "./theme-media";

export type PreviewRenderContext = {
  descriptor: ThemeDescriptor;
  config: ThemeConfig;
  assetUrls: Record<string, ResolvedThemeAsset>;
  urlToken: string;
};

/**
 * Resolve a preview URL token to a renderable draft context, or `null` when the
 * token is malformed, the session is unknown/expired, the version is gone, or the
 * theme is no longer registered. Every DB read is strictly tenant-scoped, and the
 * session lookup filters `expires_at >= now` so an expired token resolves to
 * nothing.
 */
export async function resolvePreviewContext(
  urlToken: string,
  now: Date = new Date()
): Promise<PreviewRenderContext | null> {
  const parsed = parsePreviewUrlToken(urlToken);
  if (!parsed) return null;
  const sql = getDatabaseClient();
  const tokenHash = hashPreviewToken(parsed.rawToken);

  return withTenant(sql, parsed.tenantId, async (tx) => {
    const session = await findActivePreviewSession(tx, tokenHash, now);
    if (!session) return null;
    const version = await fetchVersionById(
      tx,
      parsed.tenantId,
      session.versionId
    );
    if (!version) return null;
    const descriptor = getThemeDescriptor(version.themeKey);
    if (!descriptor) return null;
    const assetUrls = await resolveThemeAssetUrls(
      tx,
      parsed.tenantId,
      version.config
    );
    return { descriptor, config: version.config, assetUrls, urlToken };
  });
}

/**
 * Serve the preview draft's token CSS. NON-INDEXABLE + `private, no-store` +
 * a distinct URL namespace from the public tokens stylesheet, so a preview can
 * never poison the public/CDN cache. Returns a 404 stylesheet comment when the
 * token does not resolve (never leaks whether a token merely expired).
 */
export async function serveThemePreviewTokensCss(
  urlToken: string,
  now: Date = new Date()
): Promise<Response> {
  const parsed = parsePreviewUrlToken(urlToken);
  const notFound = (): Response =>
    new Response("/* preview not found or expired */\n", {
      status: 404,
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow"
      }
    });
  if (!parsed) return notFound();

  const sql = getDatabaseClient();
  const tokenHash = hashPreviewToken(parsed.rawToken);

  const css = await withTenant(sql, parsed.tenantId, async (tx) => {
    const session = await findActivePreviewSession(tx, tokenHash, now);
    if (!session) return null;
    const version = await fetchVersionById(
      tx,
      parsed.tenantId,
      session.versionId
    );
    if (!version) return null;
    return resolveVersionThemeCss(version).css;
  });

  if (css === null) return notFound();

  return new Response(css, {
    status: 200,
    headers: {
      "content-type": "text/css; charset=utf-8",
      // Preview must never be cached by a shared/CDN cache or indexed.
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}
