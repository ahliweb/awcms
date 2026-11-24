---
"awcms": minor
---

ci(api): the contract fixtures pack is now a pinned, hash-verifiable artefact for consumers (Issue #1394, ADR-0167). The pack format is `packVersion` 2: the manifest carries `contractVersion`, `contractSha256` (the bundle) and the new `contentSha256` (the pack itself). `api:fixtures:check` also verifies the manifest and scans the pack for secrets, personal data and repository names outside the family. Channel (K19.15): consumers pin the file at a commit SHA and verify both hashes; no new infrastructure. Consumer guide in docs/awcms (en + id).
