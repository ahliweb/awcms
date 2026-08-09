---
"awcms": minor
---

feat(keamanan): `suspended` berhenti menjadi status login dan menjadi status LAYANAN

`awcms_tenants.status` menerima `'suspended'` sejak `sql/002`. Ia dibaca di jalur
login/reset/registrasi/SSO-start dan di resolver host publik — dan **tidak pernah**
di `authorizeInTransaction`.

Asimetrinya mengarah ke sisi yang salah:

| Permukaan | Setelah suspend, sebelum ini |
| --- | --- |
| Situs publik tenant | mati seketika |
| Sesi admin yang sudah terbit | **penuh akses sampai kedaluwarsa sendiri** |
| Machine credential | **tidak tersentuh** — umur sampai 365 hari |

Pelanggan yang ditangguhkan kehilangan hal yang **dilihat pengunjungnya** dan
mempertahankan hal yang **bisa mengubah datanya**.

Kini ditegakkan di chokepoint untuk sesi **dan** machine credential
(`403 TENANT_SUSPENDED`), diputuskan **sebelum** permission dicari. Tidak ada
sapuan pencabutan sesi, dan tidak diperlukan: pemeriksaannya pada **tenant**,
bukan pada kredensial.

Statusnya ikut lewat **JOIN pada query yang sudah berjalan** — `awcms_tenants`
adalah tabel akar yang sengaja RLS-free, jadi nol round-trip tambahan.
`resolveTenantContext` dipertahankan apa adanya karena tujuh pemanggil di luar
chokepoint memakainya; `resolveTenantPrincipal` yang baru berbagi satu query
dengannya sehingga keduanya tak bisa menyimpang.

Shell admin ikut diblokir di `resolveSsrContext` — **satu baris** yang mencakup
ke-32 layar, karena middleware merutekan tiap `/admin/*` melaluinya. Batasnya
ditulis, bukan disembunyikan: ia semua-atau-tidak, dan ketika layar penagihan
tiba di Gelombang 5 cabang itu harus menumbuhkan allow-list yang sama.

Tenant **platform** dikecualikan dua lapis, dan lapis pertamanya menemukan
jebakan: `resolvePlatformTenant` sengaja menuntut `status = 'active'`, jadi
platform tenant yang ter-suspend akan membuatnya `null`, pengecualiannya
bernilai false, dan operatornya ditolak **setiap** aksi termasuk yang mengangkat
penangguhan itu. `resolvePlatformTenantIdIgnoringStatus` menjawab pertanyaan yang
berbeda dan **tidak memberi apa pun** — permission platform-scoped tetap lewat
resolver lama beserta cek aktifnya.

`disable` dan `restore` adalah **dua** permission, keduanya `scope: platform`.

Satu test menangkap lubang nyata saat dikerjakan: `scope: 'platform'` di basis
data tidak berarti apa-apa sampai kuncinya juga terdeklarasi di **kode** —
`tests/platform-scoped-permissions.test.ts` memerah sampai keduanya ditambahkan.
Itulah inti ADR-0053: kolom memutuskan siapa yang diberi, kode memutuskan apakah
gerbangnya ditanyakan.
