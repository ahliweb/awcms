🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0123-backup-encryption-manifest-authentication.md)

<!-- i18n-source-hash: sha256:3972ae2d50be427c0b0a94216d40a707a1ea826c64f1966aee2d7f2ccb08a52a -->

# ADR-0123 — Enkripsi backup, manifest terautentikasi, salinan off-site, dan otomasi restore drill

- **Status:** Diterima
- **Tanggal:** 2026-09-24
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #812; `deploy/backup/backup-postgres.sh`; `deploy/backup/restore-postgres.sh`; `deploy/backup/manifest.sh`; `deploy/backup/offsite-copy.sh`; `deploy/backup/restore-drill.sh`; `docs/awcms/production-preflight-runbook.md` §Stage 2; `docs/awcms/deployment-profiles.md`

## Konteks

`deploy/backup/backup-postgres.sh` dan `deploy/backup/restore-postgres.sh`
(baseline kuat yang sudah ada) sengaja menolak jalan ketika
`BACKUP_ENCRYPTION_KEY_FILE` atau `BACKUP_HMAC_KEY_FILE` di-set, karena
enkripsi-at-rest dan manifest terautentikasi belum pernah diimplementasikan.
`docs/awcms/production-preflight-runbook.md` §Stage 2 dan
`docs/awcms/deployment-profiles.md` sama-sama membawa koreksi bertanggal
yang menyatakan hal ini. ADR ini menutup celah itu: mencatat opsi yang
dipertimbangkan untuk enkripsi at-rest dan autentikasi manifest, keputusannya,
dan apa yang dibangun.

AWCMS Bun-only untuk kode aplikasi (AGENTS.md aturan 11), tetapi
`deploy/backup/*.sh` sudah berjalan sebagai Bash murni di dalam container
`postgres:18.4` yang tidak punya Bun (lihat komentar header kedua skrip yang
sudah ada) — ia membungkus `pg_dump`/`pg_restore`, biner level-OS, bukan
logika aplikasi. Batasan yang sama berlaku untuk apa pun yang ditambahkan
ADR ini: ia harus berjalan tanpa pengawasan, tanpa manusia di terminal, di
dalam image container minimal yang sama (atau yang sangat mendekatinya),
dan tidak boleh menarik tooling Node.js/npm.

## Opsi yang dipertimbangkan — enkripsi at-rest

