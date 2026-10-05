---
"awcms": patch
---

chore(actions): bump anchore/sbom-action from 0.24.2 to 0.24.3 (#909)

Both SBOM steps in `.github/workflows/release.yml` (source tree and built image) move to
the same pinned SHA `66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c` together. The workflow
only runs on a `v*.*.*` tag, so PR CI cannot exercise this step; the next release run is
its first real execution.
