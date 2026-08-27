---
"awcms": patch
---

fix(ops): the synthetic check asserted `200` on a URL that is designed to redirect, and would have sat red forever

ADR-0098 made `/blog/{tenant}` an ALIAS: it answers `307` to
`/{locale}/blog/{tenant}`. Probe 6 asserted `200` on the bare URL without
following, so it went red the day that landed — and its own §ALERT DISCIPLINE
describes exactly what happens next: the first failure alerts, repeats stay
quiet, and the check becomes one people have learned to ignore.

Worse than noisy: red for the wrong reason, with the real defect hiding behind
it. v10.0.0 shipped that redirect pointing at a **404** — the hop was healthy
and the destination was not, and each half looked fine when probed alone. A
probe that stopped at the `307` could not tell those two states apart.

So the assertion is now the PAIR. `-L` follows the hop and requires the
destination to serve; `%{url_effective}` requires it to be the locale-prefixed
spelling. The second half is not decoration — a `200` on a bare URL would mean
the prefix silently stopped being canonical, and every cache entry and every
`hreflang` this site publishes would then disagree with what it serves.

Verified against production after v10.0.1: `blog index 200 at its
locale-prefixed URL (https://awcms.ahlikoding.com/id/blog/ahliweb)`, whole
check `VERDICT: all probes passed`, exit 0 — through Cloudflare and Varnish,
not against the container.
