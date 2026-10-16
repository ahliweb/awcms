---
"awcms": patch
---

security(workflow_approval): decision inserts and instance verdicts are made consistent with the engine's records in the database (#1032, `sql/301`, ADR-0144 amended). A decision must come from a user holding a pending assignment (or an active delegation) on a pending task of a pending instance, once per seat; a task completes only on a met quorum and is cancelled only once its instance is no longer pending; an instance reaches `approved`/`rejected` only when a simulation of its frozen graph (conditions evaluated against its frozen facts) reaches that outcome through completed approvals; a published definition's graph is immutable; every guard pins `search_path`. `DELETE`/`TRUNCATE` on workflow tasks, assignments and join arrivals are revoked from `awcms_app`. The graph engine now cancels the pending sibling tasks of an instance a rejection finishes. These bind rows to each other, not to a person: `decided_by` is not proof of identity.

Also: an override must come from an active, non-requester user of the tenant; seats cannot be retired without a replacement or decision; shared approval nodes on parallel branches resolve per branch; `awcms_app` can only create draft definitions and start instances on the active version; a trigger backstops the `DELETE`/`TRUNCATE` revoke. The permission to force a decision is still enforced by the route only.
