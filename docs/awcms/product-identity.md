🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](product-identity.id.md)

# Deployment Product Identity

Issue #1352. One deployment-level identity decides what this deployment calls
itself in the admin shell, the auth pages, the installable-app manifest and the
front door, so a product derived from this template does not patch
`AdminLayout.astro`, `AuthBrandPanel.astro` or the auth pages. It is opt-in:
with nothing set the output is exactly what it was before.

The resolver is `src/lib/product-identity.ts` (a shared `src/lib/` file, so
pages owned by `identity_access` can use it without importing a domain module).
Configuration is environment variables, the same mechanism as the existing
`PWA_*` branding (Issue #1105). It is deployment config: never the request
`Host`, never a tenant row. Per-tenant branding is out of scope.

| Variable                                                                                            | Default                      | Effect                                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `PRODUCT_NAME`                                                                                      | `AWCMS`                      | Page titles, the brand name in the auth panel copy, the manifest name (`<name> Admin`) |
| `PRODUCT_WORDMARK`                                                                                  | the product name             | Text mark in the shell, auth pages and landing page; its first letter fills the tile   |
| `PRODUCT_VERSION`                                                                                   | package version              | Shell footer only                                                                      |
| `PRODUCT_FRONT_DOOR_PATH`                                                                           | unset (landing page renders) | `/` answers a 302 to this same-origin path                                             |
| `PWA_ICON_192_PATH`, `PWA_ICON_512_PATH`, `PWA_ICON_MASKABLE_512_PATH`, `PWA_APPLE_TOUCH_ICON_PATH` | built-in icons               | Installable-app icons                                                                  |

`PWA_APP_NAME` and `PWA_APP_SHORT_NAME` still win over the manifest name derived
from `PRODUCT_NAME`.

## Validation

An invalid value is ignored (the default is used) instead of failing the page.

- Names: control and format characters removed, length capped (name 60,
  wordmark 30), and rejected when they contain `<`, `>`, `&`, quotes or
  backticks, so a value never becomes markup.
- `PRODUCT_VERSION`: letters, digits and `. + _ -`, at most 32 characters.
- Paths (front door, icons): a same-origin absolute path made of letters,
  digits and `. _ ~ - /`. No scheme, no `//`, no backslash, no `..`, no query or
  fragment. The front door never points at `/` (it would loop). Because icon
  paths stay same-origin, the CSP is not loosened.

## What stays the same

- The compatibility version. `PRODUCT_VERSION` is display only; the module
  matrix and tenant module lifecycle keep reading the platform version.
- Translations. The identity supplies brand tokens only. The sentences around
  them stay in the gettext catalogue; in the auth panel the platform name inside
  the translated sentence is replaced by `PRODUCT_NAME`.
- The front door is a 302, never a 301, so changing or removing it reaches
  browsers that would cache a permanent redirect.

## Tests

`tests/product-identity.test.ts` pins the defaults (no configuration gives the
previous strings and manifest), the validation, and a gate that fails when an
auth page hard-codes the platform name instead of using the resolver.
