---
"awcms": minor
---

feat(site-profile): a tenant can state who it is, without editing frontend source

A tenant had no logo, favicon, editorial address, contact email, phone, WhatsApp
number, copyright line, tagline or social profile link — anywhere. A footer, a
masthead, a contact page and the `Organization` JSON-LD node all had to
hard-code the publisher's identity in frontend source, which violates PRD §25
("tanpa edit source code") and FR-TEN-004, and makes a second tenant impossible
without a fork.

`site_profile` is a new module (ADR-0102, `sql/135`) owning that identity.

### The reuse gate ran before anything was built

`theming` was rejected outright: its value **is** the strictness of its charter —
token values are validated against a strict CSS grammar — and an editorial
address is not a design token. `blog_content.settings` was rejected because
identity is not content.

`awcms_seo_tenant_settings` was the real candidate, and the one the issue itself
preferred. It was rejected on **charter**: every identity-looking field there is
an SEO *output* (`og:site_name`, the JSON-LD `Organization` node, the fallback
`og:image`), consumed by a meta-tag renderer and set by whoever owns index
impact. PRD §25 asks for site *chrome*, set by whoever runs the newsroom — and
ADR-0053 already established that separating those authorities matters.

### The cost of a second module is paid on the read side

The real objection to a new module was never storage; it was *"consumers must
know which to ask"*. So `GET /api/v1/site-profile/composed` returns both halves
in one answer, with the four SEO-owned fields named exactly as
`seo_distribution` names them. A build client asks one endpoint and never learns
the split exists. Nothing is duplicated between the two tables, so no value can
drift out of step with a copy.

### Security surface

Social link URLs are **refused, not sanitized**, unless absolute `http(s)`. They
render as `<a href>` on every public page, so a `javascript:`/`data:` value is
stored XSS with a very long reach — the posture `content-validation.ts` takes
toward markup. Protocol-relative and scheme-less values are refused for the same
reason: both parse as *something* and neither states an origin.

Logo and favicon are media object **ids**, never URLs, so managed-media
enforcement keeps governing the bytes.

`read` and `update` are separately grantable (`sql/058`'s reasoning: changing
what every page's contact block says is a different power from reading it), and
the `PUT` is idempotency-keyed and audited — the audit row records **which
fields are set, never their values**, because contact data should not be copied
into a second store that more people read.

### Also

`submitWithFieldErrors` gained an `idempotent` option. Before it, an endpoint
could require an idempotency key **or** return per-field errors and a caller had
to choose — which is why `/admin/seo` reports "invalid" without saying which
field.

**Existing tenants will 403 until granted the new permissions**: a seed reaches
only tenants created after it, the limitation every permission-seed migration in
this repo carries.
