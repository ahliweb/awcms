# 05 — Kontrak sesi lintas-origin dan BFF

> Rencana. Lihat [README](README.md) untuk status. Endpoint introspeksi sesi
> **belum ada** di repo ini.

## 1. Apa yang sudah ada (dan sering salah dibaca)

| Fakta di kode                                                                                                                                             | Berkas                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Login mengembalikan token **dan** menyetel dua cookie httpOnly: `awcms_session` + `awcms_tenant_id` (`SameSite=Lax`, `Secure` lewat `AUTH_COOKIE_SECURE`) | `src/pages/api/v1/auth/login.ts`, `src/lib/auth/ssr-session.ts`        |
| Guard menerima **header bearer + tenant header ATAU cookie** — header menang, cookie fallback                                                             | `resolveAuthInputs()` di `identity-access/application/access-guard.ts` |
| `GET /api/v1/auth/me` menerima **bearer saja**                                                                                                            | `src/pages/api/v1/auth/me.ts`                                          |
| Sesi disimpan sebagai hash token, bisa dicabut; MFA/step-up menaikkan assurance dan **merotasi** sesi                                                     | modul `identity_access`                                                |

Kesimpulan yang benar: yang hilang bukan "dukungan cookie", melainkan **kontrak
sesi untuk origin yang berbeda**. Cookie `awcms_session` milik origin `awcms`;
browser di `jualanku.info` tidak akan pernah mengirimkannya, dan tidak boleh.

## 2. Bentuk yang disetujui

```
Browser  ──cookie httpOnly "jualanku_portal"──►  awcms-astro (BFF)
                                                   │  memegang pemetaan
                                                   │  cookie portal → token sesi awcms
                                                   │  (server-side, tidak pernah ke klien)
                                                   ▼
                                        awcms  /api/v1/auth/session (introspeksi)
                                        awcms  /api/v1/jualanku/portal/**
```

- Browser **tidak pernah** memegang token `awcms`.
- BFF mengirim token sebagai `Authorization: Bearer` + `x-awcms-tenant-id` ke
  `awcms` lewat jaringan privat.
- Tenant diturunkan BFF dari konfigurasi deployment/host (`tenant_domain`),
  tidak pernah dari input pengguna.

## 3. Endpoint introspeksi yang harus ditambahkan

`GET /api/v1/auth/session` — pemilik: `identity_access`.

- **Input:** bearer token + tenant header (dipanggil BFF, bukan browser).
- **Output (safe claims saja):** `identityId`, `tenantId`, `displayName`,
  `roles[]`, `assuranceLevel` (aal1/aal2), `expiresAt`, `scopes[]` (referensi
  scope merchant/affiliate yang aktif).
- **Tidak pernah dikembalikan:** token, hash token, status password, secret MFA,
  recovery code, email/telepon mentah, atau atribut apa pun yang tidak dibutuhkan
  header portal.
- **Fail-closed & anti-oracle:** sesi tidak valid/kedaluwarsa/dicabut
  menghasilkan satu bentuk respons yang sama (401 `AUTH_REQUIRED`), tanpa
  membedakan "tidak ada" dari "kedaluwarsa".
- Rate-limited, tidak pernah di-cache (`no-store`).

Alternatif yang **ditolak**: mengizinkan browser publik memanggil `/api/v1/**`
langsung dengan cookie lintas-site. Itu memindahkan pemilihan tenant, CSRF, dan
CORS ke klien.

## 4. Kewajiban BFF

| Kebutuhan           | Ketentuan                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie portal       | `HttpOnly`, `Secure`, `SameSite=Lax` (atau `Strict` bila alur login tidak butuh redirect lintas-site), `Path=/`.                      |
| Penyimpanan token   | Token `awcms` disimpan server-side (session store BFF) atau di dalam cookie terenkripsi — **tidak pernah** di JS.                     |
| CSRF                | Origin/Referer check **plus** token double-submit/synchronizer untuk setiap mutasi. Bukan salah satu saja.                            |
| Tenant              | Ditetapkan server dari host mapping; header tenant dari klien diabaikan total.                                                        |
| Logout              | Panggil logout `awcms` (revokasi sumber kebenaran) **lebih dulu**, baru hapus cookie portal. Urutan terbalik meninggalkan sesi hidup. |
| Rotasi              | Setelah login, setelah step-up/perubahan privilege, dan setelah recovery. Rotasi mencegah session fixation.                           |
| Revokasi            | Sumber kebenaran tetap `awcms`. BFF tidak menyimpan daftar sesi sendiri, tidak "mengingat" sesi yang sudah dicabut.                   |
| Cache               | `Cache-Control: private, no-store` untuk seluruh respons portal dan `_portal-api`.                                                    |
| Error               | Envelope `awcms` diterjemahkan ke view model; `correlationId` diteruskan ke log kedua sisi.                                           |
| Timeout & degradasi | `awcms` tidak tersedia → halaman error yang jujur, bukan halaman kosong yang tampak berhasil.                                         |

## 5. Model ancaman ringkas

| Ancaman                                        | Kontrol                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pencurian token lewat XSS di portal            | Token tidak pernah di JS; CSP ketat; tidak ada `set:html` dari sumber selain renderer terkontrol |
| CSRF pada mutasi portal                        | Origin check + token CSRF + `SameSite`                                                           |
| Session fixation                               | Rotasi sesi setelah login/step-up                                                                |
| Confused deputy (BFF dipakai jadi proxy bebas) | BFF hanya punya daftar rute upstream yang eksplisit; tidak ada path passthrough generik          |
| Tenant tampering                               | Tenant server-derived; header tenant klien diabaikan                                             |
| Kebocoran privat ke cache/sitemap              | `no-store` + rute privat tidak pernah masuk sitemap + gate cache surface                         |
| Enumerasi akun/merchant                        | Respons seragam; 404 anti-oracle; rate limit pada login dan lookup                               |
| Replay mutasi                                  | Idempotency key pada aksi high-risk                                                              |

## 6. Test yang wajib menyertai kontrak ini

1. Sesi valid → introspeksi mengembalikan hanya safe claims (uji field-by-field:
   kebocoran field baru harus memerahkan test).
2. Sesi dicabut/kedaluwarsa → 401 dengan bentuk respons identik.
3. Mutasi tanpa token CSRF → ditolak; dengan Origin asing → ditolak.
4. Header tenant dari klien diabaikan (kirim tenant lain → tetap tenant host).
5. Logout portal → sesi `awcms` benar-benar tidak bisa dipakai lagi.
6. Step-up MFA memutasi assurance dan **merotasi** token; token lama mati.
7. Respons portal tidak pernah membawa `Cache-Control` yang bisa di-cache
   bersama.
