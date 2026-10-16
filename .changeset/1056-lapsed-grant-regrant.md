---
"awcms": patch
---

fix(identity-access): a role grant whose `effective_to` has passed no longer blocks granting the same role again (#1056). The grant writer now marks the subject's elapsed grants of that role `expired` (kept as history, with an `expired` lifecycle event and an `expire` audit row) before inserting, instead of letting the `status = 'active'` partial unique index turn the re-grant into a `409`. Future-dated and still-effective grants keep their `409`.
