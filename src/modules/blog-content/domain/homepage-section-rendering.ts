/**
 * Draws a composed homepage (Issue #594).
 *
 * Pure: a resolved model goes in, an HTML string comes out. Every reference has
 * already been checked against live, public content by
 * `application/homepage-composition.ts`, so nothing here decides visibility —
 * which is deliberate, because a renderer that could also hide things would be a
 * second place for the publication rule to live.
 *
 * Every text value passes through `escapeHtml`, and every URL is either built
 * from a base path this application controls or is a media URL the media library
 * already vouched for. There is no path by which section configuration reaches
 * the output as markup: the config vocabulary is uuids, slugs and integers, and
 * the only free text on the page — the section title and the gallery caption —
 * is escaped like any other.
 *
 * Section headings are `<h2>` and category-column headings `<h3>`, under the
 * page's single `<h1>`. That is the whole accessibility contract this file has,
 * and it is why the heading level is not a parameter: a caller free to pick
 * would eventually pick one that skips a level.
 */
import { escapeHtml } from "../../../lib/html/escape";
import type { HomepageSectionType } from "./homepage-section-policy";

export type ComposedHomepageImage = {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
};

export type ComposedHomepagePostCard = {
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: Date;
  image: ComposedHomepageImage | null;
};

export type ComposedHomepageGroup = {
  /** Category name for a grid column; `null` for a section with one ungrouped list. */
  heading: string | null;
  /** Category slug, so the renderer can link the column to its archive. `null` when ungrouped. */
  slug: string | null;
  posts: ComposedHomepagePostCard[];
};

export type ComposedHomepageSection = {
  sectionKey: string;
  sectionType: HomepageSectionType;
  title: string | null;
  groups: ComposedHomepageGroup[];
  images: ComposedHomepageImage[];
  caption: string | null;
  /** True when curation resolved to nothing and the latest eligible articles were substituted. */
  fellBackToLatest: boolean;
};

export type ComposedHomepage = {
  sections: ComposedHomepageSection[];
  /**
   * True when the tenant has composed nothing at all. The caller renders its
   * ordinary chronological index in that case — a tenant that has never opened
   * the composer must not get a blank front page.
   */
  isEmpty: boolean;
};

function renderImage(image: ComposedHomepageImage | null): string {
  if (!image) {
    return "";
  }

  // `loading="lazy"` on every homepage image: this page can carry dozens, and
  // they are below the fold the moment there is more than one section.
  const dimensions = [
    image.width === null ? "" : ` width="${image.width}"`,
    image.height === null ? "" : ` height="${image.height}"`
  ].join("");

  return `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText ?? "")}" loading="lazy"${dimensions} />`;
}

function renderCard(
  basePath: string,
  post: ComposedHomepagePostCard,
  headingTag: "h2" | "h3"
): string {
  const href = `${escapeHtml(basePath)}/${escapeHtml(post.slug)}`;

  return `<article class="hp-card">
  <a href="${href}">${renderImage(post.image)}</a>
  <${headingTag}><a href="${href}">${escapeHtml(post.title)}</a></${headingTag}>
  <p><time datetime="${post.publishedAt.toISOString()}">${escapeHtml(post.publishedAt.toDateString())}</time></p>
  ${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ""}
</article>`;
}

function renderGroup(
  basePath: string,
  group: ComposedHomepageGroup,
  cardHeadingTag: "h2" | "h3"
): string {
  const heading =
    group.heading === null
      ? ""
      : group.slug === null
        ? `<h3>${escapeHtml(group.heading)}</h3>`
        : `<h3><a href="${escapeHtml(basePath)}/category/${escapeHtml(group.slug)}">${escapeHtml(group.heading)}</a></h3>`;

  const cards = group.posts
    .map((post) => renderCard(basePath, post, cardHeadingTag))
    .join("\n");

  return `<div class="hp-group">${heading}${cards}</div>`;
}

export function renderHomepageSectionHtml(
  basePath: string,
  section: ComposedHomepageSection
): string {
  const title = section.title ? `<h2>${escapeHtml(section.title)}</h2>` : "";

  if (section.sectionType === "gallery_block") {
    // A gallery whose every image failed to resolve renders nothing at all,
    // heading included: a caption with no pictures under it is worse than an
    // absent section, because it tells a reader something is missing without
    // telling them what.
    if (section.images.length === 0) {
      return "";
    }

    const figures = section.images
      .map((image) => `<figure>${renderImage(image)}</figure>`)
      .join("\n");
    const caption = section.caption
      ? `<p class="hp-caption">${escapeHtml(section.caption)}</p>`
      : "";

    return `<section class="hp-section hp-section--gallery" data-section-key="${escapeHtml(section.sectionKey)}">
${title}
<div class="hp-gallery">${figures}</div>
${caption}
</section>`;
  }

  const hasPosts = section.groups.some((group) => group.posts.length > 0);

  // Same argument as the gallery: an empty section is dropped rather than drawn
  // as a heading over nothing. A CURATED slot can only reach this point when the
  // fallback also came back empty, which means the tenant has no eligible
  // articles at all.
  if (!hasPosts) {
    return "";
  }

  // A grid names its columns, so the card headings drop a level to sit under
  // them. Every other type has one ungrouped list directly under the section.
  const cardHeadingTag =
    section.sectionType === "category_grid" ? "h3" : ("h2" as const);
  const groups = section.groups
    .filter((group) => group.posts.length > 0)
    .map((group) => renderGroup(basePath, group, cardHeadingTag))
    .join("\n");

  return `<section class="hp-section hp-section--${escapeHtml(section.sectionType)}" data-section-key="${escapeHtml(section.sectionKey)}">
${title}
${groups}
</section>`;
}

/**
 * The whole composed homepage.
 *
 * Returns an empty string when nothing survived resolution — the caller falls
 * back to its ordinary chronological index, which is the same answer a tenant
 * that never opened the composer gets. A front page that renders as a blank
 * because every curated reference expired is the outcome this exists to avoid.
 */
export function renderComposedHomepageHtml(
  basePath: string,
  composed: ComposedHomepage
): string {
  return composed.sections
    .map((section) => renderHomepageSectionHtml(basePath, section))
    .filter((html) => html.length > 0)
    .join("\n");
}
