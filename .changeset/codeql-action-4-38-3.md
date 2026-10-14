---
"awcms": patch
---

chore(actions): bump github/codeql-action init and analyze from 4.38.2 to 4.38.3 together (#994, #996). CodeQL requires both steps of `.github/workflows/codeql.yml` on the same version, so the two Dependabot bumps land as one change; each one alone failed the Analyze jobs.
