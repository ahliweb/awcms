---
"awcms": patch
---

fix(seo): one source for the site origin — the feed stopped emitting `http://` links on an `https://` site

Verified in production before and after, not inferred:

    curl https://awcms.ahlikoding.com/blog/ahliweb/feed.xml
    → <link>http://awcms.ahlikoding.com/…</link>   for every entry

The Node adapter derives `url.origin` from its own listener. Traefik terminates
TLS and the app listens on plain HTTP, so `url.origin` was `http://…` on a site
every visitor reaches over `https://…`, and **nothing in this repo read
`X-Forwarded-Proto`** — confirmed by grep across the whole tree; the only matches
were prose describing the problem.

**Why it went unnoticed for so long is the interesting part.** The one place a
person is likely to check — the canonical `<link href>` — read correctly, because
Cloudflare's Automatic HTTPS Rewrites patches `href`/`src` attributes in flight.
The `og:url` beside it, built from the *same variable*, arrived wrong, because it
uses a `content` attribute. That asymmetry was previously recorded here as
evidence of "two independent URL builders"; it is not. It is one builder, wrong
everywhere, concealed on exactly the tag you would inspect.

A full inventory found **three** origin sources, not two:

- **A** `url.origin` — the six `src/pages/blog/[tenantCode]/**` routes (canonical,
  `og:url`, JSON-LD `@id`, share links, feed, sitemap). Wrong scheme, and the
  *request* host rather than the tenant's.
- **B** literal `` `https://${primaryHost}` `` — all of `seo_distribution`. Right
  for this deployment, wrong for the offline-LAN profile, which would publish
  sitemaps and feeds pointing at a scheme it does not answer on.
- **C** `APP_URL` — OIDC `redirect_uri`, password-reset, invitation and
  registration-approval links: the surfaces where being wrong is most expensive,
  because they are emailed and clicked later.

All three now go through `src/lib/http/site-origin.ts`. The scheme comes from
`X-Forwarded-Proto` when `PUBLIC_TRUST_PROXY=true`, otherwise from `APP_URL`,
otherwise from the request. **The `APP_URL` branch is the load-bearing one**:
production sets `APP_URL=https://awcms.ahlikoding.com` and does NOT set
`PUBLIC_TRUST_PROXY` (read off the running container), so a fix that only worked
with proxy trust enabled would have shipped and changed nothing. The host is
deliberately NOT taken from `APP_URL` — multi-host deployments must keep naming
the host the visitor actually used.

No fourth proxy-trust flag: this reuses `PUBLIC_TRUST_PROXY` and the same
multi-value refusal `extractHostHeader` already applies, because picking one
value out of a comma-separated chain is choosing which hop to believe.

`site-origin:check` keeps it single. It flags two shapes — `${url.origin}`
interpolated into output, and a hardcoded scheme whose host is *entirely*
interpolated — and deliberately does not flag `new URL(x).origin` used for
comparison, nor vendor endpoints like
`` `https://${accountId}.r2.cloudflarestorage.com` `` where the interpolation is a
subdomain label inside a fixed domain and `https` is correct forever. Proven by
reintroducing the real defect: the gate names the file and line, and passes again
when reverted.
