---
"awcms": patch
---

fix(identity-access): a session handoff no longer refreshes step-up freshness (`sql/446`). A handoff code now records the issuing session's `stepped_up_at` with its assurance level and method, and redemption mints the new session with that original instant (clamped to the redemption instant) instead of `now`. A step-up that was stale before the hop stays stale after it, and `requireStepUp` asks for a new one. `SessionAssuranceGrant`'s `aal2` arm now requires `steppedUpAt`: the login challenge, enrolment completion and `POST /auth/mfa/step-up` pass the instant of the factor they just verified, and a carried assurance passes the original. Two CHECKs back this: an `aal2` code must have an instant, and that instant cannot be later than the code's mint. Live `aal2` codes at deploy time take the issuing session's instant; any that cannot be matched are downgraded to `aal1` rather than given an invented one.
