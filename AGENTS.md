# AGENTS.md — Panduan Agent & Kontributor AWCMS

## Ringkasan proyek

AWCMS adalah **basis/fondasi modular monolith reusable** milik AhliWeb — **bukan sebuah ERP**. Repo ini dibangun ulang (lihat [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md), diamandemen poin 3-nya oleh [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)) di atas basis teknologi **awcms-mini** — _modular monolith standard_ Bun + Astro 7 + PostgreSQL/RLS. Modul domain ERP (keuangan, inventori, procurement, manufaktur, HR/payroll) dan integrasi dengan solusi bisnis eksternal (payment gateway, marketplace, Coretax, logistik) **tidak dibangun di `src/modules/` repo ini** — mereka hidup di repo ekstensi/turunan terpisah yang disusun lewat komposisi modul build-time ([ADR-0014](docs/adr/0014-deterministic-build-time-module-composition.md)) di atas kontrak netral kesiapan ERP yang base ini sediakan ([ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md), [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md)).

Baca dokumen ini sebelum mengerjakan task apa pun di repo ini. Ini adalah kontrak kerja teknis — aturan wajib, guardrail keamanan, dan alur task.

## Relasi dengan awcms-mini (wajib dibaca)

AWCMS adalah rebuild fondasi (bukan ERP) di atas basis teknis **awcms-mini** (repo standar). **Setiap penambahan/perubahan fitur diuji lebih dulu di awcms-mini, baru di-port ke repo ini** — repo ini bukan tempat merintis fitur dari nol. Alur port, langkah rename prefix `awcms_mini_…` → `awcms_…`, dan implikasinya untuk agent ada di [`docs/awcms/alur-pengembangan-mini-first.md`](docs/awcms/alur-pengembangan-mini-first.md).

## Alur kerja wajib setiap task

1. Mulai dari issue/ADR yang jelas scope-nya. Bila mengubah standar dasar, buat ADR dulu (lihat [`GOVERNANCE.md`](GOVERNANCE.md)).
2. **Buat branch baru dari `main` SEBELUM menyentuh kode.** Setiap implementasi issue GitHub wajib dikerjakan di branch tersendiri — **jangan pernah commit langsung ke `main`** (branch protection menolak push langsung; lihat [`docs/awcms/branch-protection.md`](docs/awcms/branch-protection.md)). Penamaan: `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<topik>`, atau `security/<issue>-<slug>` — mis. `git switch -c feature/178-module-composition`. Satu branch = satu issue/PR; jangan menumpuk beberapa issue tak-berkaitan di satu branch. Detail alur di [`CONTRIBUTING.md`](CONTRIBUTING.md) §Alur kontribusi.
3. Identifikasi dampak: schema (migration), API (OpenAPI), event (AsyncAPI), akses (RBAC/ABAC/RLS), mutation high-risk (idempotency), aksi sensitif (audit), data sensitif (masking).
4. Kerjakan atomic — satu PR = satu perubahan yang jelas dan terisolasi.
5. Tulis test yang gagal sebelum fix, lulus sesudahnya.
6. Perbarui dokumentasi (OpenAPI/AsyncAPI/docs/awcms) dan changeset bila perilaku berubah.
7. Validasi lokal **`bun run check` PENUH** sebelum membuka PR — bukan subset. `check` mencakup `lint` (prettier `--check`) dan `build`; melewati keduanya adalah penyebab tersering "hijau lokal, merah di CI" (`.github/workflows/ci.yml` menjalankan keduanya). Jalankan `bun run format` dulu bila perlu, lalu `bun run check`.
8. Buka Pull Request dengan `Closes #<issue>`; merge hanya setelah review + CI hijau, lalu bersihkan branch.

## Aturan wajib (non-negotiable)

- **Bun-only.** Tidak ada Node.js/npm/pnpm/yarn kecuali ada exception tertulis yang disetujui maintainer.
- **PostgreSQL + RLS wajib** untuk setiap tabel tenant-scoped di base ini, maupun entitas bisnis pada modul ekstensi ERP turunan (ledger, payroll, inventory, dst.).
- **RBAC + ABAC default-deny** pada semua endpoint non-public.
- **Idempotency** wajib pada mutation high-risk — di base ini: sync/integrasi eksternal, aksi admin sensitif (access assignment, dst.); pada modul ekstensi ERP turunan: posting transaksi finansial, payroll run, cancel/return, stock adjustment, warehouse transfer.
- **Audit trail dengan redaksi** untuk aksi high-risk — di base ini: login, access assignment, resolusi konflik sync; pada modul ekstensi ERP turunan: price/ledger change, transaksi posted/cancel/return, stock adjustment.
- **Soft delete** untuk resource yang deletable; **immutability** untuk data yang sudah posted/final (mis. jurnal yang sudah posted tidak diedit, hanya dikoreksi lewat entri baru — berlaku pada modul ekstensi ERP turunan yang punya konsep posting).
- **Kontrak API/event wajib**: OpenAPI untuk REST, AsyncAPI untuk domain event, disinkronkan setiap perubahan.
- **Masking data sensitif**: data finansial/personal (NPWP, NIK, gaji, rekening bank) tidak boleh tampil polos di log atau response tanpa alasan eksplisit.
- **Outbox/queue untuk integrasi eksternal** — payment gateway, marketplace, Coretax, logistik (biasanya diimplementasikan modul ekstensi ERP turunan di atas mekanisme outbox base ini) terhubung lewat outbox, bukan panggilan sinkron langsung dari jalur transaksi kritikal.

