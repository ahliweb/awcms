---
"awcms": patch
---

Add a create-profile form to the admin profiles screen (Issue #166), permission-gated on profile_identity.profile_management.create, posting to POST /api/v1/profiles via cookie auth; CSP-safe external script. Authed E2E covers create → row appears.
