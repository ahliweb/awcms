# Articles Module Documentation

## Purpose
Describe the article workflows and data model used by the CMS.

## Audience
- Admin panel developers
- Content workflow maintainers

## Prerequisites
- `awcms/docs/00-core/SOFT_DELETE.md`
- `awcms/docs/03-features/ABAC_SYSTEM.md`

The Articles module is a full-featured blogging and news management system designed for high-performance publishing. It integrates a headless TipTap editor with a strict publishing workflow.

## Core Concepts

1. **Rich Text Editor**: TipTap-based editor (`tiptap_doc_jsonb`) ensuring clean, XSS-safe JSON output.
2. **Workflow State Machine**: `Draft` -> `Reviewed` -> `Approved` -> `Published`.
3. **SEO Management**: Custom Meta Title/Description and OpenGraph support.
4. **Taxonomy**: Categorization and Tagging specialized for Content.

## How It Works

Stored in `articles` table:

* `slug`: Unique identifier for routing (e.g., `/blog/my-post`).
* `tiptap_doc_jsonb`: The source of truth for content.
* `content`: HTML fallback (optional/legacy).
* `puck_layout_jsonb`: Optional Visual Builder layout for "Long-form" articles.

## Implementation Patterns

1. **Draft**: Author creates content. Visible only to Author/Editor.
2. **In Review**: Author submits for review. Editor receives notification.
3. **Approved**: Editor approves content. Ready for scheduling.
4. **Published**: Publicly visible via `published_articles_view`.

## Operational Concerns

The Public Portal fetches articles via `published_articles_view` to ensure:

1. Only `status = 'published'` items are fetched.
2. Internal fields (like internal notes) are stripped.
3. `tiptap_doc_jsonb` is rendered using `TipTapRenderer.tsx`.

### TipTap Rendering

The `TipTapRenderer` converts the JSON document into accessible React components (Semantic HTML5: `h1`, `p`, `blockquote`, `img`).

---

## Permissions and Access

- Use `tenant.article.*` permission keys for article actions.

## Security and Compliance Notes

- Always filter `deleted_at` and enforce RLS.

## References

- `../03-features/ABAC_SYSTEM.md`
- `../00-core/SOFT_DELETE.md`
