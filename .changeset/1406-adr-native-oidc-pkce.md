---
"awcms": patch
---

docs(adr): ADR-0171 (Accepted, owner decisions K17) designs native-client authentication: authorization code + PKCE (S256) over HTTPS app links, opaque access tokens stored as session rows, rotating refresh tokens with family reuse detection, and DPoP-bound device sessions with a non-exportable per-install key (Issue #1406). The independent security review of 2026-11-23 (4 High, 8 Medium, 10 Low) is folded in as normative text with a required red test per control. Document only: no code, migration or OpenAPI change; implementation stays behind `AUTH_NATIVE_ENABLED=false` and waits for ADR-0168 S1.
