---
"awcms": minor
---

Per-tenant admin sidebar arrangement: reorder, hide, relabel, move between
sections, and custom sections.

The sidebar has been rendered from the module registry since #259. This adds the
override layer on top of it (`sql/071`, `sql/072`), plus
`/api/v1/tenant/navigation/sidebar` and an `/admin/sidebar-menu` editor.

Stored as a DELTA, never a snapshot: a tenant with no rows renders exactly the
code default, so a newly added module's nav entry appears everywhere without a
data migration. A snapshot would freeze each tenant's sidebar at the moment they
first touched it.

A tenant can override, never inject. Every stored row is resolved by key against
the code-derived model and one that matches nothing is ignored, so there is no
path from a request body to a new menu link. Overrides are applied BEFORE
permission and tenant-disable filtering, so relabelling or moving an entry
cannot carry it past `requiredPermission`.

`module_management.navigation.configure` gates the mutations. Existing tenants
do not gain it automatically — `sql/072` carries the operator backfill note.
