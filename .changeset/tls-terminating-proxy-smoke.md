---
"awcms": patch
---

test(http): a smoke test that speaks HTTPS — the topology that hid two production defects

PROJECT_STATE §4 recommendation 8, the last open engineering item from the
15 August round.

Two defects shipped in one week and neither was visible from this repo:

- **v9.1.1** — every native `<form method="post">` answered `403 Cross-site POST
  form submissions are forbidden`. Astro's `checkOrigin` compares the browser's
  `Origin` against `url.origin`; behind TLS termination those are
  `https://host` and `http://host` and can never match.
- **v9.1.2 / #573** — feeds emitted `<link>http://…</link>` on an `https://`
  site, the same root cause reaching output instead of a comparison.

Both need a TLS-terminating proxy to appear. Dev, `bun run build`, the unit
suite and the Playwright smoke test all speak plain HTTP to the app, where the
two origins DO match — so 47 gates and 4,600 tests stayed green while the site
was broken. The round wrote the remedy down as "one scenario behind a
TLS-terminating reverse proxy would find both in seconds". This is that
scenario.

## A real two-hop topology, not a simulation of one

    fetch("https://localhost:P") ──TLS──▶ proxy ──plain HTTP──▶ origin

The origin server sees exactly what production sees: a plain `http://` request
URL, an `Origin` header naming `https://`, and `X-Forwarded-Proto: https`. That
asymmetry IS the bug, and it cannot be reproduced by constructing a `Request` by
hand — which is why the existing unit test passed throughout the outage. The
first assertion in the file checks the topology itself (the origin really does
see `http`), because without it every later scenario would pass for the wrong
reason.

Seven scenarios: the `APP_URL` branch that actually fixed production (proxy
trust is NOT enabled there), the trusted-proxy branch, an untrusted
`X-Forwarded-Proto` being correctly ignored, the host staying the visitor's
rather than `APP_URL`'s, the v9.1.1 form-POST refusal REPRODUCED against
`url.origin`, the same POST accepted against the resolved origin, and the
JSON-exemption that makes the shipped workaround sound rather than lucky.

Proven by mutation: reverting `resolveRequestOrigin` to bare `url.protocol`
fails three of them.

## Deliberately not the whole application

Booting `dist/` would need a database, a tenant and a session — which is what
makes an end-to-end HTTPS test the sort of thing a repo keeps not writing. This
mounts the two DECISIONS instead and exercises the real resolver over a real
socket. `site-origin:check` already proves the app routes through that resolver;
neither gate covers the other.

## The certificate is generated, never committed

A private key in the repository would be a GitGuardian finding on every commit
that touched it. `openssl` mints a throwaway pair per run.

Where `openssl` is missing the bar differs by where it runs, deliberately: a
contributor gets a warning and a working checkout, **CI gets a failure** — a
smoke test that stops smoking in CI is indistinguishable from one that passes.

One trap is recorded in the file because it cost a debugging round:
`Bun.spawnSync` THROWS `Executable not found in $PATH` rather than returning
`{ success: false }`, so the obvious guard never runs and `beforeAll` dies with
a bare `(unnamed)` failure naming nothing.
