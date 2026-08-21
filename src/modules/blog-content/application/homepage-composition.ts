/**
 * Resolves the editorial homepage sections into something a renderer can draw
 * (Issue #594).
 *
 * `listActiveHomepageSectionsForRendering` has existed since `sql/044` and has
 * never had a caller. Its own docblock says why this file has to exist: a
 * section being active does not mean everything it REFERENCES is still public.
 * A curated post can be unpublished, a category archived, a media object
 * deleted — the section survives all three, and resolving it is where that gets
 * noticed.
 *
 * ## The deterministic fallback (PRD LenteraKalteng §10)
 *
 * A curated slot whose articles have all gone is the failure case that matters:
 * the homepage would otherwise render a heading with nothing under it, which
 * reads as a broken site rather than as an editorial gap. So a curated slot that
 * resolves to nothing is filled from the most recent eligible articles, and
 * `fellBackToLatest` records that it happened.
 *
 * Deterministic means two things here, both load-bearing:
 *
 * 1. **No randomness and no clock beyond the one passed in.** Same rows, same
 *    `now`, same page — which is what makes the result safe to put in a shared
 *    edge cache.
 * 2. **One fallback pool, consumed in order, with nothing repeated.** Every
 *    article already placed by an earlier section is excluded, so a fallback can
 *    never duplicate an article the editor deliberately curated three sections
 *    above. That makes a section's content depend on the sections before it,
 *    which is still a pure function of the same inputs.
 *
 * ## Why the query count is bounded, and where it is bounded
 *
 * This runs on an anonymous public page, so an unbounded query count is a
 * request anybody can make expensive. `listActiveHomepageSectionsForRendering`
 * already caps at 50 sections, but 50 `category_grid` sections at 8 categories
 * each would be 400 queries for one page view.
 *
 * Two caps close that, and both REPORT rather than truncate silently:
 * `MAX_RENDERED_SECTIONS` and `MAX_CATEGORY_GROUPS`. Everything else is bulk —
 * one query for every curated post id on the page, one for every category slug,
 * one media resolution for every image — so the total is a small constant plus
 * those two caps.
 */
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";
import type { HomepageSectionType } from "../domain/homepage-section-policy";
// The RENDER MODEL is declared in `domain/`, and consumed in both directions
// from there: this file produces it, `domain/homepage-section-rendering.ts`
// draws it. Declaring it here instead would make the renderer import the
// application layer, which is the wrong way round and the only import of that
// shape anywhere in this module.
import type {
  ComposedHomepage,
  ComposedHomepageImage
} from "../domain/homepage-section-rendering";
import {
  listActiveHomepageSectionsForRendering,
  type HomepageSectionView
} from "./homepage-section-directory";
import {
  fetchPublicBlogPostSummariesByIds,
  fetchPublicTermsBySlugs,
  listPublicBlogPosts,
  listPublicBlogPostsByTermId,
  type PublicBlogPostSummary,
  type PublicTermSummary
} from "./public-blog-directory";
import { log } from "../../../lib/logging/logger";

/**
 * A homepage with more than a dozen sections is a different problem than this
 * composer solves, and the public index needs a query count somebody can state.
 */
export const MAX_RENDERED_SECTIONS = 12;

/** Across the WHOLE page, not per section — one grid of 8 plus another of 8 is 12 groups drawn and 4 reported. */
export const MAX_CATEGORY_GROUPS = 12;

