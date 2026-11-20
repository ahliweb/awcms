---
"awcms": patch
---

fix(tooling): `docs:i18n:stamp` removes EVERY `i18n-source-hash` marker line whatever its value (a hand-written `sha256:placeholder` used to survive and become a double marker), and `check:docs:translation` now fails on a mirror with more than one marker or a marker that is not `sha256:<64 hex>`, naming the file and pointing to `bun run docs:i18n:stamp`. Unit tests cover the placeholder strip, the double marker and the invalid marker. The stricter check found 28 Indonesian mirrors (ADRs, module docs, runbooks) carrying a second, invalid marker (`sha256:pending`, `sha256:0`, `sha256:0000`) beside their valid one; the stamp removed it from each. Tooling and docs only; no runtime change.
