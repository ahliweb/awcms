---
"awcms": minor
---

test(admin): nothing had ever watched an admin screen refuse a user who holds no permissions

The per-screen contract tests are source greps — they prove a page *mentions* a permission key, not that a control is hidden from someone lacking it. `admin-screens-render.e2e.ts` loads every screen as the seeded **owner**, who holds every permission. So the deny path — the half of authorization that actually matters — had never been executed by anything.

A screen can name the right key, gate the right control, pass every static test, and still render its contents: because the gate was written on a variable that is `true` for the wrong reason, or because the deny branch was simply never exercised.

### Four screens could not be checked at all

`loadAdminScreen` never redirects, so a denied screen RENDERS, and the convention is an element carrying `id="<screen>-denied"`. Forty-three followed it. **`site-profile`, `blog-settings`, `sidebar-menu` and `comments` rendered a correct denial message with no id on it.**

Nothing was broken for a user — they saw the right words. What was broken was verifiability: no mechanical check could tell those four apart from a screen that shows its contents to someone with no permission, because there was nothing to look for. A denial nobody can assert on is a denial nobody will notice losing.

All four now carry the hook, and `tests/admin-deny-path-contract.test.ts` keeps every gated screen carrying one — including the assertion that each still routes through `loadAdminScreen`, since a page reading its data without that has no deny path at all.

### `tests/e2e/admin-deny-path.e2e.ts`

Logs in as a tenant user whose role holds **zero** permissions, and requires of all 46 static gated screens: status `200` (a denial is a rendered page — a 404 would mean the screen *threw*, the `/admin/seo` class, and a throw must never read as a refusal) and the screen's own `#…-denied` element present.

The denial id is read **from each page's source**, not derived from its URL: several screens use a name that is not their route (`/admin/blog-ads` → `#ads-denied`, `/admin` → `#dashboard-denied`), and deriving would have produced confident failures against ids that never existed.

The restricted user is seeded through the same primitives the owner bootstrap uses — `hashPassword`, `linkIdentityToPrincipal`, the same tables in the same order — because a user assembled by hand with a different hash, or with no principal link (ADR-0086), would be testing a shape the login path never produces.

### Verified in both directions

Green across all 46 screens. With `canRead` forced true on `/admin/site-profile` — a simulated authorization leak — the suite goes **red naming that screen**.

One correction worth recording: the first run reported those same four screens as leaking, and they were not. The server was serving a build made before the hooks were added. The finding was a stale artefact, and re-running against a fresh build is the only reason it was not reported as a defect.

**Not covered, deliberately:** a *partially*-permissioned user seeing the right subset of controls. Expected results differ per screen there, so it is per-screen knowledge rather than one mechanical rule, and it is a larger piece of work.
