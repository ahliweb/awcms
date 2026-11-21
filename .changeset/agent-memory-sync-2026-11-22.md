---
"awcms": patch
---

docs(memory): resync `docs/awcms/agent-memory.md` with the active agent memory (it had drifted since 11 November, so `memory:docs:check` failed locally on every device that has the memory directory), and exclude one memory about an operational bot outside this repo from the public snapshot because it names internal hosts and repositories. Docs and tooling only; no runtime change.