/** How deep the shared fallback pool goes. Twelve sections cannot exhaust it. */
const FALLBACK_POOL_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configStrings(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function configString(
  config: Record<string, unknown>,
  key: string
): string | null {
  const value = config[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function configNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = config[key];

  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

/** Which section types curate an explicit list of articles — the ones a fallback rescues. */
function isCurated(sectionType: HomepageSectionType): boolean {
  return (
    sectionType === "headline" ||
    sectionType === "featured_posts" ||
    sectionType === "editor_picks"
  );
}

/** How many articles a curated slot should end up with when its curation is empty. */
function fallbackSize(sectionType: HomepageSectionType): number {
  return sectionType === "headline" ? 1 : 3;
}

export async function composeHomepage(
  tx: Bun.SQL,
  tenantId: string,
  mediaPort: MediaLibraryPort,
  now: Date = new Date()
): Promise<ComposedHomepage> {
  const active = await listActiveHomepageSectionsForRendering(
    tx,
    tenantId,
    now
  );

  if (active.length === 0) {
    return { sections: [], isEmpty: true };
  }

  const sections = active.slice(0, MAX_RENDERED_SECTIONS);

  if (active.length > sections.length) {
    // Reported, not silent: a section an editor enabled and cannot see on the
    // page is indistinguishable from a bug unless something says otherwise.
    log("warning", "blog-content.homepage.sections_truncated", {
      tenantId,
      moduleKey: "blog_content",
      active: active.length,
      rendered: sections.length
    });
  }

  // --- bulk pass 1: every curated post id on the page, in one query ----------
  const curatedIds = new Set<string>();

  for (const section of sections) {
    const config = isRecord(section.config) ? section.config : {};

    if (section.sectionType === "headline") {
      const postId = configString(config, "postId");
      if (postId) curatedIds.add(postId);
      continue;
    }

    if (
      section.sectionType === "featured_posts" ||
      section.sectionType === "editor_picks"
    ) {
      for (const id of configStrings(config, "postIds")) curatedIds.add(id);
    }
  }

  const curatedById = new Map<string, PublicBlogPostSummary>(
    (
      await fetchPublicBlogPostSummariesByIds(tx, tenantId, [...curatedIds])
    ).map((post) => [post.id, post])
  );

  // --- bulk pass 2: every category slug on the page, in one query ------------
  const slugs = new Set<string>();

  for (const section of sections) {
    const config = isRecord(section.config) ? section.config : {};

    if (section.sectionType === "latest_posts") {
      const slug = configString(config, "categorySlug");
      if (slug) slugs.add(slug);
      continue;
    }

    if (section.sectionType === "category_grid") {
      for (const slug of configStrings(config, "categorySlugs")) {
        slugs.add(slug);
      }
    }
  }

  const termBySlug = new Map<string, PublicTermSummary>(
    (await fetchPublicTermsBySlugs(tx, tenantId, "category", [...slugs])).map(
      (term) => [term.slug, term]
    )
  );

  // --- resolution -----------------------------------------------------------
  const placedPostIds = new Set<string>();
  let fallbackPool: PublicBlogPostSummary[] | null = null;
  let groupBudget = MAX_CATEGORY_GROUPS;
  let droppedGroups = 0;

  /** Fetched at most once per request, and only if some slot actually needs it. */
  async function takeFromFallback(
    count: number
  ): Promise<PublicBlogPostSummary[]> {
    if (fallbackPool === null) {
      fallbackPool = (
        await listPublicBlogPosts(tx, tenantId, {
          page: 1,
          pageSize: FALLBACK_POOL_SIZE
        })
      ).items;
    }

    const taken: PublicBlogPostSummary[] = [];

    for (const post of fallbackPool) {
      if (taken.length >= count) break;
      if (placedPostIds.has(post.id)) continue;
      taken.push(post);
      placedPostIds.add(post.id);
    }

    return taken;
  }

  function place(posts: PublicBlogPostSummary[]): PublicBlogPostSummary[] {
    for (const post of posts) placedPostIds.add(post.id);

    return posts;
  }

  type Resolved = {
    section: HomepageSectionView;
    groups: {
      heading: string | null;
      slug: string | null;
      posts: PublicBlogPostSummary[];
    }[];
    mediaObjectIds: string[];
    caption: string | null;
    fellBackToLatest: boolean;
  };

  const resolved: Resolved[] = [];

  for (const section of sections) {
    const config = isRecord(section.config) ? section.config : {};
    const entry: Resolved = {
      section,
      groups: [],
      mediaObjectIds: [],
      caption: null,
      fellBackToLatest: false
    };

    switch (section.sectionType) {
      case "headline":
      case "featured_posts":
      case "editor_picks": {
        const ids =
          section.sectionType === "headline"
            ? [configString(config, "postId")].filter(
                (id): id is string => id !== null
              )
            : configStrings(config, "postIds");

        // Curation ORDER is preserved, and an id that no longer resolves is
        // dropped rather than rendered as a gap — the same "degrade, don't 500"
        // convention `fetchPublicBlogPostSummariesByIds` already applies.
        const posts = place(
          ids
            .map((id) => curatedById.get(id))
            .filter((post): post is PublicBlogPostSummary => post !== undefined)
        );

        entry.groups = [{ heading: null, slug: null, posts }];
        break;
      }

      case "latest_posts": {
        const limit = configNumber(config, "limit", 5);
        const slug = configString(config, "categorySlug");
        const term = slug ? (termBySlug.get(slug) ?? null) : null;

        // A configured category that no longer exists means the section's whole
        // premise is gone, so it renders empty rather than silently widening to
        // every category — an editor asking for "Politik" must not get "all".
        const posts =
          slug && !term
            ? []
            : term
              ? (
                  await listPublicBlogPostsByTermId(tx, tenantId, term.id, {
                    page: 1,
                    pageSize: limit
                  })
                ).items
              : (
                  await listPublicBlogPosts(tx, tenantId, {
                    page: 1,
                    pageSize: limit
                  })
                ).items;

        entry.groups = [
          {
            heading: term?.name ?? null,
            slug: term?.slug ?? null,
            posts: place(posts)
          }
        ];
        break;
      }

      case "category_grid": {
        const perCategory = configNumber(config, "postsPerCategory", 3);

        for (const slug of configStrings(config, "categorySlugs")) {
          const term = termBySlug.get(slug);
          if (!term) continue;

          if (groupBudget <= 0) {
            droppedGroups += 1;
            continue;
          }

          groupBudget -= 1;

          const posts = (
            await listPublicBlogPostsByTermId(tx, tenantId, term.id, {
              page: 1,
              pageSize: perCategory
            })
          ).items;

          entry.groups.push({
            heading: term.name,
            slug: term.slug,
            posts: place(posts)
          });
        }
        break;
      }

      case "gallery_block": {
        entry.mediaObjectIds = configStrings(config, "mediaObjectIds");
        entry.caption = configString(config, "caption");
        break;
      }
    }

    // The fallback rescues curated slots only. `latest_posts` and
    // `category_grid` are already queries against live content: if they come
    // back empty the tenant genuinely has nothing to show there, and
    // substituting unrelated articles would misrepresent the category.
    if (isCurated(section.sectionType) && entry.groups[0]?.posts.length === 0) {
      entry.groups[0].posts = await takeFromFallback(
        fallbackSize(section.sectionType)
      );
      entry.fellBackToLatest = entry.groups[0].posts.length > 0;
    }

    resolved.push(entry);
  }

  if (droppedGroups > 0) {
    log("warning", "blog-content.homepage.category_groups_truncated", {
      tenantId,
      moduleKey: "blog_content",
      dropped: droppedGroups,
      cap: MAX_CATEGORY_GROUPS
    });
  }

  // --- bulk pass 3: one media resolution for every image on the page --------
  const mediaIds = new Set<string>();

  for (const entry of resolved) {
    for (const id of entry.mediaObjectIds) mediaIds.add(id);

    for (const group of entry.groups) {
      for (const post of group.posts) {
        if (post.featuredMediaId) mediaIds.add(post.featuredMediaId);
      }
    }
  }

  const media = await mediaPort.resolveMediaReferences(tx, tenantId, [
    ...mediaIds
  ]);

  function toImage(id: string | null): ComposedHomepageImage | null {
    if (!id) return null;

    const resolvedMedia = media.get(id);

    return resolvedMedia
      ? {
          url: resolvedMedia.publicUrl,
          altText: resolvedMedia.altText,
          width: resolvedMedia.width,
          height: resolvedMedia.height
        }
      : null;
  }

  return {
    isEmpty: false,
    sections: resolved.map((entry) => ({
      sectionKey: entry.section.sectionKey,
      sectionType: entry.section.sectionType,
      title: entry.section.title,
      groups: entry.groups.map((group) => ({
        heading: group.heading,
        slug: group.slug,
        posts: group.posts.map((post) => ({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          publishedAt: post.publishedAt,
          image: toImage(post.featuredMediaId)
        }))
      })),
      // An unresolved id renders nothing rather than a broken `<img>`, the same
      // rule `renderContentJsonToHtml` applies to a gallery block in an article.
      images: entry.mediaObjectIds
        .map((id) => toImage(id))
        .filter((image): image is ComposedHomepageImage => image !== null),
      caption: entry.caption,
      fellBackToLatest: entry.fellBackToLatest
    }))
  };
}
