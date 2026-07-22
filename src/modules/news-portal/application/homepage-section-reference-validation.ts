/**
 * Application-layer existence/ownership checks for homepage section
 * `config_json` references (Issue #637) — the domain validator
 * (`homepage-section-policy.ts`) only checks shape (UUID format, array
 * bounds); this checks that every referenced id/slug actually exists,
 * belongs to the SAME tenant, and (for media) is a verified R2 object.
 * Same "shape in the pure validator, existence in an application-layer gate
 * called right before write" convention `news-media-reference-gate.ts`
 * (Issue #636) and `countExistingTerms` (Issue #539) already established.
 *
 * Deliberately unconditional — unlike #636's gate (which only activates
 * when full-online R2-only mode is active for the tenant, to stay backward
 * compatible with pre-existing non-R2 content), homepage sections are a
 * brand-new table with zero pre-existing rows: there is no legacy shape to
 * stay compatible with, so every reference is validated every time,
 * regardless of the tenant's R2-only mode status.
 *
 * A reference to another tenant's post/term/media object resolves to
 * "not found" here (never "found but belongs to someone else") — the
 * fetch functions this calls are themselves tenant-scoped, so a
 * cross-tenant id is indistinguishable from a nonexistent one.
 *
 * Issue #681 (epic #679, platform-hardening) — `postId`/`postIds`/
 * `categorySlugs` checks previously imported `blog-content/application/
 * blog-post-directory.ts`/`public-blog-directory.ts` directly, a genuine
 * `news_portal` application-layer import of `blog_content`'s
 * implementation. Both are now accessed only through `_shared/ports/
 * public-content-port.ts`'s `PublicContentPort` interface, injected by
 * the caller (route handler) via the concrete adapter
 * (`blog-content/application/public-content-port-adapter.ts`).
 * `mediaObjectIds` (`gallery_block`) is UNCHANGED — `news-media-object-
 * directory.ts` is this module's OWN code, not a cross-module import.
 */
import type { HomepageSectionType } from "../domain/homepage-section-policy";
import type { PublicContentPort } from "../../_shared/ports/public-content-port";
import {
  fetchNewsMediaObjectById,
  isNewsMediaObjectSafeForPublicReference
} from "./news-media-object-directory";

export type HomepageSectionReferenceValidationError = {
  field: string;
  message: string;
};

export type HomepageSectionReferenceValidationResult =
  | { valid: true }
  | { valid: false; errors: HomepageSectionReferenceValidationError[] };

async function validatePostId(
  tx: Bun.SQL,
  tenantId: string,
  postId: string,
  contentPort: PublicContentPort,
  errors: HomepageSectionReferenceValidationError[]
): Promise<void> {
  const exists = await contentPort.postExists(tx, tenantId, postId);

  if (!exists) {
    errors.push({
      field: "config.postId",
      message: `config.postId "${postId}" does not exist or does not belong to this tenant.`
    });
  }
}

async function validatePostIds(
  tx: Bun.SQL,
  tenantId: string,
  postIds: readonly string[],
  contentPort: PublicContentPort,
  errors: HomepageSectionReferenceValidationError[]
): Promise<void> {
  for (const postId of new Set(postIds)) {
    const exists = await contentPort.postExists(tx, tenantId, postId);

    if (!exists) {
      errors.push({
        field: "config.postIds",
        message: `config.postIds references "${postId}", which does not exist or does not belong to this tenant.`
      });
    }
  }
}

async function validateCategorySlugs(
  tx: Bun.SQL,
  tenantId: string,
  categorySlugs: readonly string[],
  contentPort: PublicContentPort,
  errors: HomepageSectionReferenceValidationError[]
): Promise<void> {
  for (const slug of new Set(categorySlugs)) {
    const category = await contentPort.fetchCategoryBySlug(tx, tenantId, slug);

    if (!category) {
      errors.push({
        field: "config.categorySlugs",
        message: `config.categorySlugs references "${slug}", which does not exist as a category for this tenant.`
      });
    }
  }
}

async function validateMediaObjectIds(
  tx: Bun.SQL,
  tenantId: string,
  mediaObjectIds: readonly string[],
  errors: HomepageSectionReferenceValidationError[]
): Promise<void> {
  for (const mediaObjectId of new Set(mediaObjectIds)) {
    const media = await fetchNewsMediaObjectById(tx, tenantId, mediaObjectId);

    if (!media || !isNewsMediaObjectSafeForPublicReference(media.status)) {
      errors.push({
        field: "config.mediaObjectIds",
        message: `config.mediaObjectIds references "${mediaObjectId}", which does not exist, does not belong to this tenant, or is not a verified R2 media object.`
      });
    }
  }
}

/** Runs inside the caller's own tenant-scoped transaction (same `tx` the route handler already opened via `withTenant`). `contentPort` is the caller-injected `PublicContentPort` implementation. */
export async function validateHomepageSectionReferences(
  tx: Bun.SQL,
  tenantId: string,
  sectionType: HomepageSectionType,
  config: Record<string, unknown>,
  contentPort: PublicContentPort
): Promise<HomepageSectionReferenceValidationResult> {
  const errors: HomepageSectionReferenceValidationError[] = [];

  switch (sectionType) {
    case "headline":
      await validatePostId(
        tx,
        tenantId,
        config.postId as string,
        contentPort,
        errors
      );
      break;
    case "featured_posts":
    case "editor_picks":
      await validatePostIds(
        tx,
        tenantId,
        config.postIds as string[],
        contentPort,
        errors
      );
      break;
    case "category_grid":
      await validateCategorySlugs(
        tx,
        tenantId,
        config.categorySlugs as string[],
        contentPort,
        errors
      );
      break;
    case "gallery_block":
      await validateMediaObjectIds(
        tx,
        tenantId,
        config.mediaObjectIds as string[],
        errors
      );
      break;
    case "latest_posts": {
      const categorySlug = config.categorySlug as string | null;
      if (categorySlug) {
        await validateCategorySlugs(
          tx,
          tenantId,
          [categorySlug],
          contentPort,
          errors
        );
      }
      break;
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
