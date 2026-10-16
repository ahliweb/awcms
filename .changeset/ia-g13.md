---
"awcms": patch
---

fix(identity-access): run the high-risk segregation-of-duties check in `authorizeInTransaction` before the access-decision log write and fold a block into the logged decision (as the MFA-enrolment refusal already is), so a request refused with 403 `SOD_CONFLICT` is recorded as a deny with the SoD reason (`matched_policy` `sod_conflict`) instead of a contradicting `allowed=true` row. The response contract is unchanged.
