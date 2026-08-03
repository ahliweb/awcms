---
"awcms": patch
---

Bump `docker/login-action` from 4.5.1 to 4.6.0 in the release workflow (both
call sites).

Release-workflow only — it authenticates the GHCR push during
sign/attest/publish and has no effect on any PR build.
