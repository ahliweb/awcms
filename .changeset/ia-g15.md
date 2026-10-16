---
"awcms": patch
---

fix(identity-access): the `/admin/registrations` sidebar entry no longer shares navigation order 23 with `/admin/access-policies`; it now uses order 44, which no other module uses, so the sidebar sequence is deterministic.
