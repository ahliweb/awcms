🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0083-this-template-deploys-to-one-environment.id.md)

# ADR-0083 — This template deploys to ONE environment, and its root is not a 404

- **Status:** Accepted (2026-08-11).
- **Amendment (11 August 2026, before this ADR was committed and released):** the
  first version of this ADR **kept** `staging` as a legitimate
  `ModuleDeploymentProfile` and rejected its removal. The repo owner
  reversed that position; the decision in force is that `staging` is **removed
  entirely**. The overridden reasoning is not deleted — it is recorded in full in
  §"The overridden position".
- **Context:** Deploy readiness audit of 11 August 2026 (sixth round,
  `docs/PROJECT_STATE.md` §4). No migrations.
- **Amends:**
  [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  — the consequence "`/` is a 404" is revoked, see §"The root stops being a 404".
- **Builds on:**
  [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (development
  confined to two repos) and
  [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
  (the role split with `awcms-astro`).

## Decision

This repo has **exactly one live deployment**: **production** at
`awcms.ahlikoding.com`. There is no staging of its own.

`staging` is **removed entirely** from `ModuleDeploymentProfile` in
`src/modules/_shared/module-contract.ts`. Its union becomes `development |
production | offline-lan`. What is lost is not just this repo's second
environment, but **the profile itself**: the name `staging` stops existing in the module
contract, in the profile document, and in every reference that followed it.

That decision was taken by the repo owner after weighing the opposite position — the
position this ADR wrote down first and now records in §"The overridden position".
What settled it: a template that carries a profile which **its own reference
deployment does not use** is a profile nobody here has ever run,
and **a deployment profile that is never run is a claim,
not a capability**.

## The overridden position

The first version of this ADR decided the opposite, and its argument is rewritten here
**in full, not deleted**. ADRs in this repo have value precisely because the rejected
alternatives and their reasons are kept too; a reversal that erases
its own trail forces the next person to re-derive the entire deliberation from
zero — and the next person usually derives something different.

**What used to be decided.** `staging` REMAINS one of the legitimate profiles. What
changes is only **this repo's deployment topology**, not its template's capabilities.
Derived installations built from this template serve real businesses,
have data and traffic that genuinely deserve a rehearsal first, and are entitled to all four
profiles along with the entire staging isolation contract already written down.
Removing `staging` from the type union means **taking something away from every
template user in order to simplify one demonstration deployment** — and that
distinction was cited as the whole reason this ADR was safe.

**Why the repo owner reversed it.** The argument above stands on one
premise that was never examined: that a name in a type union is a
capability. It is not. `ModuleDeploymentProfile` is compared as a plain
string by `module-composition.ts`, and the comment in its own contract file
already concedes that keeping that list in sync with the profile document is
"a documentation obligation, not compile-time enforced". So what `staging` actually
offered a derived installation is **a label and
a piece of procedure** — both of which they can still write themselves, and the procedure
stays written down (see §Consequences). What they cannot borrow is proof
that the label is still true: not one deployment runs it,
no gate goes red when it rots, and nobody
will notice. This repo has a long history of confident documents
describing a world that does not exist — §"What this ADR is actually correcting" below
is an example that has just been expensive. Keeping `staging` means
storing one more of them, this time inside the type.

## Why a template does not need its own staging

Staging exists to **rehearse changes against real data and traffic before
touching them**. This repo has neither: its live deployment exists to
demonstrate and validate the template, not to serve a business. What would be
"staged" is the template itself — and a template is validated by a chain of 39
gates plus a Postgres-backed integration suite in CI, not by a second running copy.

So staging here is not a safety net, it is **a second environment
that has to be maintained**: one more set of secrets, one more database needing backups, one
more migration queue, one more domain, and one more place that can
silently go stale. That cost is real and recurring; the return is zero.

## What this ADR is actually correcting

What drove this ADR is not architectural preference. As of 11 August 2026,
**reality already differed from the documents, and the documents lost**:

- The production application row (`got4etcblum9kowdv4mrixqo`) **does not exist** in Coolify's
  `applications` table — it is not a soft delete; there is no `deleted_at` either.
- There is no production database in `standalone_postgresqls`; the only one there is
  `awcms_staging`.
- The `awcms-staging-varnish` container installs the Traefik rule
  ``Host(`awcms-staging.ahlikoding.com`) || Host(`awcms.ahlikoding.com`)``,
  so **the production domain is served by the staging deployment on top of the staging
  database** (`APP_ENV=staging`).

So the two-environment topology stopped holding some time ago, and
`docs/awcms/environments.md` kept describing a world that does not exist. This ADR
makes the documents and reality agree **by picking one**, not by
rebuilding the second.

There is an operational lesson recorded along with it because it misled for
hours: `https://awcms.ahlikoding.com` answered **200**, healthy, the whole
time. **A 200 on the production domain is not proof that production is alive.**
Verify against `applications`/`standalone_postgresqls`, not against `curl`.

## The root stops being a 404

[ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
accepted `/` = 404 on an openly stated premise: `awcms-astro` carries the
public pages, so the domain root does not belong to this application.

That premise is true for a **site**. It is not true for **this template's own
deployment domain**: there is no `awcms-astro` in front of
`awcms.ahlikoding.com` (as of today both `awcms-astro` apps on that host are
`exited`), so that domain's front door is this application. And
a front door that answers 404 to anyone who types the name of the
domain is a defect, not a decision.

So `src/pages/index.astro` serves an **informational landing page**:
what AWCMS is, what is inside it, and a link to `/login`. Its limits are
deliberately narrow, and each limit answers something:

- **No tenant data.** This page lives at the deployment domain root, not
  inside a tenant. Reading from the database would make the front door
  depend on tenant resolution which (with `PUBLIC_TENANT_RESOLUTION_MODE`
  empty) is not switched on at all.
- **No NEW client scripts.** The only script on this page is the existing
  `THEME_INIT_SCRIPT_BODY` — its hash is already in `script-src`
  unconditionally, so the CSP does not change at all and there is no new hash
  bookkeeping. It is used because without it this page would ignore the visitor's
  dark/light preference; rewriting its palette in its own
  `prefers-color-scheme` block would duplicate tokens and create two sources of
  colour truth.
- **No enumeration.** It names no tenant, no tenant count, no version, and no
  module status to an anonymous visitor. `/login` already decides for itself
  how much it displays (an earlier ADR: a capped tenant picker);
  this page does not add to that surface.
- **`noindex` is NOT set.** This is the only page in this repo that genuinely
  deserves to be indexed: it describes the template, not anyone's data.

The catch-all `src/pages/[...path].ts` is **unchanged**. Astro ranks
`[...path]` lowest, so `index.astro` wins at `/` and every unknown path
still gets a clean 404 that leaks nothing (Issue
#540, guarded by `tests/e2e/not-found.e2e.ts`).

## What was REJECTED

1. **Rebuilding a separate production environment and restoring staging.**
   That reinstates a cost §"Why a template" has just shown nobody
   buys, and does it only because an old document promised it.
2. **Keeping `staging` in `ModuleDeploymentProfile` as a "template
   capability".** This was the first version of this ADR's decision, and it is **overridden** —
   the full account is in §"The overridden position". In short: a profile name
   that is never run offers nothing that an installation which genuinely needs it
   cannot write itself, while
   its cost is paid continuously by every reader who assumes it is maintained.
3. **Leaving `awcms.ahlikoding.com` served by an `APP_ENV=staging` deployment.**
   It works today, and that is exactly the problem: the environment name stops
   meaning anything, and the next person who reads `APP_ENV` to decide
   something dangerous will get the wrong answer confidently.
4. **Making the landing page a themed tenant page.** It would tie
   the domain's front door to `theming` + tenant resolution, and make
   a 404 (or a blank page) the first failure mode on exactly the
   surface this ADR exists to fix.
5. **Redirecting `/` to `/login`.** A visitor who does not yet know what AWCMS is
   gets handed a credentials form. A front door explains itself first;
   the login link is on that page for whoever is actually looking for it.

## Consequences

- **There is no longer a pre-production rehearsal for migrations, and this is a real cost.**
  Previously staging could receive `sql/NNN` first. Now it cannot. What
  replaces it: the CI integration suite runs against a real Postgres service,
  and the operator runbook **requires a backup verified to be
  restorable** before a migration is applied (`deploy/backup/restore-postgres.sh`,
  verify-only mode). That is a mitigation, not an equivalent replacement — recorded here
  so the next decision knows what was given up.
- **Derived installations that want a pre-production tier use
  `development`, or stand up a SECOND `production` deployment.** Both are
  real paths and both are more honest than a third name: `development`
  for an environment that genuinely is not production, a second `production` for a mirror
  that must behave exactly like production (and therefore **must**
  use production configuration, not looser configuration just because its
  name is different). What is lost is the name, not the tier.
- **The isolation contract once filed under the name "staging" is NOT lost with
  it** — it applies to **any second environment**: its own database and
  `awcms_app` role, its own secrets (not copies of production's), outbound
  integrations off (`R2_ENABLED=false`, `EMAIL_ENABLED=false`, sync disabled),
  `NEWS_PORTAL_PROFILE` **removed** rather than set to another value, DNS provider
  `manual`, a different edge cache purge token per environment, and an owner password
  that is never the same even when the identifier is. It stays alive in
  `docs/awcms/environments.md` and `docs/awcms/deployment-profiles.md`, now
  written as rules for **a second environment**, not as an appendix to
  a profile named `staging`. It is expensive to re-derive —
  part of it was paid for with real mistakes on `awcms-micro`'s staging — so it is
  **moved, not deleted**, and that move is a condition of this
  decision, not a cleanup that follows it.
- `docs/awcms/environments.md` and `docs/awcms/deploy-coolify.md` shrink to
  one environment for this repo, and `docs/awcms/deployment-profiles.md`
  shrinks to **three** profiles.
- The Traefik rule mapping `awcms.ahlikoding.com` to the staging Varnish must be
  withdrawn when production is stood back up; until that happens, the production domain
  serves staging data. Tearing down the staging app, database, and Varnish
  themselves is infrastructure work separate from this repo.
- `/` is indexed. There is no new authenticated surface: this page has zero
  queries, zero scripts, zero inputs.
