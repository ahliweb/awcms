---
"awcms": minor
---

test(admin): 41 of 48 admin screens were never loaded by anything — plus a correction, the symptom is a 404

`/admin/seo` had never rendered, and the reason nobody noticed is that **nothing requested it**. Seven admin screens were exercised by the CRUD e2e specs; the other 41 were never loaded in CI, by any gate, in any form. `admin:screen-coverage:check` looks adjacent but answers whether a screen CLAIMS a permission — it never loads a page.

`check:astro-frontmatter:check` now catches the static half of that class. This is the other half: a screen can type-check perfectly and still throw at render time on a `null` row, a missing permission seed, or data this tenant does not have.

### The route list is discovered, not written down

`tests/e2e/admin-screens-render.e2e.ts` enumerates `src/pages/admin/**.astro` at run time and loads every screen as the seeded owner. A hardcoded list is the failure mode this repo keeps finding — a gate checking its own matrix rather than what exists, staying green while the thing it names drifts away. Adding a screen without covering it is now impossible: the screen IS the test case.

The one dynamic route (`/admin/modules/[moduleKey]`) derives a real id from the listing page that links to it, and **fails rather than skips** when none can be found. A silent skip is how a dead screen stays dead.

One session, soft assertions: 48 logins would be wasteful, and a hard assertion would stop at the first broken screen, so a run would surface one defect at a time.

### Correction: the symptom is a 404, not a 500

Verifying this test meant reintroducing the `/admin/seo` fault and watching a real server answer. **It does not answer 500.** The `ReferenceError` goes to the server log; the browser is handed a **404**.

ADR-0112 and everything repeating it said 500. All of it is corrected here, and ADR-0112 carries an amendment recording the discovery.

This is not a detail. It changes how the class is hunted: asking "which admin screens return 5xx?" finds nothing and concludes the fleet is healthy, because a screen that throws on every render is indistinguishable, by status alone, from a route that was never built.

So the test asserts **`200` exactly** — the seeded owner holds every permission, so every admin screen owes it a rendered page — rather than "not 5xx", which would have passed straight over the defect it exists for. Verified in both directions against a real server: green on all 48 screens, and red naming `/admin/seo` when the fault is restored.
