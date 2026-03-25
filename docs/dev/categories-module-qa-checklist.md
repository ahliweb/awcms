> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md)

# Categories Module QA Checklist

## Purpose

Provide a concise manual verification checklist for the AWCMS Admin Categories overhaul under `/cmspanel`, including the standalone Categories manager and the embedded categories experiences in Blogs and Pages.

## Scope

- Standalone Categories manager: `/cmspanel/categories`
- Standalone trash view: `/cmspanel/categories/trash`
- Embedded blog categories: `/cmspanel/blogs/categories`
- Embedded page categories: `/cmspanel/pages/categories`
- Nested trash views for embedded category tabs

## Preconditions

Before running this checklist:

| Item | Requirement |
| --- | --- |
| Auth | Signed in to the Admin Panel |
| Base URL | Admin routes resolve under `/cmspanel` |
| Tenant context | A tenant is selected when testing tenant-scoped behavior |
| Data | At least a few categories, one blog, and one page exist |
| Permissions | Test with both full-access and restricted roles when possible |

## Routing and Refresh Safety

### Standalone Categories

- Open `/cmspanel/categories` and confirm the manager loads without errors.
- Refresh `/cmspanel/categories` and confirm the active view remains stable.
- Open `/cmspanel/categories/trash` and confirm the trash view loads correctly.
- Refresh `/cmspanel/categories/trash` and confirm the trash view persists.
- Open an invalid path such as `/cmspanel/categories/invalid` and confirm it redirects back to `/cmspanel/categories`.

### Embedded Blog/Page Categories

- Open `/cmspanel/blogs/categories` and confirm the categories tab survives refresh.
- Open `/cmspanel/blogs/categories/trash` and confirm nested trash survives refresh.
- Open `/cmspanel/pages/categories` and confirm the categories tab survives refresh.
- Open `/cmspanel/pages/categories/trash` and confirm nested trash survives refresh.

## UI and Layout Checks

- Confirm the standalone Categories screen renders the upgraded hero/header surface correctly.
- Confirm the category summary cards render with consistent spacing, emphasis, and responsive behavior.
- Confirm the embedded blog/page category views render the dedicated category header instead of a plain generic manager shell.
- Confirm the search/filter bar is visually separated from the cards and table.
- Confirm the trash view remains visually clear and easy to navigate back from.

## Search and Filtering

- Type fewer than 5 characters and confirm validation messaging behaves correctly.
- Type a valid search query and confirm category results filter as expected.
- Clear the search and confirm the full list returns.
- Confirm standalone Categories shows the full category-scope set.
- Confirm embedded blog categories limit visible categories to valid blog/shared scopes.
- Confirm embedded page categories limit visible categories to valid page/shared scopes.

## Category CRUD

### Create

- Create a new category from `/cmspanel/categories`.
- Confirm the category form offers only valid scope choices.
- Save and confirm the category appears in the active list.
- Confirm creating a category with the same slug in a different tenant is not blocked incorrectly.

### Edit

- Edit an existing category.
- Save changes and confirm the updated data appears in the table.
- Confirm the scope badge and description update correctly in the list.

### Delete and Restore

- Soft-delete a category from the active list.
- Confirm it disappears from active results and appears in trash.
- Restore the same category from trash.
- Confirm it returns to the active list.

## Cross-Module Integration

### Pages

- Open a page editor in `/cmspanel/pages`.
- Confirm the category selector shows only valid page/shared categories.
- Save a page with a selected category and reopen it.
- Confirm the category assignment persists.

### Blogs

- Open a blog editor in `/cmspanel/blogs`.
- Confirm the category selector shows only valid blog/shared categories.
- Save a blog with a selected category and reopen it.
- Confirm the category assignment persists.

## Tenant and Permission Safety

- With a tenant selected, confirm categories are scoped to the current tenant.
- As a platform admin with a tenant selected, confirm the manager remains tenant-scoped rather than showing cross-tenant data.
- In global/no-tenant mode, confirm tenant labeling behaves as expected.
- With a read-only role, confirm create/edit/delete actions are hidden or blocked.
- With create/update/delete permissions, confirm the expected actions are available.

## Regression Checks

- Confirm `npm run build` passes after any follow-up Categories changes.
- Confirm no legacy root-path auth assumptions were reintroduced; admin navigation should still use `/cmspanel`.
- Confirm blog/page category tabs now use the dedicated Categories manager instead of drifting ad hoc configs.

## Completion Criteria

The Categories overhaul is considered validated when:

- Refresh-safe routing works for standalone and nested category routes.
- Standalone and embedded managers render cleanly across desktop and mobile widths.
- Search, create/edit/delete/restore, and pagination all behave correctly.
- Blog and page category selection persists correctly after save.
- Tenant scoping, slug validation, and permission boundaries behave as expected.
