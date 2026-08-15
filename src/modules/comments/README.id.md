🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:70043750ad933dc33f57ac6589f832d75a3e59ea165bb1d8fb76c7558cece9c9 -->

# comments

Komentar ber-cakupan tenant yang **mengutamakan moderasi** atas sumber daya
**yang sudah terbit dan publik**. Diakui oleh
[ADR-0041](../../../docs/adr/0041-comments-module-admission.md), diport dari
awcms-micro Issue #271 sebagai satu baris Gelombang-1 pada
[`docs/awcms/absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).

## Satu hal yang harus dipahami lebih dulu

Ini adalah **permukaan TULIS publik tanpa autentikasi**. Fakta tunggal itu
menggerakkan hampir setiap keputusan desain di sini, dan itulah sebabnya catatan
keamanan di bawah bukan sekadar formalitas. Bila Anda mengubah apa pun di modul
ini, pertanyaan yang harus terus diajukan adalah: _apa yang menghentikan orang
asing anonim memakai ini untuk menyimpan markup, mengenumerasi konten yang belum
terbit, atau membanjiri antrean?_

## Arah panah

`comments` bergantung pada **Core saja** (`tenant_admin`, `identity_access`). Ia
tidak pernah mengimpor modul konten.

Modul konten MENDEKLARASIKAN sumber daya mana miliknya yang boleh dikomentari,
lewat `ModuleDescriptor.commentableResources` — data murni: nama tabel dan kolom
yang sudah ditinjau plus `publicationFilter` yang deklaratif. `comments`
menemukannya melalui `listModules()`, sehingga tipe konten baru yang bisa
dikomentari adalah satu deklarasi di `module.ts` milik modul itu sendiri dan nol
perubahan di sini.

Ini berupa daftar deskriptor alih-alih capability `provides` karena banyak modul
konten diperkirakan ingin punya komentar, dan penyedia kedua akan memicu
`capability_provider_conflict`.

`src/lib/comments/commentable-resources.ts` adalah composition root — satu-satunya
tempat yang boleh memanggil `listModules()`. Semua yang berada di bawah `domain/`
dan `application/` menerima deskriptor sebagai parameter, dan itu pula yang
memungkinkan mesinnya digerakkan dari registry fixture di dalam pengujian.

## Tulang punggung keamanan

1. **Batas publikasi.** Sebuah komentar hanya pernah diterima terhadap, atau
   ditampilkan pada, sumber daya yang memenuhi `publicationFilter` modul
   pemiliknya. Sumber daya yang masih draf, privat, ter-soft-delete, atau
   terjadwal-tapi-belum-tayang tidak menerima maupun memaparkan komentar.
   Permukaan komentar **tidak pernah** menjadi sumber otorisasi bagi sumber daya
   di bawahnya.
2. **Tanpa stored XSS, secara konstruksi.** Badan komentar disimpan sebagai
   **teks polos mentah**, tidak pernah HTML. Pada waktu render setiap karakter
   di-escape lebih dulu, dan baru setelah itu URL http(s) telanjang di-autolink,
   dengan URL yang di-escape baik di `href` maupun teks yang terlihat plus
   `rel="nofollow ugc noopener noreferrer"`. Tidak ada allow-list sanitizer yang
   bisa dibuat keliru dan tidak ada jalur yang membuat komentar tersimpan sampai
   ke peramban sebagai markup.
3. **Tanpa oracle.** Respons submit publik seragam: sumber daya yang tak
   teresolusi, modul yang dinonaktifkan, blokir anti-penyalahgunaan, dan komentar
   yang diterima-tapi-menunggu semuanya mengembalikan `{"status":"received"}`.
   Operasi yang terikat penulis mengembalikan **404, bukan 403**, sehingga tak
   bisa memastikan komentar penulis lain memang ada.
4. **Anti-penyalahgunaan di sisi server.** Honeypot, batas bawah waktu-submit
   bertanda-tangan HMAC, batas panjang dan tautan, istilah terblokir per-tenant,
   sidik jari duplikat, dan batas laju per-IP. Semuanya fail closed: dengan batas
   bawah waktu yang terkonfigurasi, pengukuran yang hilang dihitung sebagai
   terlalu cepat, jadi membuang tokennya bukan cara melewatinya.
5. **PII diminimalkan.** Email penulis hanya disimpan sebagai hash sha256 plus
   bentuk termasker, tidak pernah mentah. IP dan user-agent adalah hash
   ber-salt-tenant. Alamat langganan dienkripsi AES-256-GCM di bawah kuncinya
   sendiri; bila tidak ada kunci terkonfigurasi, sebuah sentinel yang tak bisa
   diresolusikan disimpan alih-alih teks polos.
6. **Isolasi tenant.** Ketujuh tabel membawa RLS `ENABLE` **dan** `FORCE`.
   `ENABLE` saja bersifat inert selama aplikasi terkoneksi sebagai pemilik tabel.

## Tata letak

| Path                                         | Apa yang tinggal di sana                                                |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `domain/comment-sanitization.ts`             | Perender escape-lalu-autolink. Tulang punggung keamanan.                |
| `domain/comment-policy.ts`                   | Terima/tolak plus status awal, dari mode kebijakan dan jenis penulis.   |
| `domain/comment-status.ts`                   | Mesin status moderasi dan transisi sahnya.                              |
| `domain/comment-thread.ts`                   | Pembangun pohon berkedalaman terbatas, batas keras 4.                   |
| `domain/comment-settings.ts`                 | Bentuk, nilai bawaan, validasi. Batasnya mencerminkan CHECK di sql/066. |
| `domain/anti-abuse.ts`                       | Honeypot, batas bawah waktu, istilah terblokir, sidik jari duplikat.    |
| `domain/timing-token.ts`                     | Token waktu-render bertanda-tangan HMAC.                                |
| `domain/subscriber-crypto.ts`                | AES-256-GCM untuk penerima notifikasi.                                  |
| `domain/commentable-resource-registry.ts`    | Menggabungkan + memvalidasi deskriptor yang dikontribusikan.            |
| `application/commentable-resource-engine.ts` | Kueri publikasi terparameter; resolusi URL.                             |
| `application/comment-service.ts`             | Submit, list, sunting, laporkan, permintaan-hapus.                      |
| `application/comment-moderation.ts`          | Antrean dan transisi milik moderator.                                   |
| `application/comment-retention.ts`           | Sapuan anonimisasi dan pembersihan langganan yang belum dikonfirmasi.   |

## Operasi

- `bun run comments:resources:check` — gerbang registry, bagian dari
  `bun run check`. Murni, tanpa basis data. Ia berjalan SEBELUM SQL apa pun
  dibangun, dan itulah intinya: mesinnya menginterpolasi pengidentifikasi yang
  dideklarasikan deskriptor.
- `bun run comments:retention` — sapuan terjadwal. Menganonimkan identitas
  penulis pada komentar yang menua **di tempat** (tidak pernah menghapus:
  riwayat moderasi yang hanya-tambah wajib tetap menunjuk ke sebuah baris),
  menambahkan event moderasi `anonymize`, dan menghapus langganan balasan yang
  belum dikonfirmasi. Melewati tenant mana pun yang berada di bawah legal hold
  aktif pada `comments.comments`.

## Konfigurasi

Kedua secret bersifat opsional dan keduanya menurun dengan aman, itulah sebabnya
`security:readiness` melaporkannya sebagai peringatan alih-alih temuan kritis —
lihat `.env.example` untuk teks lengkapnya.

- `COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` — 32 byte base64. Tidak diset berarti
  notifikasi balasan tak bisa dikirim; tidak pernah ada alamat teks polos yang
  ditulis.
- `COMMENTS_TIMING_SECRET` — tidak diset berarti kunci acak per-proses, sehingga
  token tidak bertahan melewati restart dan pengunjung diminta mengirim ulang.
- `COMMENTS_RETENTION_DAYS` — bawaan 365.

## Tindak lanjut, sengaja tidak ada dalam port ini

- **Dispatcher notifikasi balasan.** Event-nya sudah diterbitkan
  (`awcms.comments.reply.created`, `awcms.comments.comment.approved`); konsumen
  email yang meresolusikan penerima terenkripsi lalu mengirim belum ditulis.
  Komentar berfungsi penuh tanpanya.
- **Komponen formulir komentar publik.** API-nya sudah lengkap; basis ini belum
  punya pustaka `src/components/ui/` (satu baris roadmap Gelombang-0 yang masih
  terbuka), dan sebuah tema menyediakan formulirnya sendiri.
- **Turnstile pada formulir komentar.** `turnstileEnabled` ada di pengaturan dan
  dihormati oleh skemanya, tetapi panggilan verifikasinya belum dikaitkan ke
  jalur submit. Ia wajib berjalan DI LUAR transaksi basis data saat nanti
  dikaitkan (ADR-0006).
