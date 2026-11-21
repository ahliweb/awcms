🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](provider-outcome-contract.md)

<!-- i18n-source-hash: sha256:6c4d2932503f3c84cbd1ff86e897e1dcab8a711df777e13418c98078907d6cad -->

# Taksonomi hasil pihak ketiga dan kebijakan routing default-deny

Isu #1410. Kode: [`src/lib/integration/provider-outcome.ts`](../../src/lib/integration/provider-outcome.ts). Tes: `tests/provider-outcome-contract.test.ts`. Versi kontrak: `PROVIDER_OUTCOME_CONTRACT_VERSION = "1.0.0"`.

## Apa ini, dan apa bukan

**Pustaka keputusan murni, berversi, netral-provider.** Tanpa I/O, tanpa membaca environment, tanpa menyimpan kredensial, dan tidak pernah memanggil provider.

Ini **bukan** dispatcher, gateway, antrean, atau klien. Tiap domain tetap memegang port, outbox, dan ledger-nya sendiri ([ADR-0006](../adr/0006-offline-first-sync-outbox.md): provider dipanggil di luar transaksi DB, lewat outbox). Yang dibagi hanya kosakata dan aturan "apa yang boleh saya lakukan berikutnya?", agar adapter email, WhatsApp, push, pembayaran, dan object-sync berhenti mengarang versinya sendiri-sendiri. Ini searah dengan rekonsiliasi integration-hub (pustaka bersama murni, bukan hub; port/outbox milik domain).

**Belum ada adapter hidup yang memanggilnya.** Adopsi (mis. `skipped` / `uncertain` / `retryAfterMs` pada port email, lihat `src/modules/email/domain/email-provider-contract.ts`) adalah perubahan terpisah per domain dan opt-in. Tidak ada flag produksi dan tidak ada yang perlu dinyalakan.

## Hasil

| Hasil              | Arti                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `succeeded`        | Provider menyatakan pekerjaan selesai (terkirim, terselesaikan).                                 |
| `accepted`         | Provider menerima permintaan; penyelesaian belum diketahui. **Diterima bukan terkirim/settled.** |
| `not_sent`         | Terbukti tidak ada yang sampai ke provider, atau ditolak sebelum diproses (HTTP 429).            |
| `confirmed_failed` | Provider menyatakan secara otoritatif tidak melakukannya. Membawa `failureScope`.                |
| `unknown`          | Permintaan mungkin diproses, mungkin tidak.                                                      |

`classifyProviderCall(evidence)` memetakan bukti mentah ke satu hasil, default-deny:

- circuit terbuka, validasi lokal, koneksi ditolak, kegagalan DNS: `not_sent`.
- timeout / reset / body tak terbaca setelah pengiriman mungkin terjadi: `unknown`.
- HTTP 2xx: dinilai dari verdict **body**. `failure` menjadi `confirmed_failed` (200 dengan `success:false` adalah kegagalan); `success` menjadi `accepted`, atau `succeeded` hanya bila ditandai `final`; verdict tak dikenali menjadi `unknown`, tidak pernah dianggap sukses.
- 429: `not_sent` dengan `Retry-After` (detik atau HTTP-date) dibatasi ke `MAX_RETRY_AFTER_MS` (5 menit); yang tak terparse atau negatif diabaikan.
- 401/402/403: `confirmed_failed`, scope `provider` (kredensial/saldo; provider lain mungkin berhasil). 4xx lain: `confirmed_failed`, scope `request`. 408, 409, 3xx, 5xx: `unknown`.

## Keputusan

`decideRouting(input)` mengembalikan salah satu dari `hold | retry_same | switch_provider | reconcile | manual_review`, ditambah `complete` untuk sukses terminal, dengan `reason` terbaca-mesin dan versi kontrak.

