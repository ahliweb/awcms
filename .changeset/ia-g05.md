---
"awcms": patch
---

fix(identity-access): a session handoff code can no longer be redeemed after the session that issued it ended. `redeemHandoffCode` now claims the code only while the issuing session (`issued_by_session_id`) is unrevoked, unexpired and credential-current (`sessionCredentialCurrent`), so a code minted before logout or a password reset no longer mints a fresh session within its 60-second life; a refused redeem returns the existing invalid outcome. `session-handoff-directory.ts` is now a recorded live-session reader in `scripts/session-readers-check.ts`.