## Guardrail keamanan

- Tidak ada secret/kredensial/dump database/data bisnis-finansial asli dalam kode, commit, issue, atau dokumentasi.
- Modul sensitif (auth, access, sync, finance, hr-payroll) memerlukan review keamanan tambahan sebelum merge.
- Laporan kerentanan mengikuti [`SECURITY.md`](SECURITY.md) — tidak ada issue publik untuk kerentanan yang bisa dieksploitasi.

## Struktur repository (target)

```
src/
  modules/
    <module>/
      module.ts
      domain/
      application/
      infrastructure/
      api/
tests/
scripts/
sql/
openapi/
asyncapi/
docs/
  adr/
  awcms/
```

## Peta modul

Per [ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md) dan [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md), hanya modul **fondasi reusable** yang dibangun di `src/modules/` repo ini. Modul domain ERP dan integrasi bisnis vertikal **tidak pernah** hidup di base ini — lihat [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).

| Kategori                                                     | Modul                                                                                                                                                                                                                                  | Hidup di                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Fondasi (base ini, `src/modules/`)                           | Tenant Admin, Identity Access, Profile Identity, Logging, Module Management, Sync Storage, Workflow Approval, Reporting, Email, Domain Event Runtime — lihat [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) untuk daftar hidup terkini | Repo ini                       |
| ERP — Finance/Inventory/Procurement/Manufacturing/HR-Payroll | General ledger, AP/AR, tax/Coretax export, warehouse, stock adjustment, purchase order, BOM, payroll run, dst.                                                                                                                         | Repo ekstensi/turunan terpisah |
| Integrasi bisnis vertikal                                    | Payment gateway, marketplace, logistik, Coretax                                                                                                                                                                                        | Repo ekstensi/turunan terpisah |

Modul fondasi baru mengikuti urutan: tenant/identity/access dulu, lalu modul fondasi lain yang bergantung padanya. Modul ERP/integrasi disusun di repo turunan lewat komposisi modul build-time ([ADR-0014](docs/adr/0014-deterministic-build-time-module-composition.md)) di atas kontrak kesiapan ERP yang base ini sediakan.

## Konvensi commit

Format [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <ringkasan>`. Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md) untuk daftar type dan scope.

## Definition of Done

Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md#definition-of-done).

## Peta dokumen

- [`README.md`](README.md) — gambaran umum & arah rebuild.
- [`GOVERNANCE.md`](GOVERNANCE.md) — tata kelola & pengambilan keputusan.
- [`docs/adr/`](docs/adr/README.md) — keputusan arsitektural (fondasi & batas ekstensi ERP).
- [`docs/awcms/`](docs/awcms/README.md) — paket dokumen teknis detail per modul fondasi (PRD/SRS/ERD/OpenAPI/AsyncAPI) dan kontrak kesiapan ERP untuk repo ekstensi turunan.
- [`docs/awcms/alur-pengembangan-mini-first.md`](docs/awcms/alur-pengembangan-mini-first.md) — kontrak alur "uji di awcms-mini dulu, lalu port ke awcms" & langkah port.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — apa yang **sudah ada di kode** saat ini vs gap yang tersisa.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — proses kontribusi & Definition of Done.
- [`SECURITY.md`](SECURITY.md) — kebijakan keamanan & pelaporan kerentanan.

## Skill & subagent (Claude Code)

Repo ini dilengkapi playbook pengembangan berbasis agent, diadaptasi dari [awcms-mini](https://github.com/ahliweb/awcms-mini):

- [`.claude/skills/`](.claude/skills/README.md) — 48 skill tingkat-proyek yang meng-encode standar `docs/awcms/` (scaffold modul, migration, endpoint, ABAC guard, audit log, testing, security review, deploy, dst.). Dipanggil otomatis oleh model atau manual via `/<nama-skill>`.
- [`.claude/agents/`](.claude/skills/README.md#subagents-claudeagents) — subagent `awcms-coder` (implementasi issue end-to-end), `awcms-reviewer` (review PR read-only), `awcms-security-auditor` (audit keamanan read-only).
- [`docs/Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf`](docs/Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf) — panduan penggunaan keluarga agent AWCMS.

Skill/agent mendeskripsikan pola **target** standar dari repo acuan awcms-mini. Beberapa (mis. `awcms-auth-online-hardening`) mendeskripsikan epik spekulatif yang belum diajukan/dikerjakan — periksa frontmatter `description` tiap skill sebelum mengasumsikan sesuatu sudah ada. Untuk skill yang menargetkan modul ERP/integrasi bisnis vertikal, padankan ke repo ekstensi/turunan yang relevan (bukan `src/modules/` repo ini, per [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)); nomor issue `#NNN` di dalamnya merujuk epik repo acuan sebagai contoh, bukan tracker repo ini.

## Mulai dari sini

Skeleton Astro + Bun + migration runner dan sepuluh modul fondasi (`tenant-admin`, `identity-access`, `profile-identity`, `logging`, `module-management`, `sync-storage`, `workflow-approval`, `reporting`, `email`, `domain-event-runtime`) **sudah ada** (lihat [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) untuk state kode terkini dan gap yang tersisa). Untuk melanjutkan pengembangan fondasi: mulai dari `awcms-implement-issue`/`awcms-new-module`, lengkapi RBAC/ABAC + Module Management pada modul baru. Modul domain ERP dikerjakan di repo ekstensi/turunan terpisah, bukan di repo ini.
