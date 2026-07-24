/**
 * Server-side `<head>` renderer for the central SEO document (ADR-0038,
 * ADR-0038 §4). Turns a fully-resolved `SeoDocument` (`seo-document.ts`) into the
 * exact HTML tags an Astro SSR route places inside `<head>`: title, meta
 * description, robots, canonical, hreflang alternates, Open Graph, Twitter card,
 * and controlled JSON-LD.
 *
 * This is the ONLY place SEO markup is stringified, and it does so through two
 * escapers by construction so a caller can never forget one:
 *
 * - `escapeHtml` for every attribute text value (title/description/urls/etc.);
 * - the port's `renderControlledJsonLd` for JSON-LD — it validates the
 *   controlled `@type`/key schema AND escapes `<`,`>`,`&`,U+2028,U+2029 across
 *   the whole serialized string, so a value or key can never terminate the
 *   `<script>` element (ADR-0038 threat model, JSON-LD injection). We do NOT
 *   hand-serialize JSON-LD here.
 */
import { escapeHtml } from "../../../lib/html/escape";
import { renderControlledJsonLd } from "../../_shared/ports/seo-facts-port";
import type {
  ResolvedSeoImage,
  SeoDocument,
  SeoOpenGraphModel,
  SeoTwitterModel
} from "./seo-document";

/** Normalize a BCP-47 tag to the `language_TERRITORY` shape Open Graph prefers, without inventing a territory (`en` stays `en`). */
function toOgLocale(locale: string): string {
  return locale.replace(/-/g, "_");
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${escapeHtml(property)}" content="${escapeHtml(
    content
  )}" />`;
}

function metaName(name: string, content: string): string {
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}" />`;
}

function renderOpenGraphTags(og: SeoOpenGraphModel): string[] {
  const tags: string[] = [
    metaProperty("og:type", og.type),
    metaProperty("og:title", og.title),
    metaProperty("og:site_name", og.siteName)
  ];
  if (og.description !== null) {
    tags.push(metaProperty("og:description", og.description));
  }
  if (og.url !== null) {
    tags.push(metaProperty("og:url", og.url));
  }
  if (og.locale.length > 0) {
    tags.push(metaProperty("og:locale", toOgLocale(og.locale)));
  }
  tags.push(...renderImageTags(og.image));
  return tags;
}

function renderImageTags(image: ResolvedSeoImage | null): string[] {
  if (image === null) return [];
  const tags: string[] = [
    metaProperty("og:image", image.url),
    // Same verified HTTPS URL — some clients only trust the secure_url variant.
    metaProperty("og:image:secure_url", image.url),
    metaProperty("og:image:type", image.mimeType)
  ];
  if (image.width !== null) {
    tags.push(metaProperty("og:image:width", String(image.width)));
  }
  if (image.height !== null) {
    tags.push(metaProperty("og:image:height", String(image.height)));
  }
  if (image.alt !== null) {
    tags.push(metaProperty("og:image:alt", image.alt));
  }
  return tags;
}

function renderTwitterTags(twitter: SeoTwitterModel): string[] {
  const tags: string[] = [
    metaName("twitter:card", twitter.card),
    metaName("twitter:title", twitter.title)
  ];
  if (twitter.site !== null) {
    tags.push(metaName("twitter:site", twitter.site));
  }
  if (twitter.description !== null) {
    tags.push(metaName("twitter:description", twitter.description));
  }
  if (twitter.image !== null) {
    tags.push(metaName("twitter:image", twitter.image.url));
    if (twitter.image.alt !== null) {
      tags.push(metaName("twitter:image:alt", twitter.image.alt));
    }
  }
  return tags;
}

function renderJsonLdScripts(document: SeoDocument): string[] {
  // One `<script>` per node — each node is validated + escaped by
  // `renderControlledJsonLd`. A node that fails validation THROWS (it never
  // silently renders unsafe markup); the caller runs this inside its own
  // try/catch and returns a server error rather than a poisoned page.
  return document.jsonLd.map(
    (node) =>
      `<script type="application/ld+json">${renderControlledJsonLd(
        node
      )}</script>`
  );
}

/**
 * Render the SEO-relevant `<head>` tags for one resource, newline-joined. Does
 * NOT emit `<head>`/`<html>`/`<title>`-shell chrome beyond the `<title>` itself
 * — an Astro route embeds this fragment inside its own document shell (or a
 * layout does), so this composes rather than owns the whole page.
 */
export function renderSeoHeadTags(document: SeoDocument): string {
  const tags: string[] = [`<title>${escapeHtml(document.title)}</title>`];

  if (document.description !== null) {
    tags.push(metaName("description", document.description));
  }

  tags.push(metaName("robots", document.robots));
  tags.push(
    `<link rel="canonical" href="${escapeHtml(document.canonicalUrl)}" />`
  );

  for (const alternate of document.localeAlternates) {
    tags.push(
      `<link rel="alternate" hreflang="${escapeHtml(
        alternate.hreflang
      )}" href="${escapeHtml(alternate.href)}" />`
    );
  }

  tags.push(...renderOpenGraphTags(document.openGraph));
  tags.push(...renderTwitterTags(document.twitter));
  tags.push(...renderJsonLdScripts(document));

  return tags.join("\n");
}
