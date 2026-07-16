# awcms

## 5.0.0

**Deliberate manual version jump — not a tool-computed SemVer increment.** Bumped directly from `0.2.0` to `5.0.0` per maintainer decision to continue this product's pre-rebuild release numbering (last legacy tag: `v4.6.0`) rather than resetting to `1.0.0`, so version comparisons never look like a downgrade across the rebuild. See [ADR-0024](docs/adr/0024-semver-numbering-continues-legacy-major-line.md) for the full rationale and an explicit compatibility note: despite continuing the number line, **`5.0.0` is not backward-compatible with any `v2.x`–`v4.x` legacy release** — the entire codebase was rewritten from scratch on a new foundation (Bun/Astro/PostgreSQL modular monolith, see [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)/[ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)). No git tag or GitHub Release accompanies this changelog entry yet — `.github/workflows/release.yml` (the SBOM/signing/provenance publish pipeline, see [`docs/awcms/release-process.md`](docs/awcms/release-process.md)) has not been implemented yet, so there is no real release for this version to attach to until that pipeline exists.

## 0.2.0

### Minor Changes

- f306b38: Tambah workflow GitHub Actions (CI, CodeQL, Changesets policy) yang mencerminkan `bun run check`, gate `check:docs` (mermaid/tautan/penamaan) beserta logika murninya, script `changesets:policy:check`, template issue/PR, dependabot, dan CODEOWNERS — diadaptasi dari awcms-mini dan dipangkas ke infrastruktur yang benar-benar ada di repo ini (belum ada job E2E/Postgres-integrasi/release image, didokumentasikan sebagai deferred di `docs/awcms/branch-protection.md` dan `scripts/README.md`).
- 5d1cf54: Tambah dukungan dokumentasi dwibahasa (ADR-0023): Bahasa Indonesia sebagai sumber otoritatif (`<nama>.id.md`), Inggris sebagai default yang tampil (`<nama>.md`). Diterapkan pada tiga dokumen pintu depan (`README.md` root, `docs/awcms/README.md`, `docs/adr/README.md`) plus `scripts/check-docs-translation.mjs` (gate staleness berbasis hash, masuk `bun run check` dan CI) yang mendeteksi saat sumber ID berubah tanpa terjemahan EN diregenerasi.

### Patch Changes

- ffdcd99: Bump `actions/upload-artifact` dari v4.6.2 ke v7.0.1 di workflow CI (dependency bump, tidak ada perubahan perilaku pipeline).
