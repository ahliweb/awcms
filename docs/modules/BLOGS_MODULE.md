> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Blogs Module Documentation

## Purpose

Describe the current blogs module in AWCMS: authoring workflow, tenant-scoped/public query behavior, localized overlays, and the current Pages-owned presentation model for blog detail layouts.

## Current Blogs Model

The current blogs module is focused on article/content management, not page-level visual presentation ownership.

Current important concepts include:

- structured authoring and metadata on `blogs`
- workflow/publish-state behavior
- categories/tags/taxonomy support
- localized overlays through `content_translations`
- Pages-owned visual presentation for single-post layouts

## Current Data Model

Current important `blogs` concepts still include:

- `slug` for routing
- structured body fields such as `tiptap_doc_jsonb`
- optional HTML fallback/content surfaces where present
- publish/workflow metadata
- tenant scope and soft-delete lifecycle

Current important rule:

- public blog reads must stay published-only and non-deleted

## Current Workflow Model

The checked-in module still supports a staged publishing workflow.

Current practical flow remains conceptually:

1. draft authoring
2. review-oriented queue state
3. approval/publish readiness
4. published public visibility

Exact state values and queue behaviors should follow the current implementation and migration baseline rather than an older static diagram.

## Current Admin Surface

Important current blog-related admin routes include:

- `/cmspanel/blogs`
- `/cmspanel/blogs/categories`
- `/cmspanel/blogs/tags`
- `/cmspanel/blogs/queue`
- `/cmspanel/blogs/trash`
- `/cmspanel/blogs/edit/:id`

Current route note:

- edit routes follow the current signed-route-param conventions

## Current Presentation Model

Blog presentation is currently owned by the Pages/template composition system rather than by direct blog-row visual-builder editing.

Current practical implications:

- article body/metadata is managed in the Blogs module
- single-post visual presentation is managed via Pages-owned templates such as `single_post`
- editors should change content in Blogs and presentation in the template/page composition system

## Current Localization Model

Localized blog overlays currently use `content_translations`.

Current important rule:

- localized overlay rows for blogs should continue to follow the current content-type conventions used by the live query/render paths

## Current Public Query Model

Public portals currently fetch blogs directly from `blogs` using tenant-aware, published-only, non-deleted query paths.

Current important rules:

- tenant scoping is explicit
- published filtering is explicit
- deleted filtering is explicit
- blog detail rendering may combine blog content with Pages-owned template composition

## Current TipTap Note

Where `tiptap_doc_jsonb` or structured content is used, it should continue to render through safe structured/rendered paths rather than unsafe raw HTML assumptions.

## Current Permission Guidance

Blog actions should align with canonical `tenant.blog.*` permission families.

Current practical examples include:

- read
- create
- update
- publish
- delete / restore behavior where applicable

## Current Security Notes

- keep tenant filtering explicit
- keep `deleted_at` filtering explicit for normal reads
- keep public visibility limited to published rows
- preserve RLS and ABAC boundaries in admin and public query paths

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/blog changes | `cd awcms && npm run build` |
| public blog/rendering changes | `cd awcms-public/primary && npm run check:astro` |
| edge/public route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/security/abac.md](../security/abac.md)
- [docs/architecture/database.md](../architecture/database.md)
- [docs/modules/VISUAL_BUILDER.md](./VISUAL_BUILDER.md)
- [docs/modules/TEMPLATE_SYSTEM.md](./TEMPLATE_SYSTEM.md)
