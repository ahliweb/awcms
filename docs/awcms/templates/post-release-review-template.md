# Post-release review — v<X.Y.Z>

- **Tag:** `v<X.Y.Z>` · **Di-deploy:** `<tanggal>` · **Ditulis:** `<tanggal>`
- **Penulis:** `<nama>`

## Apa yang masuk

Satu paragraf, bukan daftar changeset. Yang dicari pembaca enam bulan lagi
adalah **bentuk** rilis ini: perubahan fondasi, penambahan fitur, atau
perbaikan.

## Apa yang terjadi saat bertemu produksi

- Deploy: mulus / bermasalah — dan bila bermasalah, apa yang gagal.
- Migrasi: berapa lama, dan apakah ada yang mengunci sesuatu.
- Validasi produksi (langkah 17): apa yang diperiksa, apa yang ditemukan.
- Yang pertama kali terlihat di produksi dan **tidak** terlihat di CI.

Baris terakhir adalah yang paling berharga. ADR-0083 menerima bahwa repo ini
tidak punya staging, dan **harga keputusan itu dibayar tepat di baris ini** —
mengumpulkannya rilis demi rilis adalah satu-satunya cara mengetahui apakah
harganya masih pantas.

## Kejutan

Apa pun yang tidak sesuai perkiraan, termasuk yang menyenangkan. "Tidak ada"
adalah jawaban yang sah dan harus ditulis.

## Apa yang berubah karenanya

Perubahan konkret: gerbang baru, langkah runbook, dokumen yang dikoreksi, atau
issue yang dibuka. **Bila tidak ada, katakan tidak ada** — review yang selalu
menghasilkan tindakan adalah review yang mengarang tindakan.

Rekomendasi yang mengubah arah pekerjaan tetap ditulis ke `PROJECT_STATE.md` §4;
di sini cukup tautannya.
