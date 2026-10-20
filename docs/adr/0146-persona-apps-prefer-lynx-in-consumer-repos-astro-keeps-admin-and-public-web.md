🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.id.md)

# ADR-0146 — Persona apps prefer Lynx in their own consumer repos; Astro keeps every admin and public web surface

- **Status:** Proposed
- **Review:** becomes Accepted after maintainer review. Until then it is a recommendation, and the structural gate in §7 already holds because it only forbids what no decision has admitted.
- **Date:** 2026-10-20
- **Decision maker:** @ahliweb (maintainer review pending)
- **Refines:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (the family stays two repos; a persona app is a **consumer** in its own product repo, never a third family repo) and [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) (the boundary of admin ownership is WHAT IS MANAGED; this ADR adds which web technology each surface uses). Neither is superseded, and neither body is rewritten (Rule 2 of the ADR index).
- **Related:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (every SYSTEM admin screen is built here), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (frozen consumer contract), [ADR-0002](0002-bun-only-runtime.md) (Bun-only), [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) (public URL vocabulary), Issue #1133; consumer-side counterpart `ahliweb/awcms-one` #445

**Docs and governance only.** This ADR adds no module, no migration, no OpenAPI path, no AsyncAPI channel, no dependency and **no Lynx code**. It records a technology-selection policy per product surface, and it ships one structural gate (§7) that keeps the policy from eroding silently.

## Context

Two things are both true on `main` (20 October 2026), and the risk is that a reader fuses them:

1. **Every admin surface and the public web are Astro today, by decision.** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) puts every SYSTEM admin screen in this repo under one `/admin/*` shell; [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) lets `awcms-astro` carry public pages and, when a site declares it, the USER admin surface. Astro supports static generation and **on-demand rendering per route** ([Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)), which is what an authenticated, dynamic admin and a crawlable public site each need.
2. **Product teams now want persona-specific apps** (customer, driver, courier, partner/agent, warehouse and field staff). These are transaction-heavy, interaction-intensive or native-capability-bound (camera, location, push, barcode, offline), which is a different problem from an admin console or a public page. [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) already decided where such an app lives: the family stays two repos, and an app built for a persona is a **consumer** in its own product repo, not a third core repo and not a copy of the backend.

