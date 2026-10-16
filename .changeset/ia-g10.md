---
"awcms": patch
---

fix(identity-access): re-check `status = 'active'` under the MFA verify row lock (and in the TOTP replay-guard CAS and recovery-code consume) so a factor disabled between the unlocked read and `lockFactorForVerify` can no longer verify a valid TOTP or recovery code from the stale snapshot; such a factor is treated as a non-match without counting a lockout failure.
