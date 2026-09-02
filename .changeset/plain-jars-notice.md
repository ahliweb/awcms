---
"awcms": patch
---

fix(docs,idn-regions): six passages still described region-dataset activation/rollback as removed from HTTP with revoked permissions (ADR-0052), a state ADR-0053 reversed the next day by restoring both as PLATFORM-scoped permissions (sql/085) with live endpoints. Corrects `idn-admin-regions/module.ts`'s own description/comments/job metadata (including the `jobs[].environmentNotes` mis-attribution to a reversed ADR-0052 holding), `docs/ARCHITECTURE.md` + its Indonesian mirror, `docs/PROJECT_STATE.md` + its mirror, and the module's own README + its mirror — states, once, plainly, that the HTTP path writes an audit row and the job path deliberately does not. No behavior change; no schema, API, or permission change.
