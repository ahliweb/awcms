---
"awcms": minor
---

`POST /api/v1/comments/admin/{id}/delete` — the moderator half of a transition
this module has implemented since ADR-0041 (ADR-0058 §B).

`applyModerationAction` has accepted `"delete"` all along, it is legal from all
four non-terminal statuses, and the moderation queue can already filter on
`deleted` — so moderators could see soft-deleted comments without being able to
delete one. The only actor who could reach that state was the comment's own
author, inside the edit window.

This is the one irreversible moderator action, and it stays that way: `deleted`
remains terminal and recovering a deleted comment remains an operator/database
action. It is accepted because the state was already reachable, the row, body
and append-only moderation history all survive, and every other moderator
action is reversible and keeps the body in the queue — leaving no in-band
answer for content that must be pulled permanently. Bulk moderation
deliberately does not gain it.

`delete` now also resolves the comment's open reports, alongside
`approve`/`reject`/`spam`: a deleted comment cannot be acted on again, so
leaving them open would inflate the queue's report count forever. No existing
caller is affected — nothing could reach that branch with `delete` before.

Permission-enforcement coverage moves from 202/205 with 3 exceptions to 203/205
with 2, and the two that remain are exactly the revocations ADR-0058 §C/§D
decided.
