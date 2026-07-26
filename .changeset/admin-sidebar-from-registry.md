---
"awcms": minor
---

Render the admin sidebar from the module registry instead of a hand-written array.

`ModuleDescriptor.navigation` was already synced to `awcms_module_navigation`
and served by `GET /api/v1/modules`, while `AdminLayout.astro` rendered a
separate static list. Nothing compared them and both had rotted: three declared
entries pointed at admin pages that do not exist (`/admin/blog`, two
`/admin/news-portal/*`) and were being published as valid menu items, while
eight pages that do exist were unknown to the registry.

The sidebar now composes from `listModules()` through the new
`module-management/domain/sidebar-menu.ts` (ported from awcms-micro, without
its per-tenant override tables). Tenant-disabled modules and the caller's
permissions both filter it, so an operator no longer sees links to screens that
will only deny them. `tests/admin-navigation-registry.test.ts` binds
declarations to the filesystem in both directions.

`AdminLayout`'s `active` prop is gone — the current entry derives from the
request path, which cannot disagree with itself the way `/admin/comments` did
(it never passed one and was never highlighted).
