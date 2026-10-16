---
"awcms": patch
---

fix(identity-access): audit role revocation from a user group (`unassignRoleFromGroup`) and member removal from a user group (`removeUserGroupMember`) with action `revoke` instead of `assign`, and make `addUserGroupMember`'s already-a-member fallback check join `awcms_user_groups` with `deleted_at IS NULL`, so adding to a soft-deleted group with a stale membership row throws `GroupMembershipTargetNotFoundError` (404) instead of returning `{ added: false }`. Response shapes and error codes are unchanged.
