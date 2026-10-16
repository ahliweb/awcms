---
"awcms": patch
---

fix(identity-access): the entitlement backfill no longer leaves an expired tenant entitlement row expired while reporting it as granted. The plan treats expired rows as not held, but the grant used `ON CONFLICT DO NOTHING`, so the row stayed inert and `granted` was still incremented. The grant now renews only expired rows on conflict (`DO UPDATE ... WHERE expires_at <= now`, clearing `expires_at`), leaves live rows untouched, and counts only rows actually written (`RETURNING`).
