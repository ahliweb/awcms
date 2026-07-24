/**
 * Feed protocol serialization (ADR-0038 §4) — RSS 2.0, Atom 1.0, and
 * JSON Feed 1.1 (JSON Feed is RETAINED by ADR-0038 §4, which lists
 * "RSS/Atom/JSON Feed"). Pure: no I/O.
 *
 * ## Stable identity + escape-never-reject
 *
 * Every item's GUID/`<id>`/`id` is its ABSOLUTE canonical URL — stable across
 * renders and unique per resource (the acceptance-criterion "stable entry
 * identifiers"). XML feeds escape every text value with `escapeXmlText` (the
 * frozen escape-not-reject discipline: tenant text is neutralized, never
 * rejected) — which strips the XML-1.0-illegal C0 control chars a stray title
 * could carry (they cannot be represented even as entities and would break
 * well-formedness) before entity-escaping. The JSON feed is produced with
 * `JSON.stringify`, which escapes control characters and quotes; because the
 * response is served as `application/feed+json` (not HTML), a `<`/`>` in a value
 * is inert JSON string content and needs no HTML escaping. Item `content_text`
 * (never `content_html`) is used so no tenant HTML is ever emitted into the JSON
 * feed.
 */
import { escapeXmlText } from "../../../lib/html/escape";

/** Feed-level (channel) metadata — every URL absolute and server-derived. */
export type FeedChannel = {
  title: string;
  description: string;
  /** Absolute site home URL (or relative path when there is no primary host). */
  siteUrl: string;
  /** Absolute self URL of this feed document. */
  feedUrl: string;
  /** BCP-47 language tag. */
  language: string;
  /** ISO-8601 — latest item update, or the render time for an empty feed. */
  updated: string;
  /** Absolute logo/icon URL (already resolved same-tenant/verified), or `null`. */
  logoUrl: string | null;
};

/** One feed item. */
export type FeedItem = {
  /** Stable, unique id — the absolute canonical URL. */
  id: string;
  /** Absolute canonical link (same as `id`). */
  url: string;
  title: string;
  summary: string | null;
  /** Plain-text content (never HTML). */
  contentText: string | null;
  /** ISO-8601. */
  publishedAt: string;
  /** ISO-8601, or `null`. */
  updatedAt: string | null;
  /** Absolute image URL (resolved same-tenant/verified), or `null`. */
  imageUrl: string | null;
  imageMimeType: string | null;
  /** Enclosure byte length, or `null`. */
  imageLength: number | null;
};

/** RFC-822/1123 date for RSS `<pubDate>`/`<lastBuildDate>`. */
function toRfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** RSS 2.0. */
export function renderRss(
  channel: FeedChannel,
  items: readonly FeedItem[]
): string {
  const itemXml = items.map((item) => {
    const parts: string[] = [
      `<title>${escapeXmlText(item.title)}</title>`,
      `<link>${escapeXmlText(item.url)}</link>`,
      `<guid isPermaLink="true">${escapeXmlText(item.id)}</guid>`,
      `<pubDate>${toRfc822(item.publishedAt)}</pubDate>`
    ];
    if (item.summary !== null) {
      parts.push(`<description>${escapeXmlText(item.summary)}</description>`);
    }
    if (item.imageUrl !== null) {
      parts.push(
        `<enclosure url="${escapeXmlText(item.imageUrl)}" length="${
          item.imageLength ?? 0
        }" type="${escapeXmlText(item.imageMimeType ?? "application/octet-stream")}" />`
      );
    }
    return `<item>\n${parts.map((p) => `  ${p}`).join("\n")}\n</item>`;
  });

  return `${XML_DECLARATION}
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXmlText(channel.title)}</title>
<link>${escapeXmlText(channel.siteUrl)}</link>
<atom:link href="${escapeXmlText(channel.feedUrl)}" rel="self" type="application/rss+xml" />
<description>${escapeXmlText(channel.description)}</description>
<language>${escapeXmlText(channel.language)}</language>
<lastBuildDate>${toRfc822(channel.updated)}</lastBuildDate>
${itemXml.join("\n")}
</channel>
</rss>
`;
}

/** Atom 1.0. */
export function renderAtom(
  channel: FeedChannel,
  items: readonly FeedItem[]
): string {
  const entryXml = items.map((item) => {
    const parts: string[] = [
      `<title>${escapeXmlText(item.title)}</title>`,
      `<link href="${escapeXmlText(item.url)}" />`,
      `<id>${escapeXmlText(item.id)}</id>`,
      `<published>${escapeXmlText(item.publishedAt)}</published>`,
      `<updated>${escapeXmlText(item.updatedAt ?? item.publishedAt)}</updated>`
    ];
    if (item.summary !== null) {
      parts.push(`<summary>${escapeXmlText(item.summary)}</summary>`);
    }
    return `<entry>\n${parts.map((p) => `  ${p}`).join("\n")}\n</entry>`;
  });

  const icon =
    channel.logoUrl !== null
      ? `\n<icon>${escapeXmlText(channel.logoUrl)}</icon>`
      : "";

  // RFC 4287 §4.1.1: an `atom:feed` MUST contain an `atom:author` unless EVERY
  // `atom:entry` carries its own — and entries here do not (per-item author is a
  // documented facts-contract follow-up). Emit one feed-level author, named for
  // the publication, so the document is conformant (and validators/readers that
  // reject authorless feeds accept it).
  const feedAuthor = `\n<author><name>${escapeXmlText(channel.title)}</name></author>`;

  return `${XML_DECLARATION}
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeXmlText(channel.language)}">
<title>${escapeXmlText(channel.title)}</title>
<subtitle>${escapeXmlText(channel.description)}</subtitle>
<link href="${escapeXmlText(channel.siteUrl)}" />
<link href="${escapeXmlText(channel.feedUrl)}" rel="self" type="application/atom+xml" />
<id>${escapeXmlText(channel.feedUrl)}</id>
<updated>${escapeXmlText(channel.updated)}</updated>${feedAuthor}${icon}
${entryXml.join("\n")}
</feed>
`;
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). Returns the JSON string. */
export function renderJsonFeed(
  channel: FeedChannel,
  items: readonly FeedItem[]
): string {
  const feed: Record<string, unknown> = {
    version: "https://jsonfeed.org/version/1.1",
    title: channel.title,
    home_page_url: channel.siteUrl,
    feed_url: channel.feedUrl,
    description: channel.description,
    language: channel.language,
    items: items.map((item) => {
      const jsonItem: Record<string, unknown> = {
        id: item.id,
        url: item.url,
        title: item.title,
        date_published: item.publishedAt
      };
      if (item.updatedAt !== null) jsonItem.date_modified = item.updatedAt;
      if (item.summary !== null) jsonItem.summary = item.summary;
      if (item.contentText !== null) jsonItem.content_text = item.contentText;
      if (item.imageUrl !== null) {
        jsonItem.image = item.imageUrl;
        jsonItem.attachments = [
          {
            url: item.imageUrl,
            mime_type: item.imageMimeType ?? "application/octet-stream",
            ...(item.imageLength !== null
              ? { size_in_bytes: item.imageLength }
              : {})
          }
        ];
      }
      return jsonItem;
    })
  };

  if (channel.logoUrl !== null) feed.icon = channel.logoUrl;

  return JSON.stringify(feed, null, 2);
}
