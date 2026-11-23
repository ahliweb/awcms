---
"awcms": minor
---

feat(branding): deployment-level product identity (Issue #1352). `src/lib/product-identity.ts` resolves `PRODUCT_NAME`, `PRODUCT_WORDMARK`, `PRODUCT_VERSION`, `PRODUCT_FRONT_DOOR_PATH` and four `PWA_*_PATH` icon overrides, and the admin shell, the five auth pages, `AuthBrandPanel`, the PWA manifest and `/` read it, so a derived product no longer patches them. Opt-in: with nothing set the output is unchanged. Values are validated (plain text only, same-origin paths, invalid falls back to the default), the front door answers 302 never 301, the CSP is not loosened, and the module-compatibility version is not affected. See `docs/awcms/product-identity.md`.
