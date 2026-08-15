🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0024-semver-numbering-continues-legacy-major-line.id.md)

# ADR-0024 — SemVer numbering continues the legacy major line (jump to 5.0.0), not a reset to 1.0.0

- **Status:** Accepted
- **Date:** 2026-07-16
- **Decision maker:** @ahliweb
- **Related:** ADR-0001 (rebuild), ADR-0022 (a foundation for ERP, not an ERP), `docs/awcms/release-process.md` §line 3 (which marked this decision as open before this ADR), `.changeset/config.json`, `CHANGELOG.md`

## Context

This repo's `package.json` started at `0.1.0` when the foundation was rewritten from scratch (ADR-0001). But this repo's GitHub Releases (`github.com/ahliweb/awcms/releases`) still hold the tag history of the **legacy** codebase (before `chore(foundation): remove legacy repository files`): `2.9.9`, `2.12.0`, `3.0.0`, `3.1.0`, `4.0.0`, `4.1.1`, `4.3.1`, `4.5.0`, up to `4.6.0` (all marked Pre-release, their content purely dependabot dependency bumps in the old multi-app structure — `awcms-public`, `awcms-mcp`, etc. — which no longer exists on today's `main`).

`docs/awcms/release-process.md` (written before this ADR) explicitly marked this as a decision not yet taken: _"the first `awcms` release (`v0.1.0` or `v1.0.0`, depending on the agreed initial version policy)"_ — that draft itself did not consider the third option (continuing the old `v4.x` numbers), because it was written before the realisation that the legacy tag `v4.6.0` still exists and is publicly visible on the Releases page.

The concrete problem: if the first release of this totally rewritten repo is numbered `0.1.0` or even `1.0.0`, anyone comparing it against the existing `v4.6.0` tag (still historically visible as the "latest" release) will misread the version order as a downgrade, when it is in fact a total rewrite that is further ahead.

## Decision

We decided:

1. **The package.json version number is jumped manually from `0.2.0` to `5.0.0`** — not computed by `bun run changeset:version` (the changesets tool can only increment from the current version by the changeset bump level; it cannot "jump to a specific version"). This continues the major line from the last legacy tag (`v4.6.0`) to the next major (`5.0.0`), consistent with the meaning of SemVer: a total rebuild is a breaking change that deserves a major bump, and `5.0.0` is the next major after `4.x`.

2. **`5.0.0` does NOT assert any compatibility with the legacy `v2.x`–`v4.x` releases.** This is not "AWCMS v4.6.0 plus new features" — the entire codebase was rewritten from scratch on a new foundation (Bun-only, Astro 7, PostgreSQL/RLS, modular monolith; ADR-0001) with a scope that also changed (a foundation for ERP, not the ERP itself; ADR-0022). Number continuity is purely about **product identity** (avoiding the impression of going backwards), not a claim of API/data/deployment compatibility.

3. **The jump is recorded manually in `CHANGELOG.md`** (not via a `changeset version` generated entry) as a `## 5.0.0` section that explains the jump explicitly, with a link to this ADR. Changesets already pending before the jump (CI fixes, bilingual docs, dependency bumps) are consumed normally first (`0.1.0` → `0.2.0`) before the manual jump is made — so that the record of real changes is not simply swallowed by the number jump.

4. **There is no git tag or GitHub Release for `5.0.0` yet.** `.github/workflows/release.yml` (dual SBOM pipeline, keyless signing, provenance, publish — designed in `docs/awcms/release-process.md`) has not been implemented. Creating a public tag/release now without that pipeline would mean skipping the quality gates this repo designed for itself (validate job, SBOM, signing, environment approval) — rejected. For now `5.0.0` is purely a number in `package.json`/`CHANGELOG.md`, not a public release anyone can pull.

5. **`docs/awcms/release-process.md` line 3 is updated** to reference this ADR as a decision already taken, replacing the phrase "depending on the agreed initial version policy".

## Consequences

- **Positive:** the public version history on GitHub Releases never appears to go backwards; the "AWCMS" product identity stays a single straight line even though the code was rewritten completely; a decision previously marked open in `release-process.md` is now answered and recorded.
- **Trade-off:** there is a "hole" in the version numbers (`0.2.0` → `5.0.0` directly, with no `1.x`–`4.x` ever actually released from the new codebase) that has to be explained to new changelog readers — already mitigated by the explicit note in the `## 5.0.0` section of `CHANGELOG.md` and by this ADR itself.
- **Neutral:** from `5.0.0` onward, every subsequent version bump returns to the normal `bun run changeset:version` flow (incrementing from `5.0.0` per the changeset bump level) — this manual jump is a one-off event, not a recurring pattern.

## Alternatives considered

- **Reset to `1.0.0`** — rejected (though it was considered for a while): consistent with the "rewritten from scratch" framing, but it risks being read as a downgrade from the already-public `v4.6.0` by anyone comparing numbers without the full rebuild history.
- **Stay at `0.1.0`/`0.2.0` (SemVer 0.x, "not yet stable")** — rejected for now: it is the most honest about implementation status (only the Sprint 1–2 foundation, no ERP module yet), but it does not answer the concrete impression-of-going-backwards problem against `v4.6.0` that drove this decision. Note: this decision does NOT claim the foundation is "stable" at `5.0.0` — module maturity is still judged by an independent mechanism (`status: experimental|active` per module, ADR-0008), not by the package major number.
- **Create the `v5.0.0` tag/GitHub Release right now** — rejected: `release.yml` does not exist yet; publishing without the SBOM/signing/provenance/approval gate this repo itself designed (`docs/awcms/release-process.md`) violates the very process that was just reaffirmed as mandatory.
