---
"awcms": patch
---

fix(openapi): the soft-delete operations `blogDeletePost`, `blogDeletePage` and `blogDeleteTerm` declared the deleted row (`BlogPost`/`BlogPage`/`BlogTerm`) as their 200 body, but the handlers answer `{ success, data: { id, deleted: true } }` (Issue #1443). They now reference a new `BlogDeleteReceipt` schema (`id` uuid, `deleted` constant `true`, both required, no extra fields) and carry an example validated by `api:contract:lint`. A new test pins handler and contract to each other and turns red when the example is corrupted. None of the three paths is in the awcms-astro consumer contract, so that fixture is unchanged. No runtime change.
