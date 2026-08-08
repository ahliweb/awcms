---
"awcms": patch
---

fix(keamanan): `bun audit` berhenti jadi klaim tanpa pemeriksa — tiga advisory `high` ditutup dan digerbangi

`docs/awcms/standar-performa-dan-keamanan.md` menjadikan `bun audit` bukti untuk
**tiga** tabel kepatuhan sekaligus — OWASP A06, ISO/IEC 27001 A.8.8, dan NIST
SSDF RV.1 — sementara `grep -rn "bun audit" package.json .github/workflows/
scripts/` mengembalikan **nol** kemunculan. Tidak ada satu perintah pun yang
menjalankannya. Baris A06 berbunyi "`bun audit` bersih per 4 Agustus 2026";
dijalankan 8 Agustus ia keluar dengan **3 advisory high**:

- `nanoid <3.3.17` (GHSA-2v37-7h3g-55p8), lewat `astro › vite › postcss`
- `js-yaml >=3.0.0 <3.15.1` dan `>=4.0.0 <4.3.1` (GHSA-5p4m-2wfm-xmqj,
  CVE-2026-59870), lewat `astro`, `@astrojs/node`, dan `@changesets/cli`

Ketiganya ditutup lewat `overrides`, dan yang ketiga adalah alasan yang dua
lainnya tidak punya: mengoverride `js-yaml` SENDIRIAN **merusak tooling rilis**.
`read-yaml-file@1.1.0` — dipatok transitif oleh `@changesets/cli@2.31.1`, yang
sendirinya sudah versi terbaru — memanggil `yaml.safeLoad`, API yang dihapus di
js-yaml 4. Dibuktikan dengan memanggilnya: `Function yaml.safeLoad is removed in
js-yaml 4`. Karena Bun 1.3.14 **mengabaikan diam-diam** baik `overrides`
bersarang gaya npm maupun `resolutions` ber-path gaya yarn (keduanya tidak
menghasilkan entri bersarang di `bun.lock`), override tidak bisa dipersempit ke
satu jalur — jadi konsumennya yang dinaikkan: `read-yaml-file ^2.1.0`, versi
terbaru yang masih CommonJS (`3.0.0` sudah `"type": "module"` sedangkan
`@manypkg/get-packages` menjangkaunya lewat `require()`) dan sudah memakai
`js-yaml ^4.1.1`.

Gerbang barunya `bun run deps:audit:check`, disisipkan ke rantai `check`:

- memblokir `high`/`critical`; `moderate`/`low` dicetak tetapi tidak memblokir,
  karena gerbang yang berbunyi pada derau adalah gerbang yang dihapus orang
- **gagal-TERTUTUP** saat `bun audit` tidak bisa dijalankan — audit yang tak
  terjangkau registry melaporkan hijau yang sama dengan audit bersih, dan hanya
  satu dari keduanya yang benar
- daftar pengecualian **KOSONG** dan dijaga tetap kosong; entri yang tidak lagi
  cocok dengan advisory mana pun **memerahkan** gerbang, sehingga daftarnya tak
  bisa jadi museum kerentanan yang sudah lama diperbaiki upstream

Dua jebakan yang ditemukan sambil mengerjakan ini dan ditulis di header skrip
supaya tidak ditemukan ulang: `bun update <nama>` pada dependensi **transitif**
tidak memutakhirkan salinan bersarangnya — ia menambahkan paket itu sebagai
dependensi **langsung** repo; dan `bun install` inkremental **tidak memangkas**
`node_modules/*/node_modules/<pkg>` peninggalan instalasi sebelumnya, sehingga
pohon direktori bisa memuat salinan rentan sementara gerbang hijau. Yang diaudit
adalah lockfile — dan lockfile pula yang dikirim (`--frozen-lockfile` di CI dan
image), jadi itu yang benar; "hijau" berarti lockfile-nya bersih, bukan setiap
byte di `node_modules/`.

Ketiga baris kepatuhan dikoreksi agar menamai gerbang yang berjalan, bukan
perintah yang tersedia.
