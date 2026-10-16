---
"awcms": patch
---

fix(identity-access): ABAC `in`/`nin` on date attributes now compare by epoch like `eq`/`ne` (so `...00.000Z` matches `...00Z`), and ABAC date literals with a time part must carry an offset (`Z` or `±hh:mm`) so decisions no longer depend on the server's local time zone; impossible calendar dates such as `2024-02-31` are rejected.

**Upgrade note:** a stored DSL policy whose condition holds a date-time without an offset (for example `2024-01-01T10:00`) no longer parses. The policy cache compiles it as invalid, which fails closed: the policy denies across its whole applicability scope until it is edited to carry an offset. Before upgrading, list such policies with `SELECT id, tenant_id, policy_code FROM awcms_abac_policies WHERE is_dsl_managed AND conditions::text ~ '"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?"'` and add an offset to each.