| Opsi                                                | Kelebihan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Kekurangan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`age`** (`filippo.io/age`, FiloSottile)           | Biner Go statis tunggal, tanpa file konfigurasi, tanpa keyring, tanpa daemon. Konstruksi AEAD modern (X25519 + ChaCha20-Poly1305, atau scrypt untuk passphrase). Recipient adalah kunci publik — host yang mengenkripsi hanya pernah butuh file kunci **publik**, tidak pernah identitas privat yang bisa mendekripsi. Sudah tersedia di tooling operator mesin ini (`age`/`age-keygen` ada di `PATH` selama pengerjaan ini) dan hanya biner statis ~5 MB, trivial ditambahkan ke image container backup lewat satu baris `COPY`, tanpa rantai dependensi package manager. | Tidak ada di image dasar `postgres:18.4` Debian/Ubuntu default — harus ditambahkan ke image apa pun yang menjalankan backup (didokumentasikan, satu baris `COPY`). Proyek lebih muda dari GnuPG (rilis pertama 2019) meski sudah diadopsi luas (dipakai `sops`, `github.com/FiloSottile/age`, Mozilla SOPS, 1Password, Tailscale).                                                                                                                                                                                                                                  |
| **GnuPG (`gpg --encrypt`)**                         | Ada di mana-mana, sudah ada di kebanyakan base image, sangat matang, sebagian deployment FIPS-adjacent kadang mewajibkannya.                                                                                                                                                                                                                                                                                                                                                                                                                                               | UX tanpa-pengawasan yang terkenal buruk (state keyring/agent, daemon `gpg-agent`, prompt `pinentry` kecuali disupresi hati-hati), permukaan serangan jauh lebih besar (riwayat CVE mencakup isu parser dan side-channel), manajemen kunci lebih berat (file keyring, trust database) untuk kebutuhan yang hanya "enkripsi ke satu recipient, dekripsi dengan satu identitas" — GnuPG menyelesaikan masalah yang jauh lebih besar (web of trust, rantai penandatanganan multi-recipient) dari kebutuhan ini.                                                         |
| **OpenSSL `enc`** (mis. `openssl enc -aes-256-cbc`) | Ada di setiap image dengan OpenSSL (sudah jadi dependensi dukungan TLS `psql`/`libpq`). Tidak ada biner baru.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `openssl enc` secara eksplisit didokumentasikan upstream sebagai **tidak terautentikasi** (tanpa AEAD, tanpa pengecekan integritas bawaan) — riwayat penyalahgunaan `openssl enc` yang mirip kasus "padding oracle" sertifikat TLS sudah dikenal luas. Memakainya dengan benar butuh menambahkan MAC terpisah secara manual (persis yang sudah dilakukan `age`/GnuPG secara internal, benar, dan teraudit). Memakai OpenSSL di sini berarti mengimplementasikan ulang authenticated encryption secara manual — persis jenis kesalahan yang ingin dihindari ADR ini. |
| **libsodium / `node:crypto` native Bun**            | Primitif kelas terbaik (`crypto_secretbox`, AES-256-GCM), dan Bun mengirim kompatibilitas `node:crypto` sehingga tanpa dependensi baru untuk _skrip_ Bun.                                                                                                                                                                                                                                                                                                                                                                                                                  | Skrip backup/restore secara eksplisit adalah Bash murni yang berjalan di dalam container `postgres:18.4` tanpa Bun (lihat komentar header kedua skrip) — memasukkan langkah Bun/Node ke jalur itu berarti (a) menambahkan Bun ke image backup (mengalahkan desain "minimal, version-matched ke server" yang sudah dipilih untuk `pg_dump`/`pg_restore`), atau (b) menulis glue FFI C/Rust custom di luar Bash, persis "skrip komposit kecil" yang secara eksplisit diminta issue untuk TIDAK diganti dengan sesuatu yang opak.                                      |

**Keputusan: `age`.** Ini satu-satunya opsi yang sekaligus (a) biner statis
tunggal yang trivial ditambahkan ke image container tanpa-pengawasan,
(b) authenticated encryption by construction (tanpa MAC buatan sendiri),
dan (c) asimetris — host penghasil backup hanya pernah butuh file recipient
**publik**, sehingga host backup yang terkompromi tidak bisa mendekripsi
backup yang ditulisnya sendiri, dan identitas privat yang bisa mendekripsi
hanya hidup di tempat restore/drill dijalankan. GnuPG ditolak terutama
karena kerapuhan operasi tanpa-pengawasan (state agent/pinentry) dan
kompleksitas tak perlu untuk kasus satu-recipient; OpenSSL `enc` ditolak
karena bukan authenticated encryption; crypto native Bun ditolak karena
akan butuh menambahkan runtime Bun ke container yang sengaja dijaga minimal
dan version-matched ke server PostgreSQL, atau mengimplementasikan ulang
glue kripto di Bash lewat FFI — keduanya lebih buruk dari satu pemanggilan
biner yang sudah teraudit.

## Opsi yang dipertimbangkan — autentikasi manifest

