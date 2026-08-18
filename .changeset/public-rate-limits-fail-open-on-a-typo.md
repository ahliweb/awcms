---
"awcms": patch
---

fix(security): a typo in a rate-limit env var switched the limiter off entirely

Three PUBLIC, unauthenticated endpoints read their rate-limit thresholds as
`Number(process.env.X ?? 60)`. That expression is wrong in two directions, and
both failures are silent:

- `??` falls back only on `undefined`/`null`. A **non-numeric** value —
  `SITE_SEARCH_RATE_LIMIT_MAX=6O` with a letter O — yields `NaN`. Every
  comparison against `NaN` is `false`, so `count > NaN` never trips and **the
  limiter is off**. Worse than merely off: the `rate_limited` metric stays at
  zero, which an operator reads as evidence of no abuse.
- An **empty** value is not `undefined`, so `??` does not fire either;
  `Number("")` is `0`, and a ceiling of zero 429s every visitor on their first
  request.

The three: `/api/v1/site-search/query` (anonymous full-text search),
`/api/v1/site-search/suggest` (runs on every keystroke), and
`/api/v1/setup/initialize` — the last being the highest-value of them, because
it bootstraps a tenant, office and owner for an unauthenticated caller and that
limit is the only bound on how many Cloudflare siteverify round-trips and
multi-row bootstrap attempts one caller can drive.

`resolveLoginPolicyConfig` learned this in Issue #147 and grew its own parser.
The lesson never travelled; this moves it to
`src/lib/security/env-thresholds.ts` where the next public endpoint will find
it.

### Why the helper takes the VALUE and not the variable name

The obvious shape — `parsePositiveIntEnv("SITE_SEARCH_RATE_LIMIT_MAX", 60)` —
would have been a quiet regression. `config:env:coverage:check` resolves literal
`process.env.NAME` spellings and says in its own header that computed reads
"need a human". A variable read only through a name-taking helper therefore
stops being checked against `.env.example`, and an operator loses the one
artefact telling them the knob exists. So the call site keeps the literal read
and passes the value; the name is used for the warning and nothing else. A test
asserts that literal spelling survives, so a future "tidy-up" cannot undo it
silently.

Bad values now fall back to the documented default and warn once — deduplicated
per `name=value`, because a per-request warning on a public endpoint is a free
log-volume amplifier.
