---
"awcms": patch
---

Keep `graphify-out/.graphify_labels.json{,.sig}` untracked. The
`pengetahuan-ringkas` block in `.gitignore` re-included them, which
`graph:artifacts:check` and `docs/awcms/knowledge-graph.md` both forbid. The
skill's artefact table now matches that document, including `manifest.json`
and `cost.json`, which are tracked. Tooling and docs only; no runtime change.
