---
"awcms": minor
---

feat(auth): sesi bisa dilihat dan diakhiri sendiri — Gelombang 2 PR 2.1

`GET /api/v1/auth/sessions` dan `DELETE /api/v1/auth/sessions/{id}`: di mana
saya sedang masuk, dan akhiri yang bukan saya.

**Nol permission baru, dan itu keputusan bukan kelalaian.** Subjeknya adalah
pemanggil, dan rutenya tidak menerima `tenantUserId` — tidak ada orang lain yang
bisa diarahkan. Mengarang permission untuk "lihat sesi sendiri" akan memasang
tembok di depan fiturnya **dan** menanam jebakan latent-authz ADR-0058 §E: aksi
yang tak di-seed apa pun menolak semua orang termasuk owner tenant, sementara
kodenya terbaca seolah digerbangi benar. Konsekuensinya
`access:permissions:enforcement:check` dan `admin:screen-coverage:check` tidak
tersentuh sama sekali.

**Tiga kolom sidik jari** (`sql/100`), karena daftar id opaque tidak bisa
menopang keputusan "mana yang bukan saya": `client_ip_hash`,
`user_agent_summary`, `origin_auth` (`password` | `sso` | `handoff`).

Satu detail yang tidak ada di rencana dan hanya terlihat dengan membaca kedua
sisi: **`hashClientIp` memakai kunci acak per-proses** bila
`AUTH_IP_HASH_SECRET` tak diset. Dapat ditoleransi untuk atribut audit — masih
non-reversible — dan **tidak** dapat ditoleransi untuk kolom yang dipersistenkan:
sesudah restart perangkat yang sama menghasilkan hash berbeda, dan daftar yang
dipakai orang untuk memutuskan "akhiri yang mana" akan menampilkan satu
perangkat sebagai beberapa, diam-diam, ke arah yang menghasilkan pencabutan yang
salah. Karena itu `persistableClientIpHash` mengembalikan **null** bila kuncinya
tidak stabil; konsol menyebut pengelompokan tak tersedia alih-alih menampilkan
yang keliru.

**`origin_auth` tanpa default di kode.** Kompiler menyebut keempat penerbit
sesi, satu per satu, dan tiap satu menamai alasannya. Sebuah default akan
diam-diam menstempel yang paling umum ke penerbit yang lupa — justru field yang
nanti dipakai menalar radius ledakan.

**Rotasi step-up MEMBAWA asal aslinya.** Menaikkan assurance bukan
mengautentikasi ulang; menstempel `password` di sana akan menulis ulang
provenance sebuah sesi SSO tepat pada saat seseorang membuktikan faktor kedua.

**Empat penolakan, satu bentuk.** Id tak dikenal, sesi orang lain, sesi tenant
lain, dan yang sudah dicabut/kedaluwarsa semuanya `404` — membedakannya
menjadikan endpoint ini oracle keberadaan id sesi. Kepemilikan ditegakkan di
klausa `WHERE` UPDATE-nya, bukan oleh pembacaan sebelumnya. Mencabut sesi yang
sedang dipakai dijawab `409` yang **menyebut penggantinya** (`/auth/logout`),
bukan sukses senyap yang meninggalkan cookie mati.

**Tanpa `last_seen_at`**, sengaja: ia harus ditulis di jalur baca otorisasi —
satu UPDATE per request per sesi, selamanya — untuk kolom yang tugasnya kosmetik.

CHECK-nya sengaja **tidak** memuat `switch`: tak ada endpoint tenant-switch di
repo ini, dan CHECK yang memuat nilai yang tak bisa diproduksi apa pun terbaca
sebagai kapabilitas yang sudah ada.

Migrasi diterapkan dua kali ke Postgres nyata (apply + idempotensi).
