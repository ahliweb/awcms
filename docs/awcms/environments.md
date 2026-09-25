🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](environments.id.md)

# awcms environments — one deployment, and the isolation contract if a second environment exists

> A **current-state** document. This repo has **one** deployed environment —
> the decision is
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md). `staging`
> is **no longer** a deployment profile: it was removed from the vocabulary, not
> merely left unused here. The remaining profiles: `development`, `production`,
> `offline-lan`. What did **not** get deleted with it is its isolation contract —
> it moved house, from a named tier to a rule for **any second environment**
> somebody stands up
> (§[Second-environment isolation contract](#kontrak-isolasi-environment-kedua)).
> For the deployment mechanics see [`deploy-coolify.md`](deploy-coolify.md) and
> [`deployment-profiles.md`](deployment-profiles.md).

## One environment

| Environment    | Domain                 | `APP_ENV`    | Notes                                                                           |
| -------------- | ---------------------- | ------------ | ------------------------------------------------------------------------------- |
| **Production** | `awcms.ahlikoding.com` | `production` | The only live deployment of this repo. Real data, outbound integrations **ON**. |

Development is not a second row missing from that table. It is
`http://localhost:4321` with `APP_ENV=development`, lives on a workstation, and
is never deployed to any host (§Local development). What this document lost is a
**second deployed environment**, not the working phase.

The reason is short and lives entirely in ADR-0083: a pre-production environment
exists to **rehearse changes against real data and real traffic before touching
them**, and this repo's deployment has neither — it exists to demonstrate and
validate the template, not to serve a business. What would be "staged" is the
template itself, and the template is validated by the gate chain plus the
Postgres-backed integration suite in CI, not by a second running copy. So a
second environment here is not a safety net but one more set of secrets, one
more database needing backups, one more migration queue, one more domain, and
one more place that can go silently stale.

What disappeared with it is recorded as a **cost**, not hidden: there is no
longer a pre-production rehearsal for `sql/NNN`. The replacement is a backup that
has been **verified restorable** before each migration is applied
(`deploy/backup/restore-postgres.sh`, verify-only mode) — a mitigation, not an
equivalent replacement.

The deployment runs on the same Docker host as other applications
(`192.42.84.46`), managed by Coolify, behind Traefik which holds `:80`/`:443` and
issues TLS via the `letsencrypt` resolver.

> **A rule that still holds for anyone running more than one environment: one
> Coolify app per environment** — not one app with two domains. Environments
> sharing an app share env vars, and that is exactly how a second environment
> accidentally writes to production data. §The state corrected below is a lighter
> version of the same failure (one app, two hosts in a single Traefik rule), and
> it was already expensive enough.

## The state ADR-0083 corrected (11 August 2026)

This section is written because it misled for hours, and will mislead the next
person in exactly the same way if it is not written down. Verified on the host,
11 August 2026:

- The production application row (`got4etcblum9kowdv4mrixqo`) **does not exist**
  in Coolify's `applications` table. Not a soft-delete — the row simply is not
  there.
- **There is no production database** in `standalone_postgresqls`. The only one
  that exists is `awcms_staging`.
- The `awcms-staging-varnish` container installs a Traefik rule matching **both**
  hosts: ``Host(`awcms-staging.ahlikoding.com`) ||
Host(`awcms.ahlikoding.com`)``. The production domain is therefore served by the
  **staging deployment, on top of the staging database**, with `APP_ENV=staging`.

From that, one sentence worth memorising: **a 200 response at
`awcms.ahlikoding.com` is not proof that production is alive.** Throughout the
state above that domain answered 200, healthy, without complaint. Verify against
`applications`/`standalone_postgresqls` — not against `curl`.

The consequence for reading this document today: **every direct measurement
against `awcms.ahlikoding.com` measures that `awcms-staging-*` deployment.**
Sections marked "production" below describe the shape being re-established, along
with evidence from when it last genuinely ran — not observations from today. That
two-host Traefik rule must be revoked when production is re-established; until
that happens, `APP_ENV` on this host stops signalling anything, and the next
person who reads it to decide something dangerous will get a confidently wrong
answer.

> **The three bullets above are observations dated 11 August 2026, and are kept
> as-is.** The names `awcms_staging`/`awcms-staging-varnish` there are the names
> of resources that genuinely existed on the host at that moment — not evidence
> that a "staging profile" exists. After that observation the repo owner decided
> `staging` is **removed entirely**, including from the deployment profile
> vocabulary; the app, database, and Varnish carrying that name are being
> dismantled as separate infrastructure work. All that remains of them in this
> document is their names inside a dated note.

## Second-environment isolation contract

This section does **not** describe a deployment profile. `staging` no longer
exists — not "exists but is unused here", but removed from the profile
vocabulary; what remains is `development`, `production`, and `offline-lan`. What
used to be written as "the staging contract" still holds, only its target
changed: it is now the rule for **any second environment** somebody stands up
next to their production — call it pre-production, mirror, sandbox, or whatever
name. The failure shape is identical, and it does not care what the tier is
called.

This contract is expensive to re-derive — part of it was paid for with real
mistakes in the `awcms-micro` second environment — so it was not deleted along
with the tier that used to carry it.

A second environment usually runs on the same host as production. What separates
them is **configuration only**, so that configuration must be emphatic:

- **Its own database**, its own `awcms_app` role, its own password. Not another
  schema in the production cluster.
- **Its own secrets** — `AUTH_IP_HASH_SECRET`, `COMMENTS_TIMING_SECRET`, the edge
  cache purge token, encryption keys. Copying production secrets to a second
  environment means the value used by the second environment is also valid in
  production.
- **Outbound integrations OFF**: `R2_ENABLED=false`, `EMAIL_ENABLED=false`, sync
  disabled. A second environment must not be able to write to the production
  media bucket or send email to real people's addresses.
- `NEWS_PORTAL_PROFILE` **removed** (not set to some other value) when that
  environment has no R2 — the only accepted value is `full_online_r2`, so
  `config:validate` will refuse before deploy. This is a real mistake that was
  caught in micro.
- **DNS provider `manual`**, not `cloudflare` — see §Tenant subdomains.
- **A different edge cache purge token per environment** — see §Edge cache.
- The owner account may use the same identifier; **its password is never the
  same** — see §Default tenant.

That second environment's `APP_ENV` is still one of the existing values — in
practice `production`, because the production rules (`Secure` cookies, trusted
proxies, refusing the SSRF escape hatch) are precisely the ones you want to
rehearse. There is no `APP_ENV` value that marks "this is not the real one": what
separates them is the database, the secrets, and the outbound integrations in the
list above, not a label.

Run `bun run config:validate` and `bun run security:readiness` **before** each
environment's first deploy.

## Default tenant & owner account

| Item                      | Development                | Production                 |
| ------------------------- | -------------------------- | -------------------------- |
| `tenant_code`             | `development`              | `ahliweb`                  |
| `PUBLIC_DEFAULT_TENANT_*` | pinned to the local tenant | pinned to tenant `ahliweb` |
| Owner login               | `admin@ahlikoding.com`     | `admin@ahlikoding.com`     |
| Owner password            | **its own**                | **its own**                |
| Role                      | `owner` (system, 197/197)  | `owner` (system, 197/197)  |

An installation running a second environment uses the same convention with its
own `tenant_code`; what follows applies to every pair of environments, not just
the two columns above.

**The identifier is the same, the password is NEVER the same.**
`awcms_identities` is unique on `(tenant_id, login_identifier)`, so one address in
two environments is **two separate accounts** with two different password hashes.
Sessions do not cross either: a session token is an opaque random value stored as
a sha256 hash in `awcms_sessions` — a tenant-scoped table — so a token is only
valid on the database that issued it. Copying passwords between environments
cancels the very isolation that was the reason to separate them, and it is the
only thing that can cancel it, because nothing else is shared.

> **Correction note.** A previous version of this paragraph mentioned "three
> different `AUTH_JWT_SECRET`s". **That variable does not exist in awcms** — it is
> read nowhere in `src/`, and there is no JWT in the session path. The claim was
> wrong and misleading: an operator could believe that rotating that variable
> separates sessions across environments, when what separates them is the
> tenant-scoping above.

### Why `PUBLIC_DEFAULT_TENANT_*` is pinned, even though it works without it

The resolution chain is `host` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE`
→ `awcms_setup_state.tenant_id`. Without those two vars, the answer to "which
tenant does a non-matching host fall back to?" still exists — but hidden in a
table row, not stated. And once a second tenant is added, that implicit answer can
change without a single configuration change. The consumers are real:
`seo_distribution` (`/robots.txt`, sitemap, feed) and `site_search`.

`PUBLIC_TENANT_RESOLUTION_MODE` is **not** set anywhere. Turning on `host_default`
demands that an `awcms_tenant_domains` row for that host exists **in the database
that actually serves it** — and that is verified against the production database
after it is re-established, not inherited from an old note (§The state corrected:
the production database that used to hold that row no longer exists). Regardless,
turning it on is a behavioural decision in its own right — it activates host
lookup and widens the surface touched — not part of "set the default tenant". Turn
it on separately if that is what you actually want.

### Trap: the permission seed does not reach existing tenants

Permission seed migrations only apply to tenants created **after** them. Landing a
new module does **not** grant its permissions to an existing owner — the symptom
is a 403 `ACCESS_DENIED` on a module that is "already installed". Happened for
real in production on 2026-07-26: the owner was missing 18 permissions
(`comments`, `site_search`, `form_drafts`) after migrations 062–070. The backfill
is a deployment step:

```bash
bun run identity-access:permissions:backfill              # DRY-RUN, safe in production
bun run identity-access:permissions:backfill --commit     # writes
bun run identity-access:permissions:backfill --tenant <code> --commit   # incremental
```

**Do not use a "grant everything that is missing" SQL statement.** A previous
version of this document recommended `LEFT JOIN … WHERE rp.permission_id IS NULL`,
and that shape cannot tell "never existed when the tenant was created" apart from
"deliberately revoked by an admin" — it resurrects exactly the grant somebody
decided to remove, without a trace. The command above only grants permissions
whose catalogue row is **newer** than its owner role, reports the rest as
"presumed removed on purpose", and writes one audit entry per tenant.

Verify that "full access" really is full — full RBAC is not enough if there is an
ABAC deny, an SoD rule, or a business-scope restriction:

```sql
SELECT count(*) FROM awcms_abac_policies WHERE is_active AND is_dsl_managed;
SELECT count(*) FROM awcms_business_scope_assignments;
```

Both were `0` on every database measured on 2026-07-26, and no base route sets
`requiredScopeType`, so RBAC really is the sole decider. Repeat the queries on the
new production database — the old numbers are a measurement, not a guarantee.

## Local development brought in line with production (2026-07-26)

Before this, dev was not a small version of production but a **silently different
environment**: the schema stopped at migration 30 (production 70), zero tenants,
no `.env`, and the only role with LOGIN was the container's `awcms` — a
**superuser**. The most expensive class of bugs — RLS leaks and permission-caused
403s — was precisely the one that was impossible to reproduce there, because a
superuser walks through RLS and an empty tenant has no permissions to get wrong.

Since being brought in line, the two match row for row. The numbers below are a
**2026-07-26 snapshot**, not constants: the repo tree now holds 108 migrations, so
parity is re-measured every time, not quoted from here.

|                      | Development     | Production      |
| -------------------- | --------------- | --------------- |
| migrations           | 70              | 70              |
| tables               | 118             | 118             |
| `awcms_permissions`  | 197             | 197             |
| RLS `ENABLE`+`FORCE` | 109/118         | 109/118         |
| runtime role         | `awcms_app`     | `awcms_app`     |
| owner                | `owner` 197/197 | `owner` 197/197 |

What stays **deliberately** different, and why:

| Var                     | Dev     | Prod   | Why                                                                                                                           |
| ----------------------- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_COOKIE_SECURE`    | `false` | `true` | dev runs on `http://`; a `Secure` cookie would never be sent                                                                  |
| `TRUSTED_PROXY_ENABLED` | `false` | `true` | there is no proxy in front of `bun dev`; if `true`, anyone could forge `X-Forwarded-For` and pick their own rate-limit bucket |
| `EDGE_CACHE_MODE`       | `off`   | `auto` | there is no local Varnish; `auto` would only queue purges that are never consumed                                             |

`TRUSTED_PROXY_HOP_COUNT` (default `1`) only applies when
`TRUSTED_PROXY_ENABLED=true`, and `config:validate` rejects the opposite
combination — setting it on its own is an operator who believes they configured
something. The number counts `X-Forwarded-For` entries **from the right**: entries
to the left of your trusted hop were written by something you do not control, so
they are never read (#438). Raise it only by as many proxies as you genuinely own
— a number that is too large actually widens the forgeable part of the header.

### Role separation locally — not a formality

`sql/019`/`022` create `awcms_app`/`awcms_worker`/`awcms_setup` as `NOLOGIN`
without passwords. Green migrations do **not** mean role separation is active;
until all three are given `LOGIN PASSWORD` and `DATABASE_URL` points at
`awcms_app`, the runtime is still a superuser and `FORCE RLS` is inert. One-off:

```sql
ALTER ROLE awcms_app    LOGIN PASSWORD '<random>';
ALTER ROLE awcms_worker LOGIN PASSWORD '<random>';
ALTER ROLE awcms_setup  LOGIN PASSWORD '<random>';
```

Migrations are still run as the DDL-owning role (`awcms`), **not** `awcms_setup` —
that role only holds `USAGE` on schema `public`, not `CREATE`. This is the same as
production.

Prove the result, do not assume it — as `awcms_app`:

```
super=false bypassrls=false
no tenant context      -> awcms_identities visible: 0
own tenant             -> awcms_identities visible: 1
foreign tenant (uuid)  -> awcms_identities visible: 0
```

The same `0 / 1 / 0` pattern is the accepted shape of proof in **any**
deployment, not just locally. If the first line is not `0`, RLS is not on and
everything after it means nothing.

### `DATABASE_URL` is used by two roles that contradict each other

As soon as `.env` exists, **the DB-gated suites turn on too** — Bun loads `.env`
itself, so there is no empty `DATABASE_URL` like the `quality` job in CI. And
that is where two needs collide on one and the same variable:

- the **runtime** wants `awcms_app` — least privilege, RLS applies;
- the **integration harness** wants a **privileged** role — it creates ephemeral
  databases and runs `ALTER ROLE`. With `awcms_app` the result is
  `permission denied to alter role` (42501), not a skip.

CI solves it by running the two in different jobs. Locally, let `.env` hold the
runtime configuration (`awcms_app`) and **override when running tests**; an
explicit env var beats `.env`:

```bash
OWNER='postgres://awcms:<pw>@localhost:5433/awcms'
DATABASE_URL="$OWNER" SETUP_DATABASE_URL="$OWNER" WORKER_DATABASE_URL="$OWNER" \
  bun test tests/integration/
```

**Override all three, not just `DATABASE_URL`.** If `SETUP_DATABASE_URL` is left
to be taken from `.env`, the harness checks that the app client and the setup
client point at the same database, fails, and reports `Connection closed` — a
message that does not point at its cause at all.

Those two suites must **not** share a single `bun test` process (data collision —
see the comment in `ci.yml`). Run them separately, exactly like CI. Result in dev
on 2026-07-26: harness 142 pass, legacy 64 pass, zero failures.

### Trap: `bun run db:migrate` from the host can time out

In some sandboxes, TCP to the published Postgres port **connects** but the startup
message is never answered — the symptom is `Connection timeout after 30s (sent
startup message...)`, not connection refused, so it is easy to misread as wrong
credentials. The shortcut: run inside the DB container's network namespace.

```bash
docker run --rm --network container:<pg-container> \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL='postgres://awcms:<pw>@127.0.0.1:5432/awcms' \
  -e APP_ENV=development -e APP_URL=http://localhost:4321 \
  oven/bun:1 bun scripts/db-migrate.ts
```

Note `127.0.0.1:5432` — inside that namespace, the port published to the host is
irrelevant. The `oven/bun` image **has neither `curl` nor `git`**: use `fetch` for
HTTP, and do not run tests that call `git` in there.

## `APP_URL` is not cosmetic

`APP_URL` is **mandatory** (`scripts/validate-env.ts`) and not just a label: it
composes the OIDC/SSO callback URL (`src/lib/auth/sso-config.ts`). The wrong host
means the login flow is broken with `redirect_uri_mismatch`, not merely an ugly
link.

```bash
APP_ENV=production
APP_URL=https://awcms.ahlikoding.com
```

A derived installation running a second environment registers **one redirect URI
per environment** at the IdP, and registers it **before** login in that
environment is used — not after the flow has already failed.

## DNS

The `ahlikoding.com` zone lives at Cloudflare (NS `dilbert`/`katja`).
`awcms.ahlikoding.com` points at `192.42.84.46`. The
`awcms-staging.ahlikoding.com` record still exists and points at the same host — a
leftover of the old topology, and on 11 August 2026 it was that very hostname
whose deployment served both domains (§The state corrected). That record is being
dismantled together with the identically named resources; it does not signal a
profile.

Once the record exists, TLS is issued automatically via Traefik — no other
configuration. Since 2026-07-25 the `letsencrypt` resolver in Traefik uses the
**DNS-01 challenge via Cloudflare** (no longer HTTP-01), so the record's proxy
status (DNS-only vs proxied/orange cloud) **does not affect** certificate
issuance/renewal — both work exactly the same. The details of the change and its
reasoning are in `docs/12-cloudflare-proxy-dns01.md` in the `serv-dinkesdocker`
repo.

### Tenant subdomains (assumption — confirm before use)

`bun run tenant-domain:dns:sync` (ADR-0042 / PR #236) turns `awcms_tenant_domains`
rows into real DNS records, but it needs a **root domain** the repo owner has not
yet decided on. The most coherent one with the domains above:

```bash
TENANT_DOMAIN_DNS_PROVIDER=cloudflare
TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN=awcms.ahlikoding.com
TENANT_DOMAIN_SERVING_TARGET=awcms.ahlikoding.com
TENANT_DOMAIN_SERVING_RECORD_TYPE=CNAME
```

→ tenant subdomains of the form `<tenant>.awcms.ahlikoding.com`.

This is an **explicitly written assumption**, not a decision that has been taken.
The alternative is the root `ahlikoding.com` (giving `<tenant>.ahlikoding.com`),
which is shorter but puts the tenant namespace in a zone shared with other
applications on that host. The adapter **refuses** hostnames outside the
configured root, so choosing the wrong root is not a security hole — only a
painful hostname migration later. Decide before the first tenant.

A rule for anyone running a second environment: that environment should **not**
use the `cloudflare` provider (leave it `manual`). Two environments writing into
the same zone will overwrite each other's serving records for the same hostname —
a failure that makes no noise until the production record points somewhere wrong.

## Edge cache (ADR-0042) — `auto` mode in production

Production uses **`EDGE_CACHE_MODE=auto`**, not `on`: this is the "activated
automatically when needed" behaviour that was asked for from the start. When the
origin is relaxed, nothing is cached and visitors always get fresh data; when load
rises, TTL creeps up and the database stops being asked the same public question
over and over.

Thresholds: **≥5 requests/second** counted over a 60-second window (so ≥300
observations in the window) **OR** an average origin latency ≥250 ms. Either one
is enough. Once engaged, the latch holds for 3× the window.

Topology:

```
Cloudflare (proxied) -> Traefik :443 -> varnish:80 -> app :4321
```

That Varnish layer proved expensive to skip: turning it on first in a
pre-production environment (July 2026) uncovered three bugs that had passed review
and `bun run check`, one of which killed the blog write path. See
[`edge-cache-architecture.md`](edge-cache-architecture.md) §Lessons. This repo no
longer has such an environment — what replaces it is the CI gates and verified
backups (§One environment); anyone running a second environment should still prove
this layer there first.

### Response compression is INHERITED from this topology, not owned by the repo

<!-- kompresi-tepi:mulai -->

**The compressing tier is Cloudflare** — the leftmost layer in the topology above,
and the only one that compresses anything. This repo does not compress at any
layer it ships: zero compression middleware in the application
(`src/middleware.ts`, `astro.config.mjs`), zero `beresp.do_gzip` in
`infra/varnish/default.vcl` (Varnish does not compress on its own initiative),
zero Traefik `compress` middleware declared by the repo. All that emanates from
here is `Vary: Accept-Encoding` on cacheable responses — a promise about caching,
not an act of compressing.

Proven by a probe on 4 August 2026: **both** `ahlikoding.com` hostnames answering
at that time sent `content-encoding: gzip`, because both are Cloudflare-proxied.
So the claim "there is no compression anywhere" is wrong for what a reader
receives, and right for what this repo owns.

**A consequence that must be read before go-live:** a deployment of this base that
is NOT behind a compressing CDN serves all HTML, JSON, `sitemap.xml`, and
`feed.xml` uncompressed — the `dist/client` text assets alone shrink 2.79× under
gzip, and HTML/JSON shrink better still. Verify `content-encoding` at the actual
environment's edge, not at Varnish.

This block is read by `bun run security:readiness` (the
`checkResponseCompressionOwnership` checker in `scripts/security-readiness.ts`,
gap C3 in [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md)
§9): deleting it turns that checker red, and turning on compression in a layer
this repo ships makes that checker demand this block be rewritten.

<!-- kompresi-tepi:selesai -->

### Varnish is not a Coolify resource

It is an ordinary compose container on the `coolify` network, holding its own
Traefik labels; the app's FQDN is either emptied or beaten on priority (see below)
so that Traefik does not route two routers to the same host. `default.vcl` is
copied verbatim from `infra/varnish/default.vcl` (checksums matched) so that the
file under review is the file that runs. The `app` backend is supplied via
`extra_hosts` — not compose DNS — because the app is a Coolify application, not a
compose service.

Application env:

```bash
EDGE_CACHE_MODE=auto        # `on` only to prove the layer works;
                            # `auto` caches when the origin is under pressure
EDGE_CACHE_PURGE_ENDPOINT=http://<varnish-container>:80
EDGE_CACHE_PURGE_TOKEN=<secret per environment>
EDGE_CACHE_MAX_TTL_SECONDS=300
```

The purge token is **different per environment**. The purge worker runs every
minute from the host's cron as a one-shot container — `Dockerfile.production` does
not ship `scripts/`, so it cannot be run via `docker exec` on the app container
(the same problem and the same pattern as the migrations below):

```
* * * * * /home/admin1/awcms-prod-varnish/purge-runner.sh
```

> **As of 11 August 2026 the Varnish container sitting in front of
> `awcms.ahlikoding.com` is `awcms-staging-varnish`**, not production's — see
> §The state corrected. That container is among those being dismantled; the cron
> and purge endpoint above are the shape being re-established along with
> production.

### Routing: Traefik priority, NOT emptying the FQDN

Emptying the app's FQDN moves the domain, but that means a **redeploy**, and
during the redeploy the Varnish backend disappears. Production therefore gives the
Varnish router `priority=100` (Traefik's default = rule length):

```
traefik.http.routers.awcms-prod-varnish-https.priority=100
```

The app router still exists with an identical `Host(...)` rule. The priority makes
the cache **deterministic** — without it the two routers tie and Traefik's choice
is arbitrary, so some traffic silently bypasses the cache — while also leaving the
app router as a **fallback**. That proved useful: while the Varnish container was
being recreated, public requests were still served by the app directly, zero
downtime.

### Acceptance test — `X-Cache`, not the exit code

Every bug in this layer reports success while not working. Only this is valid:

| step                              | must be           |
| --------------------------------- | ----------------- |
| two GETs of `/blog/<tenant>`      | `X-Cache: HIT`    |
| GET `/api/v1/health` twice        | still `MISS`      |
| **near-miss** purge key `t:<id>x` | still `HIT`       |
| **exact** purge key `t:<id>`      | `MISS`            |
| the next request                  | `HIT` again       |
| queue row                         | `done attempts=1` |

> **Warning — the table above measures Varnish, and Varnish is NOT the tier that
> answers readers.** The `ahlikoding.com` hosts are Cloudflare-proxied, so the tier
> answering readers is **Cloudflare** — proven by a probe on 4 August 2026
> (`cf-cache-status: HIT` plus an `age:` header). Read `cf-cache-status`/`age`
> too, not only `X-Cache`; and a post-purge `MISS` at Varnish **does not prove
> readers see fresh content**, because the ADR-0042 purge queue BANs Varnish and
> **does not reach Cloudflare** — gap C14 in
> [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9. The
> staleness readers see is bounded by `s-maxage` ≤
> `EDGE_CACHE_MAX_TTL_SECONDS` (300 seconds in this configuration).

Evidence of `auto` mode from production on 2026-07-26 — measured, not assumed:

| step                       | result                                         |
| -------------------------- | ---------------------------------------------- |
| while idle                 | `x-edge-cache-skip: auto_not_engaged`, no TTL  |
| 120 requests (2 req/s)     | still `auto_not_engaged` — below the threshold |
| 400 requests (>5 req/s)    | `surrogate-control: max-age=5` — ramp engaged  |
| through Varnish            | `X-Cache: HIT`                                 |
| purge via the queue+worker | `sent=1 failed=0` → `MISS` → a `done` row      |

That `max-age=5` is `MIN_ACTIVATED_TTL_SECONDS`: the pressure ratio had only just
touched 1, so the TTL is the shortest one and will rise if load continues.

## Database operations on the host

### Running migrations: a one-shot container, not `docker exec`

`Dockerfile.production` produces a **runtime-only** image: `scripts/` is not
included, so `docker exec <app> bun run db:migrate` fails with
`Module not found "scripts/db-migrate.ts"`. This is not a misconfiguration; that
is the shape of the image, and it does not need changing.

Run migrations as a **one-shot container** from a repo checkout, sharing the DB
container's network so the DSN is `127.0.0.1`.

The checkout **must be the release tag being deployed**, **not `main`**. `main`
may already contain `sql/NNN` that is not in the image about to run; applying it
means the schema runs ahead of the application — and an applied migration is
immutable, so there is no way back other than restoring a backup. The same tag as
the image = exactly the schema that image needs.

**The git tag and the image tag are not identical.** `release.yml` computes the
image tag by stripping the leading `v` (`VERSION="${GITHUB_REF_NAME#v}"`), so the
image `ghcr.io/ahliweb/awcms:7.0.1` comes from the git tag `v7.0.1`. Matching them
the wrong way round gives `manifest unknown` (if you are lucky) or a checkout of
the wrong version (if you are not).

```bash
git clone --depth 1 --branch v7.0.1 https://github.com/ahliweb/awcms.git /tmp/awcms-migrate
docker run --rm --network container:<db-container> \
  -v /tmp/awcms-migrate:/app -w /app \
  -e DATABASE_URL="postgres://<owner>:<pw>@127.0.0.1:5432/<db>" \
  oven/bun:1.3.14-alpine \
  sh -c "bun install --frozen-lockfile --production && bun run db:migrate"
```

The DB container's name/ID changes every time Coolify redeploys — take it from
`docker ps`, not from an old note. Migrations use the **owner** user (the
superuser Coolify created) because it does `CREATE ROLE`/`GRANT`. The app runtime
**must not** use that user — see below.

### Trap: the user Coolify creates is a superuser

This bit on 2026-07-25 and is worth remembering because the failure is completely
invisible.

Coolify (and `postgres:*` images generally) creates `POSTGRES_USER` as a
**superuser**. The most natural shape after automatic provisioning is a runtime
`DATABASE_URL` pointing at that user — and **a superuser bypasses RLS
unconditionally, even with `FORCE`**. The deployment looks healthy: green
migrations, health 200, every endpoint working. Tenant isolation is entirely
absent.

`sql/019` and `sql/022` create `awcms_app`/`awcms_worker`/`awcms_setup` as
**`NOLOGIN` and without a password** — deliberately, because a password is a
secret and secrets must not go into a migration file. So the migrations finish
cleanly but not one of those roles is usable yet. The activation step is explicit,
per deployment:

```sql
ALTER ROLE awcms_app    LOGIN PASSWORD '<app secret>';
ALTER ROLE awcms_worker LOGIN PASSWORD '<worker secret>';
ALTER ROLE awcms_setup  LOGIN PASSWORD '<setup secret>';
GRANT CONNECT ON DATABASE <db> TO awcms_app, awcms_worker, awcms_setup;
```

Then point the runtime env vars:

```bash
DATABASE_URL=postgres://awcms_app:<app secret>@<host>:5432/<db>
WORKER_DATABASE_URL=postgres://awcms_worker:<worker secret>@<host>:5432/<db>
SETUP_DATABASE_URL=postgres://awcms_setup:<setup secret>@<host>:5432/<db>
```

All three are mandatory, not two: without `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL`
every job falls back to `DATABASE_URL` = `awcms_app`, and the least-privilege
separation just created becomes decoration. The edge cache purge worker, for
example, runs as `awcms_worker` — only `SELECT`/`UPDATE`/`DELETE` on the queue.

Verify with a query, not an assumption — all three must be `f`/`f`:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname LIKE 'awcms%';
```

`ADMIN_DATABASE_URL` is **read by no code at all** — do not set it; it only
misleads the next reader of the env.

### Prove the isolation, do not assume it

Correct configuration is not necessarily working isolation. The queries below are
run **as `awcms_app`** once the first tenant exists, and that is the accepted shape
of proof — before repointing, the same queries ran as a superuser and **passed
without proving anything**:

```sql
                                                    -- accepted result
SELECT count(*) FROM awcms_offices;                 -- 0  (fail-closed)
SELECT set_config('app.current_tenant_id','<real tenant>',false);
SELECT count(*) FROM awcms_offices;                 -- 1
SELECT set_config('app.current_tenant_id','<foreign uuid>',false);
SELECT count(*) FROM awcms_offices;                 -- 0
```

Without a tenant context the result is **0**, not "all rows" — that is the
difference between a policy that filters and a policy that is inert.

## Actual status (11 August 2026)

| Item                           | Status                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Production Coolify app         | ❌ the row `got4etcblum9kowdv4mrixqo` **does not exist** in `applications` — not a soft-delete                               |
| Production database            | ❌ not in `standalone_postgresqls`; the only one that exists is `awcms_staging` (being dismantled)                           |
| `https://awcms.ahlikoding.com` | ⚠️ answers **200** — but is served by `awcms-staging-varnish` (two-host Traefik rule) on top of the `awcms_staging` database |
| Local development              | ✅ dev↔prod parity enforced since 2026-07-26 (§Local development); the numbers are re-measured, not quoted                   |
| Root page `/`                  | ✅ an informational landing page (ADR-0083); the catch-all `[...path].ts` still returns a clean 404 for unknown paths        |

The measurements that follow come from a two-environment topology that **no longer
exists** and are kept as historical evidence, not as status: `auto` mode was
proven in production on 2026-07-26 (§Acceptance test), the least-privilege roles
`rolsuper=f`/`rolbypassrls=f` were proven on 2026-07-25 (§Superuser trap), and RLS
isolation `0/1/0` was proven under `awcms_app` on the same date.

## What is still open

- **Re-establish the production app + database**, then **dismantle the app,
  database, and Varnish named `awcms-staging-*`** along with the two-host Traefik
  rule they install (infrastructure work, outside this repo). Until both are done,
  `awcms.ahlikoding.com` serves the `awcms_staging` database — not production
  data.
- Once the new production database is standing: run `bun run config:validate` +
  `bun run security:readiness`, prove `0/1/0` as `awcms_app`, and run
  `bun run identity-access:permissions:backfill` (dry-run first) — a new tenant
  inherits nothing from the database that is gone.
- Because there is no pre-production rehearsal any more, **a backup that has been
  verified restorable** (`deploy/backup/restore-postgres.sh`, verify-only mode) is
  a precondition of every migration, not a good habit.
- `awcms-micro-staging` has already been **deleted** (app + DB) on 2026-07-25; its
  DNS never existed in the first place.
