---
"awcms": patch
---

fix(tooling): `docs:i18n:stamp` now reads paths correctly when this tree is embedded as a subdirectory of another git repository (Issue #1304). `git status --porcelain` is relative to the repository top while the rest of the tool is relative to the working directory, so an edited mirror was not recognised as touched; the tool now reconciles the prefix (`git rev-parse --show-prefix`) and reads `HEAD:./<path>`. No behaviour change at the repository top. Tooling only: no schema, API or event change.
