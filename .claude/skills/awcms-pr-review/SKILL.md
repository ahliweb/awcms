---
name: awcms-pr-review
description: Review pull request AWCMS terhadap Definition of Done dan kontrak proyek. Gunakan saat diminta review PR/diff AWCMS. Memeriksa scope atomic, migration/OpenAPI/AsyncAPI sinkron, tenant/ABAC/RLS, idempotency, audit, masking, test, dan docs sesuai doc 09, 10, 12.
---

# AWCMS — PR Review

Ikuti `docs/awcms/12_generator_prompt.md` (Prompt Review PR), `docs/awcms/09_roadmap_repository_commit.md` (PR checklist), dan `docs/awcms/10_template_kode_coding_standard.md`.

## Fokus review

1. Scope sesuai issue; **tidak ada unrelated change**.
2. No secret / data customer asli / dump DB / `.env`.
3. Schema berubah → ada migration berurutan (`awcms-new-migration`).
4. API berubah → OpenAPI diperbarui (`awcms-new-endpoint`).
5. Event berubah → AsyncAPI diperbarui (`awcms-new-event`).
6. Tenant context + ABAC + RLS untuk data tenant-scoped.
7. Idempotency untuk mutation high-risk.
8. Audit high-risk + redaction.
9. Soft delete policy untuk resource deletable; posted/append-only entity tidak dihapus.
10. Input validation lengkap; error response standar.
11. Sensitive data masked.
12. Test relevan ada & pass; build pass.
13. Docs diperbarui; commit mengikuti convention `<type>(<scope>): <summary>`.
14. **Diff menyentuh `.astro`? Baca tipenya dengan MATA.** `bun run typecheck`
    (`tsc --noEmit`) **tidak bisa mengurai `.astro`** dan melewatinya diam-diam,
    jadi CI hijau tidak mengatakan apa pun tentang 22.328 baris itu. Yang wajib
    diperiksa manual: `withTenantOrThrow` (bukan `withTenant` — bentuk kedua
    mengembalikan `T | Response` dan akan merender `Response` sebagai data),
    bentuk hasil fungsi aplikasi yang dipakai halaman, dan nilai `null` vs key
    absen saat satu fungsi baca dipakai bersama halaman DAN endpoint.
15. **Menambah/mengubah permukaan yang dikonsumsi `awcms-astro`?** `bun run api:consumer-contract:check`
    wajib hijau, dan **regenerasi kontrak bukan langkah rutin** — ia berarti
    "konsumennya harus ikut berubah", jadi PR-nya wajib menyebut apa yang harus
    dikerjakan di repo sebelah. Enam permukaan itu ada di
    `scripts/api-consumer-contract.ts`; catat bahwa **tiga di antaranya belum
    benar-benar dipanggil** repo sana (lihat asesmen §9.5) sehingga daftar itu
    sendiri sedang menunggu dipisah `CONSUMED` vs `COMMITTED`.
16. **Perubahan yang menyentuh postur keamanan atau performa** (header, cookie,
    rate limit, cache, index, anggaran query) wajib memutakhirkan
    [`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).
    Baris di sana tanpa pemeriksa adalah klaim, bukan kontrol.

## Konsistensi kontrak

- Migration ↔ ERD (doc 04) ↔ matrix migration (doc 13).
- Endpoint ↔ OpenAPI ↔ tabel error/header (doc 05).
- Event ↔ AsyncAPI ↔ `module.ts` publishes/subscribes.
- Soft delete ↔ ERD kolom/index ↔ OpenAPI DELETE/restore/includeDeleted ↔ audit event.

## Output

```text
Verdict: Approve / Request changes / Comment only
Critical issues:
Security issues:
Functional issues:
Data/migration issues:
API/event contract issues:
Testing gaps:
Documentation gaps:
Suggested patch:
```

Untuk modul sensitif, jalankan juga `awcms-security-review`.
