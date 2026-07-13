# Tata Kelola / Governance

Dokumen ini menjelaskan bagaimana keputusan diambil dan bagaimana AWCMS dikelola.

## Ringkasan

AWCMS adalah **platform ERP dan integrasi solusi bisnis** milik AhliWeb, dibangun ulang di atas standar teknis modular monolith (Bun + Astro 7 + PostgreSQL/RLS). Dikelola sebagai proyek open-source (lisensi [MIT](LICENSE)). Tata kelola bersifat ringan namun eksplisit agar standar tetap konsisten sepanjang pertumbuhan modul ERP.

## Peran

| Peran                  | Tanggung jawab                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Maintainer**         | Menetapkan arah produk ERP, meninjau & merge PR, menjaga standar dokumen, merilis versi. Tercantum di [`.github/CODEOWNERS`](.github/CODEOWNERS) (bila ada). |
| **Kontributor**        | Siapa pun yang mengirim issue/PR sesuai [`CONTRIBUTING.md`](CONTRIBUTING.md).                                                          |
| **Security responder** | Maintainer yang menangani laporan kerentanan privat (lihat [`SECURITY.md`](SECURITY.md)).                                              |

## Pengambilan keputusan

1. **Perubahan kecil** (fix, docs, chore): satu approval maintainer + CI hijau.
2. **Perubahan standar** (arsitektur, modul ERP baru, aturan wajib, kontrak API/event, keputusan lintas-dokumen): wajib **Architecture Decision Record** di [`docs/adr/`](docs/adr/README.md) dan disetujui minimal dua maintainer bila tersedia.
3. **Perubahan keamanan/breaking**: memerlukan security review dan changeset dengan bump SemVer yang sesuai.
4. **Perubahan yang menyimpang dari standar dasar yang sudah ditetapkan**: harus dicatat sebagai ADR dengan alasan eksplisit kenapa modul/fitur tertentu perlu berbeda (mis. kebutuhan modul ERP tertentu), bukan sekadar preferensi.

Keputusan diusahakan lewat konsensus. Bila buntu, maintainer utama memutuskan dan mencatat alasannya di ADR atau issue terkait.

## Perubahan standar & dokumen

- Standar yang mengikat ada di `AGENTS.md` dan `docs/awcms/`. Perubahannya harus konsisten lintas dokumen (doc, skill `.claude/skills/`, dan kode terkait berubah bersama).
- Keputusan arsitektural dicatat sebagai ADR (lihat `docs/adr/`), tidak dihapus melainkan ditandai `Superseded` bila diganti.
- Standar dasar (runtime, RLS, ABAC, offline-first, kontrak API/event) tercatat sebagai ADR di `docs/adr/` (lihat [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md) untuk konteks penetapannya); penyesuaian untuk kebutuhan ERP wajib ADR lokal baru yang menyatakan penyimpangannya secara eksplisit.

## Rilis

Versioning memakai SemVer + [Changesets](.changeset/README.md).

## Code of Conduct

Semua partisipan tunduk pada [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
