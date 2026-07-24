---
"awcms": patch
---

feat(tooling): port `memory:docs:sync` from awcms-mini — snapshot the
out-of-repo Claude Code agent memory into a committed `docs/awcms/agent-memory.md`
so it survives clones/device moves (`sync`/`restore`/`check`). Adapts the doc
path, header, password-placeholder redaction, and excludes the device-specific
local-Postgres memory. check:docs exempts the generated mirror; prettier ignores
it. Dev-tooling only — no runtime behavior change.
