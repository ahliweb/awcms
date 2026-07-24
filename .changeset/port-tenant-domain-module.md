---
"awcms": minor
---

Port modul `tenant_domain` dari awcms-micro (epic #555): pemetaan
hostname/subdomain → tenant untuk routing publik berbasis host (Wave-0 program
penyerapan awcms-micro). Menambah tabel `awcms_tenant_domains` (migrasi 046, tenant-scoped
`ENABLE`+`FORCE ROW LEVEL SECURITY`, unique hostname lintas-tenant, satu primary
per tenant), seed permission `tenant_domain.domains.*` (migrasi 047), dan fungsi
lookup host→tenant `awcms_resolve_tenant_domain_lookup` `SECURITY DEFINER`
(migrasi 048). Fungsi ini di-own oleh role bootstrap khusus `awcms_domain_bootstrap`
(`NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS`, tanpa anggota) dengan policy `FOR SELECT`
ter-scope (`USING (true)` khusus role itu) sehingga bootstrap host→tenant tetap
resolve di deployment role-separated tempat owner migrasi **bukan** superuser
(mis. `awcms_app`/`awcms_worker`/`awcms_setup` dari sql/019–022, dan harness
integrasi yang men-demote owner-nya) — tanpa memberi `BYPASSRLS` ke role apa pun,
tanpa melepas `FORCE ROW LEVEL SECURITY`, dan tanpa menyentuh policy
`tenant_isolation`. `EXECUTE` hanya ke `awcms_app`; kolom sensitif
(`verification_token_hash`/`verification_record_value`) tetap tak terbaca.

API manajemen tenant-scoped di `/api/v1/tenant/domains` (list/create/read/
update/soft-delete + `verify` dan `set-primary` yang ber-`Idempotency-Key` dan
diaudit), layar admin `/admin/tenant/domains`, resolver host publik ADITIF
(`lib/tenant/public-host-tenant-resolver.ts` — hidup berdampingan dengan
routing berbasis path `/blog/{tenantCode}` ADR-0009, tidak meregresi), dan
adapter Cloudflare DNS OPSIONAL (env-gated, aman tanpa kredensial, belum
di-wire ke rute mana pun).

Deferral yang didokumentasikan: rute konten publik ber-resolusi host belum
di-wire (deferral yang sama seperti `/news/**` news_portal); `src/middleware.ts`
tidak disentuh (jaminan login/Turnstile/CSP tak berubah). Union `AccessAction`
identity-access diperluas dengan `set_primary`.

**Risiko residual (harden sebelum go-live self-service custom domain).** `verify`
saat ini mengaktifkan domain berdasarkan field in-row tanpa bukti kepemilikan
outbound (model manual-first; adapter DNS ada tapi belum di-wire). Untuk mencegah
pengambilalihan domain (dangling-DNS) pada custom domain bersama, aktivasi
`custom_domain` **wajib digerbangi operator/manual** sampai bukti kepemilikan
DNS-token (`verification_token_hash` + cek TXT/CNAME lewat adapter) di-wire.
`verify` sudah default-deny + di-audit; risiko ini didokumentasikan di README modul
dan skill `awcms-tenant-domain-routing`.
