---
"awcms": patch
---

fix(deps): mitigate picomatch GHSA-fc5q-39xc-vjpf (ReDoS through repeated extglobs, high) with a local patch, because no patched picomatch release exists yet. `patches/picomatch@4.0.7.patch` and `patches/picomatch@2.3.2.patch` (`patchedDependencies`) force `opts.noextglob = true`, so extglob syntax (`+(a)`, `*(a)`, `@(a)`, `?(a)`, `!(a)`) is matched literally and the vulnerable parser path is unreachable; the advisory's proof-of-concept patterns now finish in milliseconds. No pattern used by this repo or its build tooling relies on extglobs. `bun audit` matches by version and still lists 4.0.7, so `deps:audit:check` carries one time-boxed exception (review 2026-12-18) that names the patch; remove both once upstream publishes a fix.
