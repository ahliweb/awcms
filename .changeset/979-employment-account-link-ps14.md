---
"awcms": patch
---

fix(hr_workforce): the employment account link refuses a self-link to another person's employment (`403 SELF_LINK_FORBIDDEN`), requires the linked login's profile to match the employment's (`422 PROFILE_MISMATCH`), and treats a re-link as `critical` with before/after login ids and, when attendance history exists, the conditional step-up of ADR-0141 section 4 (`403 STEP_UP_REQUIRED`) (#979, finding PS-14). No schema change.

Follow-up hardening (audit): the refusals leave an `account_link_refused` audit row; a repeat link re-validates the login (and requires an active identity); an employment that was ever linked stays a critical re-link; `sql/228` adds the `awcms_hr_employments_link_guard` trigger and `last_tenant_user_id`; and a `security:readiness` warning lists links made before the fix.