| Opsi                                                                                                         | Kelebihan                                                                                                                                                                                                                                                                                                 | Kekurangan                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HMAC-SHA256 atas manifest JSON kanonik, kunci dari file kunci**                                            | Simetris, primitif tunggal ala OpenSSL/`sha256sum` (`openssl dgst -sha256 -hmac`), tanpa biner baru (OpenSSL sudah ada), trivial diverifikasi dengan satu perintah, mencocokkan pola sync-HMAC yang sudah ada di proyek (`docs/awcms/sync-hmac.md`) sehingga operator dan reviewer sudah kenal bentuknya. | Kunci simetris: siapa pun yang bisa memverifikasi juga bisa memalsukan. Bisa diterima di sini karena verifikasi hanya terjadi di host yang sendirinya dipercaya menjalankan restore (restore-drill/restore-postgres sudah butuh kredensial DB privileged) — tugas manifest adalah deteksi-tamper terhadap lapisan penyimpanan/transport yang terkompromi atau korup, bukan terhadap host yang sudah memegang kredensial restore.                                   |
| **Tanda tangan terpisah berbasis age** (`age` tidak punya primitif penandatanganan native) atau **minisign** | Asimetris — host restore yang terkompromi bisa memverifikasi tapi tidak memalsukan.                                                                                                                                                                                                                       | `age` tidak punya primitif penandatanganan bawaan; menambahkan minisign berarti biner statis _kedua_ (di atas `age`) dengan adopsi ekosistem jauh lebih rendah di codebase ini, untuk ancaman (host restore/drill yang terkompromi memalsukan manifestnya sendiri) yang bukan ancaman yang disasar kontrol ini — host yang sudah bisa menjalankan `pg_restore` dengan kredensial produksi sudah bisa melakukan kerusakan arbitrer terlepas dari keaslian manifest. |
| **Tanda tangan terpisah GPG (`gpg --detach-sign`)**                                                          | Asimetris, format ada di mana-mana.                                                                                                                                                                                                                                                                       | Kerapuhan operasi tanpa-pengawasan yang sama seperti opsi enkripsi di atas, dan menarik seluruh mesin keyring/trust-database GnuPG untuk satu tanda tangan terpisah.                                                                                                                                                                                                                                                                                               |

**Keputusan: HMAC-SHA256 dengan file kunci**, konsisten dengan pola
`SYNC_HMAC_KEY`/sync-HMAC yang sudah ada dan terdokumentasi di repo ini
(`docs/awcms/sync-hmac.md`) sehingga bentuk operasionalnya (file kunci,
`openssl dgst -sha256 -hmac`, fail-closed pada konfigurasi sebagian) adalah
bentuk yang sudah dikenal dan diaudit tim. Manifest sendiri memakai body
JSON kanonik dengan urutan field tetap sehingga HMAC dihitung atas byte
yang stabil, bukan serialisasi yang bergantung implementasi.

## Keputusan

1. **`age`** (asimetris, X25519) mengenkripsi artefak backup.
   `BACKUP_AGE_RECIPIENTS_FILE` (satu atau lebih baris recipient publik
   `age1...`, aman disimpan di host penghasil backup) dipakai untuk
   mengenkripsi; `RESTORE_AGE_IDENTITY_FILE` (identitas privat
   `AGE-SECRET-KEY-1...`) dipakai untuk mendekripsi, hanya hidup di tempat
   restore/drill dijalankan. Memisahkan dua nama env var (bukan memakai
   ulang `BACKUP_ENCRYPTION_KEY_FILE` untuk kedua arah) membuat asimetri
   itu terlihat di konfigurasi, tidak cuma di primitif yang mendasarinya.
2. **HMAC-SHA256** (`BACKUP_HMAC_KEY_FILE`, file kunci mentah 32+ byte, ada
   di host backup maupun restore) mengautentikasi manifest JSON kanonik
   yang mengikat: nama file artefak, digest sha256 artefak, metadata versi
   `pg_dump`/server, nama database sumber, timestamp backup, dan
   fingerprint recipient age yang dipakai. Manifest diverifikasi
   **sebelum dekripsi dan sebelum mutasi restore apa pun**.
3. Kedua env var baru bersifat **semua-atau-tidak-sama-sekali per arah**:
   jika hanya salah satu dari `BACKUP_AGE_RECIPIENTS_FILE`/
   `BACKUP_HMAC_KEY_FILE` di-set saat backup, atau hanya salah satu dari
   `RESTORE_AGE_IDENTITY_FILE`/`BACKUP_HMAC_KEY_FILE` di-set saat restore,
   skrip gagal tertutup (fail closed) dengan pesan error yang jelas alih-alih
   diam-diam jatuh ke plaintext atau melewati verifikasi. Ketika _keduanya_
   tidak di-set, perilaku tidak berubah dari sebelum ADR ini (dump
   `--format=custom` polos + sidecar sha256) — profil deployment
   offline/LAN, yang tidak punya cerita secret-management, tetap berjalan
   persis seperti sekarang.
