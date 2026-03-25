> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md)

# Tags Module QA Checklist

## Purpose

Provide a concise manual verification checklist for the AWCMS Admin Tags overhaul under `/cmspanel`, including the standalone Tags manager and the embedded tags experiences in Blogs and Pages.

## Scope

- Standalone Tags manager: `/cmspanel/tags`
- Standalone trash view: `/cmspanel/tags/trash`
- Embedded blog tags: `/cmspanel/blogs/tags`
- Embedded page tags: `/cmspanel/pages/tags`
- Nested trash views for embedded tags tabs

## Preconditions

Before running this checklist:

| Item | Requirement |
| --- | --- |
| Auth | Signed in to the Admin Panel |
| Base URL | Admin routes resolve under `/cmspanel` |
| Tenant context | A tenant is selected when testing tenant-scoped behavior |
| Data | At least a few tags, one blog, and one page exist |
| Permissions | Test with both full-access and restricted roles when possible |

## Routing and Refresh Safety

### Standalone Tags

- Open `/cmspanel/tags` and confirm the manager loads without errors.
- Refresh `/cmspanel/tags` and confirm the active view remains stable.
- Open `/cmspanel/tags/trash` and confirm the trash view loads correctly.
- Refresh `/cmspanel/tags/trash` and confirm the trash view persists.
- Open an invalid path such as `/cmspanel/tags/invalid` and confirm it redirects back to `/cmspanel/tags`.

### Embedded Blog/Page Tags

- Open `/cmspanel/blogs/tags` and confirm the tags tab survives refresh.
- Open `/cmspanel/blogs/tags/trash` and confirm nested trash survives refresh.
- Open `/cmspanel/pages/tags` and confirm the tags tab survives refresh.
- Open `/cmspanel/pages/tags/trash` and confirm nested trash survives refresh.

## UI and Layout Checks

- Confirm the top Tags hero/header card renders correctly with the action bar on the right.
- Confirm there is generous vertical spacing between the hero/header surface and the three KPI cards.
- Confirm KPI cards render with consistent spacing, typography, and responsive behavior.
- Confirm the search/filter bar is visually separated from the cards and table.
- Confirm the pagination surface matches the updated visual style.

## Search and Filtering

- Confirm the search input no longer repeats `5+ chars` in the placeholder.
- Confirm the live length counter still communicates the minimum search threshold.
- Type fewer than 5 characters and confirm validation messaging behaves correctly.
- Type a valid search query and confirm tag results filter as expected.
- Clear the search and confirm the full list returns.
- In standalone Tags, change the module filter and confirm results update correctly.
- In embedded blog/page tags, confirm the module filter is locked to the relevant module context.
- Toggle active/inactive filters and confirm results update correctly.

## Tag CRUD

### Create

- Create a new tag from `/cmspanel/tags`.
- Confirm the editor dialog opens with the upgraded layout.
- Confirm the slug auto-fills for a new tag when typing a name.
- Confirm the color preview updates immediately when the color changes.
- Save and confirm the tag appears in the active list.

### Edit

- Edit an existing tag.
- Confirm the modal loads current values correctly.
- Save changes and confirm the updated data appears in the table.
- Confirm changes are reflected in related selectors and tag-aware editors.

### Delete and Restore

- Soft-delete a tag from the active list.
- Confirm it disappears from active results and appears in trash.
- Restore the same tag from trash.
- Confirm it returns to the active list.

## Cross-Module Integration

### Pages

- Open a page editor in `/cmspanel/pages`.
- Add both an existing tag and a new tag in the page editor.
- Save the page and reopen it.
- Confirm tag assignments persist.
- Confirm related usage appears in `/cmspanel/pages/tags`.

### Blogs

- Open a blog editor in `/cmspanel/blogs`.
- Add both an existing tag and a new tag.
- Save and reopen the blog.
- Confirm tag assignments persist.
- Confirm related usage appears in `/cmspanel/blogs/tags`.

## Tenant and Permission Safety

- With a tenant selected, confirm tags are scoped to the current tenant.
- As a platform admin with a tenant selected, confirm the manager remains tenant-scoped rather than showing cross-tenant data.
- In global/no-tenant mode, confirm tenant labeling behaves as expected.
- With a read-only role, confirm create/edit/delete actions are hidden or blocked.
- With create/update/delete permissions, confirm the expected actions are available.

## Regression Checks

- Confirm `npm run build` passes after any follow-up Tags changes.
- Confirm no legacy root-path auth assumptions were reintroduced; admin navigation should still use `/cmspanel`.
- Confirm blog/page tag tabs use the richer Tags manager instead of the old generic tag CRUD surface.

## Completion Criteria

The Tags overhaul is considered validated when:

- Refresh-safe routing works for standalone and nested tags routes.
- Standalone and embedded managers render cleanly across desktop and mobile widths.
- Search, filters, create/edit/delete/restore, and pagination all behave correctly.
- Page and blog tag synchronization persists correctly after save.
- Tenant scoping and permission boundaries behave as expected.