Lynx (LynxJS, with ReactLynx as its React binding) is the candidate for the second group. Its own documentation lists support for Android, iOS, HarmonyOS and Web, **with API compatibility that differs per platform and per version**, and a separate web bundle output ([compatibility](https://lynxjs.org/next/guide/compatibility.html), [build](https://lynxjs.org/next/guide/build/index.html), [integrating with existing apps, including Web](https://lynxjs.org/next/guide/start/integrate-with-existing-apps)). Two consequences follow, and the first shapes the whole decision: **parity of features across those targets must not be promised before a proof of concept**, and nothing about Lynx makes it a reason to touch the admin or the public site.

A search of this repo's issues for `lynx` found nothing specific when this was planned (Issue #1133), so there is no prior decision to build on and no code to migrate. Without a written rule, the likely failure is not a bad Lynx app; it is a well-meant PR that adds a `@lynx-js/*` workspace to the backend repo, or "modernises" an admin screen into Lynx because it is installable on a phone.

### The word "app" is the trap

"App" gets used for three different things: an installable icon, a mobile viewport, and a persona workflow. Only the third is a reason to pick a different UI technology. A `/app` URL, a phone-sized layout, or an Add-to-Home-Screen manifest does **not** turn an admin console into an app; an admin console that is installable as a PWA is still an admin console. This ADR defines "persona app" by **function**, not by URL, device or installability.

## Decision

### 1. Surface to technology

| Surface                                                                | Kind id              | Technology                                   | Home                                 | Rule                                                                                                     |
| ---------------------------------------------------------------------- | -------------------- | -------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| SYSTEM admin (tenant, owner and platform screens)                      | `system-admin`       | Astro SSR (SSG only where viable)            | ahliweb/awcms                        | Stays here under the admin shell; never migrated to Lynx.                                                |
| USER admin of a site                                                   | `user-admin`         | Astro SSR when authenticated (SSG per route) | ahliweb/awcms-astro                  | Stays in awcms-astro, only when the site declares permukaanAdmin (ADR-0070); owner is rejected there.    |
| Public pages: blog and news, profiles, public catalogue, landing, SEO  | `public-web`         | Astro SSG/SSR per route                      | ahliweb/awcms or ahliweb/awcms-astro | Public URLs, SEO metadata, sitemap, canonical, accessibility and crawlability are preserved; never Lynx. |
| Persona apps (customer, courier, driver, partner, warehouse and field) | `persona-app-native` | LynxJS + ReactLynx (preferred candidate)     | a separate consumer product repo     | Own repo; official API contracts only; no Lynx in the admin or public shell.                             |
| App-like mobile web that is not public, SEO or admin                   | `persona-app-web`    | Lynx for Web (only if the PoC passes)        | a separate consumer product repo     | Only after the PoC gate passes; any fallback or alternative needs its own ADR.                           |
| An admin that is installable or planned as a PWA                       | `pwa-admin`          | Astro web app / PWA                          | the repo of the admin it packages    | A PWA is not a reason to replace admin UI with Lynx.                                                     |

The table is the authority for the rule text. [`scripts/lib/product-surface-policy.ts`](../../scripts/lib/product-surface-policy.ts) carries the same six rows as data and a classifier from a scenario descriptor to a kind; [`tests/product-surface-policy.test.ts`](../../tests/product-surface-policy.test.ts) fails if the table here and that module disagree (§7).

**Precedence when a surface fits more than one row** (this is the semantic note made executable):

1. **Anything that manages the system or manages a person's own part of a site is an admin surface and stays Astro**, regardless of device, URL or installability. An installable one is `pwa-admin`; otherwise `system-admin` or `user-admin`.
2. Otherwise, a page meant to be crawled and shared is `public-web`.
3. Otherwise, a persona workflow is `persona-app-native` (native channel) or `persona-app-web` (browser channel).
4. Otherwise the surface is **unclassified**, and the Definition of Ready (§6) is not met: someone must decide what it is before anything is built.

"Preferred candidate" is deliberate wording. Lynx is the technology to evaluate first for a persona app; it is **not** an admission. It becomes an adopted choice for a given product only when that product's PoC gate (§5) passes and its consumer repo records the result.

### 2. Non-negotiable boundaries

These hold for every persona app, whatever UI technology it uses.

1. **The AWCMS backend stays the system of record**: Bun, Astro for its web surfaces, PostgreSQL, `FORCE` RLS, default-deny RBAC/ABAC, audit, idempotency, domain events and outbox. A Lynx app is a **client**. It is not a second backend, and it never reads the database or module internals directly.
2. **A persona app uses only the public contracts suited to its actor** (OpenAPI, DTOs, event contracts). It does not import `src/modules/`, share secrets, use a superuser database role, or reach an admin endpoint implicitly. A new API is added only for a stated use case and with per-resource authorization (guarding against BOLA/IDOR), through the normal endpoint flow ([`awcms-new-endpoint`](../../.claude/skills/awcms-new-endpoint/SKILL.md)).
3. **Authentication and session are designed per client type** and do not duplicate or weaken the security policy: OAuth/OIDC with PKCE, or an application-credential design approved by an ADR where relevant; secure token storage on native (never `localStorage` for a native secret); CSRF, CORS and per-origin control on Web; rotation and revocation; device binding when needed.
4. **Cache, offline and sync never bypass access rights.** A persona app's design states conflict handling, replay, idempotency, tenant context, logout and remote revoke, and data minimisation. Push notification needs the adapter appropriate to each platform (APNs, FCM, Web Push); compatibility is never assumed.
5. **Lynx integration lives in the consumer's own repo.** `awcms-astro` does not become a Lynx repo, and no Lynx UI workspace is added to this repo, without a separate ADR (§7 makes that mechanical).
6. **Bun-first and Bun-only still apply here.** Lynx and RSBuild tooling have their own prerequisites (their quick-start mentions Node), so Bun support is verified in the PoC repo first. Node, npm, pnpm or yarn is not added to this repo because a Lynx quick-start names it ([ADR-0002](0002-bun-only-runtime.md); an exception needs maintainer permission and a written record).
7. **Platform differences follow the official compatibility matrix.** A persona app is tested on Android, iOS, HarmonyOS and Web (plus the supported browsers), for accessibility (WCAG 2.2), localisation, low-end device performance, telemetry and crash reporting. "Write once" is a development convenience, not a promise that every API behaves identically.
8. **Security and privacy compliance applies:** ISO/IEC 27001/27002/27005/27701, ISO/IEC 27034, OWASP MASVS/ASVS, Indonesian Law 27/2022 on Personal Data Protection and Government Regulation 71/2019; a threat model and a DPIA when sensitive data is processed ([`privacy-analysis.md`](../awcms/privacy-analysis.md)).

### 3. Options considered

| Criterion               | Astro SSR/SSG (status quo)                         | Lynx native (ReactLynx)                                                            | Lynx for Web                                                            | Astro PWA                                                       |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Security                | Mature here: CSP single-owner, session, chokepoint | Client-side secure storage and PKCE must be designed per OS; larger client surface | Browser model plus a separate bundle; CSRF/CORS/per-origin work is ours | Same posture as the admin today; Service Worker scope to manage |
| Accessibility           | WCAG AA is tested for the admin (axe in CI)        | Per-platform a11y; to be verified by the PoC                                       | Depends on the web renderer; to be verified by the PoC                  | Semantic HTML, directly testable                                |
| SEO                     | Best: server-rendered, crawlable, canonical        | Not applicable (not web)                                                           | Not a fit: not built for crawlable documents                            | Possible, but a PWA shell adds nothing for SEO                  |
| Performance             | Fast first paint; heavy client islands are avoided | Native-like interaction; low-end devices must be measured                          | Unmeasured; web bundle is a separate output                             | Good after install; first load depends on the network           |
| Maintainability         | One stack, one shell, gated in this repo           | A second stack, in a separate repo, owned by the product team                      | A second stack and a second build output to keep consistent             | One stack, shared with the admin                                |
| Bun tooling             | Verified (Bun-only is enforced here)               | Unverified; the PoC must show Bun works or an exception is recorded                | Unverified; same                                                        | Verified                                                        |
| Upgrade / compatibility | Astro 7 in lockstep with the repo gates            | Per-platform and per-version API differences (official matrix); upgrade cost real  | Same matrix plus browser support                                        | Browser PWA support varies, but the codebase is unchanged       |
| Cost                    | Lowest: no new stack                               | A new team skill set and CI per platform                                           | Same, plus a web target to test                                         | Low                                                             |
| Migration               | None                                               | None (greenfield persona apps only; no existing UI moves)                          | None                                                                    | None                                                            |
| Operational complexity  | One deployment surface                             | App store release, device fleet, crash reporting, push adapters                    | Extra deployment and cache surface                                      | One deployment surface plus Service Worker updates              |

Reading of the table:

- **Astro SSR/SSG is the answer for admin and public web**, because those need server-side authorization, crawlability and the gates already in this repo. Nothing in Lynx's documented scope argues for replacing it.
- **Lynx native is the candidate for persona apps** because the persona function (camera, location, push, barcode, offline sync, interaction-intensive workflows) is what a native client exists for, and it keeps the web surfaces simple. It is a candidate, not an adoption: its Bun tooling, per-platform compatibility and security properties are open until the PoC.
- **Lynx for Web is deliberately the most conditional row.** It is admissible only for an app-like mobile web experience that is not public, not SEO and not admin, and only after the PoC covers browser support, rendering, history and deep links, offline and Web Push.
- **Astro PWA is the answer for an installable admin.** It does not need Lynx to be installable, so installability is never an argument for Lynx.

### 4. Seven scenarios

Pinned both here and in the regression test, so the decision matrix and the code classify them the same way.

| #   | Scenario                                                | Classification (kind ids)                             | What stays where                                                           |
| --- | ------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Customer app on Android/iOS and a private web app       | `persona-app-native`, `persona-app-web`, `public-web` | Lynx consumer + authorised commerce API; the **SEO catalogue** stays Astro |
| 2   | Driver app with location and notifications              | `persona-app-native`                                  | Lynx consumer; never calls a system admin endpoint                         |
| 3   | Courier app with proof of delivery and camera           | `persona-app-native`                                  | Lynx consumer; camera and location permissions are tested per OS           |
| 4   | Partner or agent app with orders and commission         | `persona-app-native`                                  | Lynx consumer; isolated actor and tenant access                            |
| 5   | Warehouse or field staff app: barcode scanning and sync | `persona-app-native`                                  | Lynx consumer; offline policy plus idempotency                             |
| 6   | Managing modules, users, permissions, audit and tenants | `system-admin`                                        | Astro under the admin shell in this repo                                   |
| 7   | News, blog and landing portal                           | `public-web`                                          | Astro SSG/SSR, not Lynx                                                    |

Issue #1133's heading says "five scenarios" while it lists seven; the list is the authority, and all seven are pinned.

### 5. The Lynx proof-of-concept gate

No persona app built on Lynx enters production, and `persona-app-web` is not used at all, until a PoC has passed. The PoC runs **outside this repo** (a disposable PoC repo or the consumer's own repo), and **Lynx is not brought into AWCMS to run it**.

The PoC must establish, with a link to the evidence recorded in the consumer repo:

| Area             | Must be shown                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targets          | Builds and runs on Android, iOS, HarmonyOS (when the product targets it) and Web, against the official compatibility matrix for the version in use         |
| Capabilities     | Every capability the persona needs works on every target it is claimed for: camera, location, barcode, push (APNs/FCM/Web Push), local storage, deep links |
| Web (if claimed) | Supported browsers, rendering, history and deep links, offline, Web Push                                                                                   |
| Security         | PKCE sign-in, secure token storage on native, logout and remote revoke, no secret in client storage; MASVS-relevant checks                                 |
| Offline and sync | Conflict, replay, idempotency (`Idempotency-Key`), tenant context, data minimisation on a revoked session                                                  |
| Quality          | Accessibility (WCAG 2.2), localisation (id and en), low-end device performance, telemetry and crash reporting                                              |
| **Bun**          | The install, dev and build workflow runs under Bun, **or** the gap is written down with the maintainer's permission for an exception                       |

**If the PoC fails** on support, UX or security, the result is not a shrug: the consumer's ADR records the exception (what failed, which alternative is used, for which surface). A fallback or alternative for `persona-app-web` also needs its own ADR. The PoC result is recorded **before** a Lynx app ships to production.

### 6. Definition of Ready for a new product surface

Answered at step 9 of [`alur-pengembangan.md`](../awcms/alur-pengembangan.md), before any code. A new screen or app does not start until each answer exists.

1. **What does it manage, and for whom?** If it manages the system or someone's own part of a site, it is admin: stop, it is Astro (`system-admin`, `user-admin` or `pwa-admin`).
2. **Is it public and meant to be crawled?** Then `public-web`: Astro.
3. **Is it a persona workflow** (transactional, interaction-intensive, native-capability-bound)? Then `persona-app-native` or `persona-app-web`. Record the kind id the classifier returns; if it throws, the surface is unclassified and is not ready.
4. **Which repo?** A persona app is a consumer repo with its own issues. The consumer issue exists, and this repo gets no UI feature for it.
5. **Which public contracts does it call**, and does each endpoint already exist with per-resource authorization for this actor? A missing endpoint is a normal API issue here (OpenAPI, ABAC, tenant context), raised on its own use case.
6. **Auth and session** for this client type, per §2.3.
7. **Offline, cache and sync policy**, per §2.4, if it works offline.
8. **Push** adapter per platform, if it notifies.
9. **PoC result** (§5) linked, or the PoC is the first task and nothing is built before it.
10. **Threat model, MASVS/ASVS, and a DPIA** when sensitive data is processed (§2.8).

### 7. Enforcement: a structural gate, not a word detector

[`tests/product-surface-policy.test.ts`](../../tests/product-surface-policy.test.ts) does three things:

- **Pins the seven scenarios** to the classification above, and pins the edge cases the semantic note names (an installable admin is `pwa-admin`; an admin in a native wrapper is still `system-admin`; an installable public page is still `public-web`; an unclassifiable surface throws).
- **Checks parity** between the §1 table (and this ADR's Indonesian mirror) and the policy module, and fails with a message naming the drifted row. The table cannot be edited without the module, nor the module without the table.
- **Keeps Lynx out of this repo structurally**: it fails if `package.json` declares any `@lynx-js/*` package in any section, if any file under `src/` imports from `@lynx-js/`, or if a `lynx.config.*` file exists anywhere in the repository (excluding `node_modules`, `dist`, `.git` and `.claude/worktrees`). The failure message points at this ADR, says Lynx belongs in a consumer repo, and says that changing this requires a superseding ADR.

The gate deliberately does not scan documentation for the word "lynx": this ADR, `AGENTS.md` and the skills must be free to discuss it. It looks only at what would put Lynx into the system of record: a dependency, an import, a build config.

## Consequences

- **Positive:** the rule is explicit and readable by agents: persona apps prefer Lynx in consumer repos; every admin and every public web surface stays Astro. The word "app" can no longer be used to argue an admin into Lynx. The backend never becomes a Lynx host. Product teams get a clear path (Definition of Ready, PoC gate) instead of a debate per project.
- **Negative / trade-off:** the PoC gate delays any Lynx persona app until it is done, and Lynx for Web stays unusable until then. A product may need a second UI stack and a second team skill set. The structural gate will need a superseding ADR before an exception, which is friction by design.
- **Neutral:** no code, schema or contract changes here, so no migration, OpenAPI or AsyncAPI sync is involved. Consumer-specific work (its decision matrix, its PoC, its API requests) lives in the consumer repos, for example `ahliweb/awcms-one` #445, and is not tracked as a feature in this repo. ADR-0055 and ADR-0070 are refined, not changed: their bodies are untouched and still decide the repo split and admin ownership.
- **Reviewing this ADR:** it moves from Proposed to Accepted after maintainer review. The architecture and security reviews required by the issue are part of that review; the PoC result is a later, separate record that must exist before a Lynx app reaches production.

## Alternatives considered

- **Mandate Lynx for all new UI, admin included.** Rejected: it would discard a gated, accessible, server-rendered admin for no gain, lose crawlability on public pages, and promise cross-platform parity that Lynx's own compatibility pages do not promise.
- **Forbid Lynx outright.** Rejected: persona apps are a real need, and native capability is what a native client is for. The cost of the policy is the PoC gate, not a ban.
- **Put the Lynx app in `awcms-astro` or as a workspace in this repo.** Rejected: ADR-0055 keeps the family at two repos, ADR-0045 keeps `awcms-astro` an experience layer and BFF, and a Lynx workspace here would put a second stack, and likely Node tooling, into the system of record.
- **A word-detector gate that flags "lynx" in documentation.** Rejected: it would punish exactly the documentation this ADR asks for and would still miss a real dependency spelled differently. The structural gate in §7 looks at the dependency, the import and the build config instead.
- **Decide Lynx for Web now.** Rejected: its support, history and deep-link, offline and Web Push behaviour are unproven here, and a premature decision would be a promise of parity.

## References

- Issue #1133 (this ADR); consumer-side: `ahliweb/awcms-one` #445
- Lynx: <https://lynxjs.org/next/>, [compatibility](https://lynxjs.org/next/guide/compatibility.html), [build](https://lynxjs.org/next/guide/build/index.html), [integrate with existing apps (including Web)](https://lynxjs.org/next/guide/start/integrate-with-existing-apps)
- Astro: [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.md), [`docs/awcms/templates/definition-of-ready.md`](../awcms/templates/definition-of-ready.md), [`docs/awcms/15_frontend_architecture_integration.md`](../awcms/15_frontend_architecture_integration.md)
