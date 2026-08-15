---
"awcms": patch
---

fix(admin-ui): /admin/account stopped offering MFA and SSO that the deployment has turned off

The account screen branched only on the caller's own state — do they have a
factor, do they have a linked provider — and never on the DEPLOYMENT switch.
With `AUTH_MFA_ENABLED` unset, which is how production runs today, it rendered a
**"Set up two-factor authentication"** button whose endpoint answers 400. The
same for SSO's **"Connect"** under `AUTH_SSO_ENABLED`.

A control that exists, invites a click and cannot work is worse than an absent
one: the person tries it, gets an error with no explanation, and tries again.
It is exactly the fake affordance the `LanguageSwitcher` comment condemns, one
screen over.

The gating is deliberately narrow, and the narrowness is the design:
`isMfaFeatureEnabled` governs **enrolment only**. Disable, recovery codes and
step-up are driven by database state precisely so an operator can turn the flag
off without stranding people who already enrolled. Gating the whole section would
take away the exit. Same for SSO — `Connect` is gated, `Disconnect` is not.

Both branches now say what is true ("not available on this deployment, ask an
administrator") rather than showing nothing, because an empty space reads as a
missing feature and a stated one reads as a decision.
