---
"awcms": patch
---

security(social_publishing, channel_accounts): fix the #1145 credential-path security review (HIGH, MEDIUM-1, MEDIUM-2, MEDIUM-4, L1, L2, L3, L5; MEDIUM-3 stays with design issue #1473, and every connector flag stays off).

- `sql/426` (HIGH): `awcms_social_dispatch` loses its column `UPDATE` on `awcms_channel_accounts` (with which it could set `version = 2147483647` and make an account impossible to disconnect or revoke) and every write on `awcms_channel_account_health`. The "credential rejected" report is now the fixed-body SECURITY DEFINER `awcms_social_report_credential_rejected` (owner `awcms_social_credential_report`, NOLOGIN, memberless; EXECUTE for the dispatcher only), which writes only constants for a live Facebook Page of the transaction tenant.
- `sql/427` (MEDIUM-1, L3, L1): the role sees only the token of an `active` grant used by a `connected` Facebook Page; `last_error`, `error_message` and the dispatcher's audit rows accept only the closed vocabulary of `social-dispatch-vocabulary.ts`.
- MEDIUM-2: a dedicated-role job refuses to start when its role is a member of any role, and `security:readiness` checks that and the role's members for `awcms_social_dispatch` and `awcms_telegram_engagement_dispatch` (new optional `SECURITY_READINESS_DEDICATED_ROLE_MEMBERS`).
- MEDIUM-4: disconnecting or deleting the last live account on an OAuth connection revokes the connection and deletes its token ciphertexts; the disconnect response gains `connectionRevoked`, and the audit messages no longer claim an erasure that did not happen.
- L2: the dedupe-flag guard is pinned exactly. L5: stale "no job holds the key ring / NOLOGIN only" documentation corrected.
