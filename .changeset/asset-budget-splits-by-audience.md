---
"awcms": minor
---

fix(build): the asset budget could not see the thing its premise was about

`build:asset-budget:check` gated one number — the byte total of `dist/client` —
against a ceiling whose stated premise is written into its own failure message:
the symptom it exists to prevent arrives as "the public pages feel slow".

Attribution from Astro's SSR route manifest (Issue #590) shows that number could
not see reader weight at all.

### The measurement

A public content page loads **zero** `_astro` assets. Those pages are not Astro
components — `src/pages/blog/`, `[...path].ts`, the feeds and the sitemaps are
`.ts` routes emitting their own shell through `public-page-rendering.ts`, which
links two absolute paths out of `public/`.

```
reader (public content pages)   21,415 B   css/public-content.css + js/news-share.js
app    (admin, auth, landing)  165,274 B   every _astro/* chunk + push-sw.js
```

Reader weight was 11% of an admin-dominated total, which made it effectively
unmeasured — verified by planting the regression:

```
reader regression of +5,000 B  ->  total 191,689 B  <=  ceiling 192,000 B  ->  PASSED
```

5,000 B is a **23% increase in what a visitor to an article downloads**, and the
gate waved it through.

### The change

`TOTAL_BUDGET_BYTES` is replaced by two budgets (ADR-0101):
`READER_BUDGET_BYTES` = 24,000 and `APP_BUDGET_BYTES` = 172,000. Neither surface
can spend the other's allowance.

Classification is derived where structure allows — everything under `_astro/` is
`app`, no list to maintain. `public/` files are declared in
`PUBLIC_ASSET_AUDIENCE`, enforced **both ways**: an undeclared file in the build
fails, and a declaration naming a file the build did not emit fails too.

That second rule exists because of a defect found on the way:
`security-headers.ts` asserted "`public/` holds exactly two files" while it held
three — `push-sw.js` had landed ten days earlier and nothing re-read the claim.
The CORP reasoning survives the correction; the enumeration is now gated so it
cannot decay again.