Masukan: jenis operasi (`read_only | write | financial | notification`), hasil, apakah provider setara-tersertifikasi tersedia, consent (`granted | not_required | missing`), dukungan idempotency, correlation id, anggaran (percobaan provider sama, perpindahan), apakah rekonsiliasi tersedia, dan kebijakan.

Aturan, menurut urutan berlaku:

1. Masukan cacat: `manual_review` (default-deny).
2. `succeeded`: `complete`.
3. Operasi non-baca tanpa correlation id: `manual_review` bila panggilan mungkin sampai ke provider, selain itu `hold`.
4. `accepted`: `reconcile` (atau `manual_review` tanpa rekonsiliasi). Tidak pernah diulang, tidak pernah dipindah.
5. `unknown`: **finansial** adalah `reconcile`/`manual_review`, tidak pernah `retry_same` atau `switch_provider`. Read-only diulang selama anggaran ada. Write/notification diulang di provider yang sama hanya bila provider mendukung idempotency dan consent ada; selain itu `reconcile` atau `manual_review`. **Tidak pernah `switch_provider`.**
6. `confirmed_failed` ber-scope request: `manual_review` (permintaan buruk gagal sama di mana-mana).
7. `not_sent`: `hold` tanpa consent; `retry_same` selama anggaran ada (menghormati `retryAfterMs`); lalu failover atau `manual_review`.
8. Failover (`not_sent` setelah anggaran habis, atau `confirmed_failed` ber-scope provider) menuntut **semua**: `policy.failoverEnabled` (default **mati**), provider setara-tersertifikasi, consent, anggaran perpindahan, dukungan idempotency untuk operasi non-baca, dan untuk operasi finansial juga `policy.financialFailoverAuthorized`. Domain mengisinya dari keputusan yang berwenang, tidak pernah dari masukan klien.

Sifat-sifat ini ditegakkan tes atas seluruh perkalian kombinasi: `accepted`/`unknown` tidak pernah menghasilkan `switch_provider`; `accepted`/`unknown` finansial hanya menghasilkan `reconcile` atau `manual_review`; `switch_provider` mengimplikasikan semua prasyarat di atas; kebijakan bawaan tidak pernah berpindah; keputusan deterministik.

## Catatan ancaman dan privasi

- **Tidak ada host atau kredensial provider dari klien.** Kontrak tidak menerima keduanya; hanya klasifikasi dan boolean. Pemilihan provider, endpoint, dan secret tetap di konfigurasi domain. SSRF karena itu di luar permukaan modul ini; adapter yang mengambil URL jarak jauh menjaga guard-nya sendiri (ADR-0106).
- **Secret.** Bukti hanya membawa kode status, verdict, dan nilai header, tidak pernah body request/response atau kredensial. Pemanggil tidak boleh memasukkan teks galat provider ke `reason`; alasan adalah enum tertutup.
- **Pemalsuan tenant.** Pustaka tidak mengenal tenant dan tidak mengakses data. Correlation id dan konteks tenant datang dari domain, yang menjaga ABAC default-deny dan RLS di batasnya sendiri; correlation id tidak boleh diambil dari permintaan tak terautentikasi.
- **Replay webhook.** Masukan rekonsiliasi berupa webhook tetap memerlukan pemeriksaan tanda tangan dan anti-replay domain penerima (lihat `awcms-sync-hmac`); kontrak ini hanya menyatakan bahwa `accepted`/`unknown` harus diselesaikan oleh bukti semacam itu atau manusia, bukan oleh provider lain.
- **Penyalahgunaan Retry-After.** Provider yang jahat atau cacat tidak bisa menahan pekerjaan lebih dari 5 menit lewat header itu.

## Mengubah kontrak

Setiap perubahan semantik klasifikasi atau keputusan menaikkan `PROVIDER_OUTCOME_CONTRACT_VERSION` dan matriks tes. Tidak ada perubahan OpenAPI atau AsyncAPI: tidak ada endpoint atau event yang ditambahkan.
