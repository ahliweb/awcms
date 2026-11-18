---
"awcms": patch
---

fix(deps): remove the picomatch GHSA-fc5q-39xc-vjpf mitigation (Issue #1373). GitHub and OSV withdrew the advisory on 2026-11-18 (maintainers: not a library vulnerability; patterns are caller-supplied; the fix PR was closed unmerged), so `deps:audit:check` reported the exception as stale and failed every PR. Removed the exception, `patches/picomatch@4.0.7.patch`, `patches/picomatch@2.3.2.patch`, the `patchedDependencies` field, and the guard test; the exception list is empty again. Resolved picomatch versions are unchanged. NVD still lists CVE-2026-112366 as "Awaiting Analysis", so scanners keyed on NVD may flag it; exposure is low because every picomatch pattern here comes from repo or dependency configuration.
