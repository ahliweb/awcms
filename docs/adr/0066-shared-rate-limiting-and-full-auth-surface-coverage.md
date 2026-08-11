# ADR-0066 — Rate limit berbagi lintas-instans, dan seluruh permukaan auth ter-cakup

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §3 (temuannya), [ADR-0050](0050-bff-session-handoff-code.md) (handoff sesi), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (introspeksi sesi)

## Konteks

### 1. Batas melemah linier terhadap jumlah replika

`src/lib/security/rate-limit.ts` menghitung di **`Map` dalam-proses**. Berkasnya
sendiri sudah mencatat itu sebagai keterbatasan yang diketahui — jadi ini bukan
cacat tersembunyi, melainkan **utang yang jatuh tempo begitu deployment
diskalakan horizontal**.

Aritmetikanya: dengan **N** replika di belakang load balancer, batas efektif
menjadi **N × batas terkonfigurasi**. Untuk `POST /api/v1/auth/login` artinya
anti-brute-force melemah persis sebanding dengan jumlah replika — sehingga
deployment yang paling butuh perlindungan (trafik tinggi → banyak replika)
justru yang paling lemah.

Redis **sudah ada di repo** (`src/lib/redis/`), jadi ini penyambungan, bukan
kemampuan baru.

### 2. Tiga permukaan autentikasi tanpa limiter sama sekali

`auth/session-handoff/issue`, `auth/session-handoff/redeem`, dan
`auth/sso/{providerKey}/callback`. Ketiganya punya mitigasi lain (kode handoff
≤60 detik + sekali pakai + `redeem` menuntut client secret; callback SSO terikat
state), jadi ini **kelengkapan, bukan lubang** — tetapi ASVS V11.2 menuntut
anti-automation di **seluruh** permukaan autentikasi, bukan sebagian.

## Keputusan

### §A — `checkSharedRateLimit`, dengan window di dalam KUNCI

Fixed window di Redis: `INCR` pada kunci window, `PEXPIRE` sekali pada hit
pertama.

**Nomor window adalah bagian dari KUNCI, bukan timestamp tersimpan.** Itu yang
membuatnya benar di tempat `Map` tidak: dua instans yang menambah window yang
sama sepakat **tanpa read-modify-write**, jadi tidak ada balapan untuk
dimenangkan siapa pun.

`PEXPIRE` hanya pada hit pertama. Menyetel ulang tiap hit akan menggeser window
dan membiarkan penyerang yang stabil menahan kunci hidup tanpa batas.

**Tanpa Redis terkonfigurasi ia jatuh ke `Map` dalam-proses.** Itu bukan
kompromi: deployment satu-instans tak punya apa pun untuk dibagi, dan menuntut
Redis untuknya akan menjadikan limiter dependensi keras baru bagi topologi
terkecil.

### §B — GAGAL-TERBUKA, dan hanya di sini

Bila Redis terkonfigurasi tapi tak terjangkau, limiter **MENGIZINKAN**. Ini
kebalikan dari postur default repo ini, jadi dinyatakan keras-keras:

Rate limiter adalah perkakas **ketersediaan** di jalur autentikasi. Gagal-tertutup
akan mengubah gangguan Redis menjadi _"tidak ada yang bisa login"_ — penolakan
layanan total atas control plane, yang **bisa dipicu penyerang**.

Yang menjaga itu tetap jujur: **ia bukan satu-satunya kontrol.** Lockout
per-identitas milik `identity-access` (`login-policy.ts`) ditegakkan **di
PostgreSQL, atomik**, dan tidak terpengaruh gangguan Redis. Limiter ini backstop
ber-scope SUMBER di atasnya — penangkap penyerang yang merotasi
`loginIdentifier` — bukan garis terakhir. Timeout perintahnya 250 ms supaya Redis
lambat merosot ke "diizinkan" dengan cepat alih-alih menambah latensi tiap
percobaan, dan `security:readiness` melaporkan Redis terkonfigurasi-tapi-mati
sehingga keadaan terdegradasi terlihat, bukan senyap.

### §C — Sebelas permukaan, bukan delapan

Ketiga endpoint tanpa limiter mendapatkannya. Cakupannya kini: `login`,
`register`, `mfa/totp/verify`, `mfa/step-up`, `password/reset`,
`password/forgot`, `session`, `session-handoff/issue`, `session-handoff/redeem`,
`sso/{providerKey}/start`, `sso/{providerKey}/callback` — **sebelas**, dijaga
test yang juga menegakkan bahwa tak ada rute yang masih memakai limiter
per-instans secara langsung.

> **Diperbarui (ADR-0082, Gelombang 4 PR 4.2):** sebelas menjadi **tiga belas**.
> `auth/invitations/{token}` dan `auth/invitations/{token}/accept` keduanya
> tak-terautentikasi dan ber-token, dan yang kedua MENCETAK AKUN — permukaan
> tulis tak-terautentikasi paling berkonsekuensi di modul ini. Angka itu hidup
> di `tests/shared-rate-limit.test.ts`, bukan di `scripts/`, jadi ia yang paling
> mudah terlupa; kalimat ini ada supaya prosanya tidak menua sendirian.

## Konsekuensi

**Yang didapat.** Batas rate menjadi properti deployment, bukan properti satu
proses. Permukaan autentikasi ter-cakup penuh.

**Yang dibayar.** Jalur login mendapat satu round-trip Redis (dibatasi 250 ms,
gagal-terbuka). Call site berubah jadi `await` — lima belas berkas, mekanis.

**Yang TIDAK berubah.** Limiter tetap fixed-window, bukan sliding/token-bucket.
Fixed window mengizinkan lonjakan 2× di perbatasan window; diterima karena
kontrol yang benar-benar mengikat brute-force adalah lockout per-identitas di DB,
dan mengganti algoritma tanpa mengubah itu hanya memindahkan angka.

**Nol migrasi, nol permission, nol perubahan OpenAPI.**