4. **Salinan off-site** (`deploy/backup/offsite-copy.sh`) adalah adapter
   tipis di sekitar `rsync`/`scp`-lewat-SSH (sudah ada di image mana pun
   dengan klien `ssh`, tanpa dependensi baru) dengan retry/backoff, timeout
   per percobaan, dan — krusial — **tidak pernah menghapus artefak lokal**,
   apa pun hasil transfernya; menghapus backup lokal adalah keputusan
   manusia terpisah dan eksplisit yang tidak dibuat skrip ini.
5. **Otomasi restore drill** (`deploy/backup/restore-drill.sh`) adalah
   orkestrator tipis: pilih backup lokal eligible terbaru, verifikasi
   manifestnya, dekripsi bila perlu, serahkan ke `restore-postgres.sh` yang
   sudah ada dalam mode drill **non-destruktif default** (tanpa `--target`,
   sehingga secara struktural tidak mampu menyasar produksi — tidak ada
   jalur flag di skrip ini yang pernah meneruskan `--target`), dan
   menambahkan satu baris JSON bukti (nama dump, digest, detik RTO,
   pass/fail, timestamp — tanpa secret) ke log bukti. Dapat dijadwalkan
   cron (`deploy/cron/awcms.crontab` sudah menjalankan padanan pra-ADR
   mingguan); ADR ini menjaga entri itu tetap menunjuk ke skrip baru,
   bukan memanggil `restore-postgres.sh` langsung.

## Cakupan yang ditolak

- **`scripts/dr-drill.ts` / `bun run resilience:dr-drill`** — dijelaskan
  `docs/awcms/resilience-dr-verification.md` sebagai orkestrator yang
  belum dibangun yang nantinya akan memanggil `restore-drill.sh`. Banner
  dokumen itu sendiri menyatakan tool itu belum ada di repo ini;
  membangun seluruh framework failure-injection (`target-guard.ts`,
  scenario runner, enam definisi skenario) di luar scope issue ini, yang
  secara spesifik adalah celah asurans backup/restore. ADR ini mengirim
  `deploy/backup/restore-drill.sh` sebagai skrip nyata, mandiri, siap
  cron/CI, yang bisa dipanggil `dr-drill.ts` **saat ia dibangun** —
  tidak menunggu upaya lebih besar itu, dan banner dokumen tersebut
  dibiarkan (masih benar) alih-alih ditulis ulang seolah tool itu ada.
- **Integrasi secrets-management khusus** (Vault, AWS Secrets Manager, dll.)
  — di luar scope. Kontraknya adalah "kunci datang dari file", yang
  bisa dikomposisi dengan secret manager mana pun yang bisa mewujudkan
  sebuah file (Docker/Kubernetes secret, Vault Agent template, dll.) tanpa
  repo ini bergantung pada satu vendor tertentu.

## Konsekuensi

- Positif: backup produksi bisa dilindungi kerahasiaan dan integritasnya
  tanpa menambah dependensi Bun/Node ke container backup, memakai primitif
  yang teraudit luas, sementara default tanpa-enkripsi profil offline/LAN
  tetap berjalan tanpa berubah.
- Positif: pemisahan asimetris (file recipient vs file identitas) berarti
  host penghasil backup yang terkompromi tidak bisa mendekripsi backup
  yang ditulisnya, yang secara material mengurangi blast radius kompromi
  spesifik itu.
- Negatif: operator kini mengelola satu pasang kunci lagi (`age`) dan satu
  secret bersama lagi (kunci HMAC), di atas kredensial DB itu sendiri,
  dengan disiplin operasional yang itu tuntut (rotasi, penyimpanan, tidak
  pernah di-commit — ditegakkan lewat panduan gaya `.gitignore` di
  `deploy/backup/README.md`, bukan lewat tooling, karena ini file secret
  level-host di luar pengetahuan repo ini sendiri).
- Negatif: image backup kini harus menyertakan biner `age`; ini penambahan
  satu biner statis, didokumentasikan di `deploy/backup/README.md`, bukan
  rantai dependensi package manager.

## Keselarasan standar

Ini memenuhi kontrol kerahasiaan (enkripsi at-rest), integritas (manifest
terautentikasi, deteksi tamper), dan keterpulihan-teruji (restore drill
dengan bukti) yang umum diharapkan kontrol manajemen backup ISO/IEC
27001/27002 dan praktik kesinambungan bisnis ISO 22301, tanpa mengklaim
sertifikasi terhadap keduanya.
