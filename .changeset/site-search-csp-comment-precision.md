---
"awcms": patch
---

docs(site-search): correct the CSP rationale on the `/search` page renderer

PR #229 landed between the site_search port and this change: `script-src` is now
always emitted, carrying `'self'` plus the SHA-256 of the admin theme-init
script. The renderer's comment still described the policy as `default-src 'self'`
and implied inline scripts are categorically impossible.

The no-`'unsafe-inline'` guarantee is unchanged, and the page's behaviour is
unchanged — but a reader would now find a sanctioned hashed-inline script in the
tree and conclude the comment was simply out of date. It names that pattern
explicitly and states the reason it does not apply here: this route is a plain
APIRoute with no build step to compute or keep such a hash in sync.
