> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 3 (Modules)

# Blogs Module Documentation

## Purpose

Describe the blog workflows and data model used by the CMS (legacy index/constraint names may still reference "articles").

## Audience

- Admin panel developers
- Content workflow maintainers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for content module architecture
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/architecture/database.md`
- `docs/security/abac.md`

The Blogs module is a full-featured blogging and news management system designed for high-performance publishing. It integrates a headless TipTap editor with a strict publishing workflow.

## Core Concepts

1. **Rich Text Editor**: TipTap-based editor (`tiptap_doc_jsonb`) ensuring clean, XSS-safe JSON output.
2. **Workflow State Machine**: `draft` -> `reviewed` -> `approved` -> `published`.
3. **SEO Management**: Custom Meta Title/Description and OpenGraph support.
4. **Taxonomy**: Categorization and tagging for content.

## How It Works

Stored in `blogs` table:

- `slug`: Unique identifier for routing (e.g., `/blogs/my-post`).
- `tiptap_doc_jsonb`: The source of truth for content.
- `content`: HTML fallback (optional).
- `puck_layout_jsonb`: Optional Visual Builder layout for "Long-form" posts.

## Admin UI

| Route | Purpose | Notes |
| --- | --- | --- |
| `/cmspanel/blogs` | Blog list | Default blog tab. |
| `/cmspanel/blogs/categories` | Blog categories | Tabs map to sub-slugs. |
| `/cmspanel/blogs/tags` | Blog tags | Tabs map to sub-slugs. |
| `/cmspanel/blogs/queue` | Review queue | Filters `workflow_state = reviewed`. |
| `/cmspanel/blogs/trash` | Trash view | Soft-deleted blogs only. |
| `/cmspanel/blogs/edit/:id` | Edit blog | `:id` uses signed route params (`{uuid}.{signature}`). |

## Implementation Patterns

1. **Draft**: Author creates content. Visible only to authorized tenant users.
2. **Reviewed**: Content enters the review queue (`/cmspanel/blogs/queue`).
3. **Approved**: Content is approved and ready for publish/scheduling workflows.
4. **Published**: Publicly visible through tenant-scoped `blogs` queries filtered to `status = 'published'` and `deleted_at IS NULL`.

## Operational Concerns

The Public Portal currently fetches posts directly from `blogs` to ensure:

1. Only `status = 'published'` items are fetched.
2. Tenant scoping is explicit in the query path.
3. Rendering uses HTML/markdown content or Puck layouts where configured.

`published_blogs_view` remains part of schema history and can still be useful for restricted read surfaces,
but it is not the current public-portal fetch path.

### TipTap JSON

`tiptap_doc_jsonb` stores structured content. If you enable TipTap JSON rendering, ensure it is converted to safe semantic HTML (no raw HTML injection).

### Context7 Guidance (TipTap)

- Use `StarterKit` as the base extension set.
- Configure built-in extensions via `StarterKit.configure({ ... })`, and additional extensions with `Extension.configure({ ... })` (for example `Image`, `Table`, `TextAlign`).
- Avoid rendering untrusted HTML; prefer JSON-to-HTML mapping or sanitized HTML output.

---

## Permissions and Access

- Use `tenant.blog.*` permission keys for blog actions.

## Security and Compliance Notes

- Always filter `deleted_at` and enforce RLS.

## References

- `docs/security/abac.md`
- `docs/architecture/database.md`
