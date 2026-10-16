---
"awcms": patch
---

fix(identity-access): the subscription ladder job now checks the row count of its compare-and-swap UPDATE (`RETURNING id`); when the subscription's status changed between planning and applying (zero rows updated) it no longer writes a `identity_access.subscription.transitioned` audit event or counts the transition / entitlement loss in the run result.
