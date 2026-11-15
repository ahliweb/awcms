---
"awcms": patch
---

docs(loadtest): record a local dry run of the existing k6 harness (Issue #1283, refs only). All four scenarios ran against the ephemeral environment on a shared workstation and every run was rejected by the saturation check, so no baseline is accepted and nothing is compared with ADR-0161; the report says so and notes the `interactive` database work-class queue filling at 150 rps with the edge cache off. No code, API, migration or dependency change.
