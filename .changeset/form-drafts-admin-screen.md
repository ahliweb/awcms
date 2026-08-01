---
"awcms": minor
---

feat(form-drafts): add the `/admin/form-drafts` ops screen and its sidebar entry

`form_drafts` shipped a complete admin API but no screen and no `navigation`
entry, so the module was invisible in the admin sidebar and the only way to see
or clear a tenant's accumulated drafts was the JSON API or the daily
`form-drafts:purge` job.

Adds `/admin/form-drafts`: a filter bar (module key / wizard key / status)
driving the same filters `GET /api/v1/form-drafts` accepts, the bounded
newest-first list, a collapsed read-only payload inspector, and a per-row
delete that calls `DELETE /api/v1/form-drafts/{id}`. Registered in the sidebar
under System, gated on `form_drafts.draft.read`.

Deliberately not included: a create form, a step editor, and a submit button.
Drafts are produced by other modules' wizards, and submitting is a domain
transition that wizard owns — a janitor screen that flipped a draft to
`submitted` would report work as finished while nothing downstream ran.

No schema, endpoint, or permission change.
