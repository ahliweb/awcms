---
"awcms": minor
---

feat(access): grandfathering entitlement, dan laporan blast-radius yang wajib dijalankan LEBIH DULU (ADR-0084, #423)

Gelombang 5 PR 5.3. `bun run entitlements:backfill` (dry-run default, `--commit`
menulis, `--tenant <code>` untuk rollout bertahap) plus cek baru di
`bun run security:readiness`: _"N tenant akan mulai menerima 403
ENTITLEMENT_REQUIRED untuk X"_.

**Kenapa laporan itu ada di `security:readiness` dan bukan hanya di skripnya.**
Skripnya mencetak angka yang sama, tetapi ia perintah yang harus Anda tahu ada —
dan kesalahan yang ditangkap cek ini dibuat oleh orang yang tidak tahu.
Severity-nya `warning`, tak pernah `critical`: tenant yang akan ditolak adalah
fakta KOMERSIAL, dan gerbang kesiapan yang memblokir go-live karena seseorang
belum membayar adalah alat keamanan yang mengambil keputusan tagihan.

**Kenapa grandfathering boleh menjadi selimut di sini, padahal backfill
permission tidak boleh.** `owner-permission-backfill.ts` menolak memberikan ulang
apa pun yang LEBIH TUA dari peran owner, karena permission yang hilang bisa saja
DICABUT sengaja dan backfill tak bisa membedakannya dari "tak pernah diberikan".
Entitlement tak punya sejarah itu: skemanya mendarat KOSONG (`sql/109`), jadi
baris yang absen hanya bisa berarti "sebelum entitlement ada".

Asimetri itu KEDALUWARSA pada pencabutan pertama — dan di situlah aturan
`tenant_newer_than_entitlement` menarik garisnya: tenant yang lebih baru dari
baris katalog entitlement-nya DILAPORKAN, tak pernah diberikan ulang. Seri
dihitung sebagai "lebih baru": tidak memberi bisa diperbaiki manusia, memberi
diam-diam tidak.

Laporan blast-radius DITURUNKAN dari rencana backfill yang sama, bukan dari query
kedua yang ditulis agar mirip. Dua penurunan atas "siapa yang kekurangan ini"
adalah dua kesempatan menjawab berbeda, dan seluruh nilai laporan ini adalah ia
bisa dipercaya pada hari ia mengatakan nol.
