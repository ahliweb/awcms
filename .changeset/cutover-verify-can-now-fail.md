---
"awcms": patch
---

fix(seo): the pre-cutover gate exited 0 on every usage error and called an unchecked target `ok` (#599, #711)

`blog:legacy:cutover:verify` is the only tool that can fail the SeputarBorneo
Definition of Done. It could not fail. Two defects, either one sufficient on its
own, and together they let it print _"All N legacy URL(s) resolve in one hop to a
page this deployment serves"_ for a map whose origin 404s every entry.

**`usage()` never set `process.exitCode`.** Reproduced by execution, exit 0 for
all of: no arguments, a missing `--tenant`, a missing `--tenant-code`, a missing
`--sitemap`, a misspelled flag name, an empty `--sitemap=` value (the `$F` a
shell expands to nothing), and `--limit=abc`. So
`bun run blog:legacy:cutover:verify --sitemap=$F && deploy` deployed on a typo,
having verified nothing — while the last line of that same banner promised
_"exits non-zero when any URL would lose its ranking"_. One missing line, inside
the function whose own text made the promise.

**`classifyCutoverOutcome` returned `ok` for every target it could not check.**
It handled `targetLive === false`; `targetLive === null` fell through to
`return "ok"`. And `null` was the answer for everything that was not
`/blog/{tenantCode}/{slug}` — which is every one of ADR-0113's 62 `/kategori/*`
targets. There is now a `target_unverifiable` verdict, it is not clean, and the
run exits non-zero on it. `--json` rows carry `reason` and `targetLive` too, so
the distinction between _checked and missing_ and _never checked_ survives into
the report a human reads later.

**The lookup was widened so `target_unverifiable` means something.** A verdict
that fires for families this repo really does serve would be noise, so
`classifyPublicBlogTarget` now enumerates all eight routes under
`src/pages/blog/[tenantCode]/` — post, page, category, tag, index, search,
`feed.xml`, `sitemap-blog.xml` — and resolves each through the same function the
route itself calls (`fetchPublicTermBySlug`, `fetchPublicBlogPageBySlug`,
`fetchPublicBlogPostBySlug`). A path under the tenant that no route matches is
`unrouted`, which is a knowable 404 rather than an unknown. `target_unverifiable`
is now reserved for what it should always have meant: **not this deployment's
surface**.

Two smaller things that came out of grepping the calls rather than reading them:
the routes check `legacyTenantRouteEnabled` (and `rssEnabled`/`sitemapEnabled`)
**before** they look anything up, so this job now reads those settings once per
run and warns when the public surface is off — without that, it reported live
destinations for a tenant serving no public content at all. And it never closed
its SQL client; it does now, the shape every other `blog:legacy:*` script uses.

**`--urls=<path>` dissolves the "needs the live sitemap" blocker.** There is no
SeputarBorneo sitemap — not in the legacy tree, not in git history, and the live
site 404s `/robots.txt` and every conventional sitemap path while serving 200
itself. But `--sitemap` always read a **local file**, so the blocker was only
ever the XML wrapper. `--urls` takes one URL per line, skips blank lines and
whole-line `#` comments (a `#` inside a URL is a fragment, and is kept), refuses
a file that is nothing but comments, and combines with `--sitemap`.

**What a green run still does not prove**, now written into the script's own
docstring: this job makes **zero HTTP requests**. It asks the database "is there
a rule, and is there a row at the end of it", not "does the origin a reader hits
emit a 301". Under ADR-0114 the legacy 301s execute at the **edge**, which this
cannot see. Verifying that means requesting the URLs and reading the `Location`
headers, and that is a different tool.

Every fix is covered by a test proven to fail on the real defect — the four
mutations were applied and run, not reasoned about. `tests/blog-legacy-cutover-verify-cli.test.ts`
drives the real process with `Bun.spawnSync` for the exit codes (with a control
that a legitimate invocation is still accepted), and
`tests/integration/cutover-target-liveness.integration.test.ts` asserts against a
real PostgreSQL that a `/kategori/*` target is **not** reported `ok` — the exact
assertion whose absence let 62 rules look verified.
