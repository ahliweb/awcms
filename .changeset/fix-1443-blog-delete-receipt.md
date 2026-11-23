---
"awcms": patch
---

fix(openapi): the soft-delete operations `blogDeletePost`, `blogDeletePage` and `blogDeleteTerm` declared the deleted row (`BlogPost`/`BlogPage`/`BlogTerm`) as their 200 body, but the handlers answer `{ success, data: { id, deleted: true } }` (Issue #1443). They now reference a new `BlogDeleteReceipt` schema (`id` uuid, `deleted` constant `true`, both required, no extra fields) and carry an example validated by `api:contract:lint`. A new test pins handler and contract to each other and turns red when the example is corrupted. None of the three paths is in the awcms-astro consumer contract, so that fixture is unchanged. No runtime change.

The same receipt now types the five other blog soft-deletes whose handlers answer it (`blogDeleteInstitution`, `blogDeleteWidget`, `blogDeleteMenu`, `blogDeleteTemplate`, `blogDeleteAd`): eight operations in all, each with a `softDeleted` example, all pinned by the test. Their paths are not in the consumer contract either.
