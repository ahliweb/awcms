---
"awcms": patch
---

`release:verify` now refuses to run outside the tagged commit: it reads `package.json`, `CHANGELOG.md` and `.changeset/` from the working tree, so a stale checkout produced a confident but wrong version mismatch. The release procedure (docs and the `awcms-release` skill, EN/ID) now verifies from the tag checkout and pushes the tag only with `&&`.
