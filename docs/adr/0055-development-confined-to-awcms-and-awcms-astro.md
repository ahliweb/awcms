🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0055-development-confined-to-awcms-and-awcms-astro.id.md)

# ADR-0055 — AWCMS development happens only in `ahliweb/awcms` and `ahliweb/awcms-astro`

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision maker:** @ahliweb
- **Supersedes:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) — which froze `awcms-mini`/`awcms-micro` as **references that may be ported out of**. This ADR closes that path too.
- **Refines:** [ADR-0001](0001-rebuild-on-awcms-foundation-erp-scope.md) (awcms built on top of the awcms-mini standard) and [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (the family compatibility manifest) — both pivot on `awcms-mini` as THE STANDARD; that pivot is revoked.
- **Related:** [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md), [ADR-0051](0051-admin-screens-consolidated-in-awcms.md)

> **The `awcms-astro` row in the §Decision table is refined by
> [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
> (8 August 2026).** That repo carries **public pages as its primary function**
> and **the USER admin surface when the site declares it** — not just "public
> site and session proxy". Accordingly, "every admin screen (ADR-0051)" in the
> `awcms` row reads "every **SYSTEM** admin screen". Points 1–5 of
> §Decision below — including the ARCHIVE status of `awcms-mini`/`awcms-micro` —
> are **unchanged**, and their wording is deliberately not rewritten (Rule 2 of
> the ADR index).

## Context

ADR-0047 froze `awcms-mini` and `awcms-micro` as **references**: they accept no changes, but may still be read and **ported out of**. Four months in, that half-position has a real cost:

1. **Documents and gates still treat `awcms-mini` as THE STANDARD.** `awcms-family-compatibility.yaml` declares `standard: awcms-mini`, and nine `intentionalDivergences` entries must be **re-reviewed periodically** — each with a `reviewDate` that reddens CI once it passes. That means this repo is scheduled to keep justifying its differences against a repo nobody develops any more.
2. **The backlog pivots on a port that will never happen.** `docs/PROJECT_STATE.md` still lists "absorb the awcms-mini backbone" and "the SaaS control plane cluster (7 mini modules) is not yet admitted". That frames the work as **moving** code that already exists, when the actual decision is to **build** the capability here, with its own admission ADR.
3. **The correct rule is already being followed in practice.** `idn_admin_regions` (ADR-0046), machine credentials (ADR-0049), platform-scoped permissions (ADR-0053), and tenant provisioning (ADR-0054) were all **started directly here**. Not one came from mini. The written rule lags behind how work actually happens.

## Decision

**AWCMS development happens in two repositories, and only two:**

| Repo                                                            | Role                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | **System of record** — modular monolith, every authorization surface, the API, and every admin screen (ADR-0051) |
| [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | **Experience layer + BFF** (ADR-0045) — the public site and the session proxy; never a source of truth           |

The consequences, stated explicitly:

1. **`awcms-mini` and `awcms-micro` are ARCHIVES.** Not a standard, not a source to port from, not a family template. They may be read as a historical reference — the same way you read old commits — but no work is scheduled as "ported from" there. A desired capability is **built here**, with its own admission ADR, judged on today's needs rather than on what happens to already exist in another repo.
2. **There is no external family standard.** `awcms` defines its own contracts. `awcms-family-compatibility.yaml` **stays and stays gated** — the part with teeth (23 contract-version checks pitted against real source constants) is precisely the most useful part — but it now states the contract **between `awcms` and `awcms-astro`**, not conformance to a third-party repo.
3. **The `intentionalDivergences` list (nine entries) is emptied, its content moved into a historical note** in [`family-compatibility.md`](../awcms/family-compatibility.md). The reason is not that the decisions do not matter — quite the opposite, which is why they are kept as prose with ADR links whose existence `check:docs` verifies. What is revoked is the **obligation to re-review** differences against an archive: that is repeated work whose answer will never change.
4. **The "record it as a divergence on landing" obligation (ADR-0047 §4) is revoked**, replaced by what already applies: **a foundational feature must have an ADR**. The ADR is the record; the divergence was only a duplicate that had to be kept in sync.
5. **The other ADR-0047 §3 guardrails STAY** and are not loosened one bit: an extra security review for `auth`/`access`/`sync`, a full `bun run check` before the PR, OpenAPI/AsyncAPI in sync, RLS `FORCE`, ABAC default-deny, applied migrations immutable.

## Consequences

- **Positive:**
  - The written rule finally matches how work really happens. The last four features were started here; now that is the correct path, not an exception.
  - The backlog stops lying. "Port 7 SaaS modules from mini" becomes "decide what control plane is needed, then build it" — a different question, with a possibly different answer.
  - No more scheduled red CI to justify differences against an archive.
- **Negative / accepted trade-offs:**
  - **Mature code in `awcms-mini` is no longer automatically "free".** Modules like `document_infrastructure` or `integration_hub` must be reassessed and written, not copied. That is genuinely more expensive — and that is the price of no longer inheriting decisions made for another product.
  - Five ADRs in this repo (`0016`–`0019`, `0021`) are already `Accepted` for modules that never had code here and pivot on a port from mini. This ADR does **not** revoke them one by one — each needs its own decision — but records that their "port from mini" basis has collapsed.
- **Neutral:**
  - Zero changes to running code. This is a governance decision; the technical gates with teeth stay intact.

## Alternatives considered

- **Keep ADR-0047 as is (frozen but portable out of)** — rejected: that is the current position, and its cost is exactly §Context points 1–2. "May be ported" forces every document and gate to keep maintaining a relationship with a repo that does not move.
- **Delete the compatibility manifest entirely** — rejected: its 23 contract-version checks are pitted against REAL source constants and have caught drift several times. The problem is its pivot, not its mechanism.
- **Archive `awcms-mini`/`awcms-micro` on GitHub (read-only repos)** — not decided here; that is an operational action that may follow. This ADR governs where the work goes, not repo settings.
