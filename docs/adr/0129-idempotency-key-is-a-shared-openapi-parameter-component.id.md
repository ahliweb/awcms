🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0129-idempotency-key-is-a-shared-openapi-parameter-component.md)

<!-- i18n-source-hash: sha256:48ea728e0b35521fbe171d54760b34995bf4a6c4c73e7d6a263edbf9f3103ee2 -->

# ADR-0129 — `Idempotency-Key` adalah komponen parameter OpenAPI bersama

- **Status:** Diterima
- **Tanggal:** 2026-10-05
- **Pengambil keputusan:** ahliweb
- **Mengubah:** [ADR-0026](0026-modular-openapi-ownership-and-composition.id.md) (fragmen root memiliki komponen yang benar-benar bersama; ADR ini menerima satu parameter bersama lagi) — amandemen, bukan pengganti
- **Terkait:** Issue #896; PR #893 (batas itu sendiri); `src/lib/security/idempotency-key-bound.ts`; `openapi/awcms-public-api.src.yaml`; `tests/openapi-idempotency-key-component.test.ts`

## Konteks

PR #893 membuat middleware menolak `Idempotency-Key` di luar 1 sampai 255 karakter ASCII terlihat dengan `400 IDEMPOTENCY_KEY_INVALID`, sebelum handler rute mana pun berjalan. Setiap operasi yang menerima header itu mendeklarasikannya inline (93 deklarasi di 21 berkas, 84 tanpa batas sama sekali dan 9 hanya `maxLength: 255`), sehingga kontrak tidak menyebut aturan yang berlaku di semua rute. Batas itu hanya terdokumentasi di `docs/awcms/database-pooling.md` dan skill `awcms-idempotency`.

Dua pendekatan terbuka: menambah `maxLength` dan `pattern` ke tiap deklarasi inline (dijaga sinkron oleh codemod dan gate), atau menerima satu komponen parameter bersama.

## Keputusan

1. **Satu komponen bersama, `components.parameters.IdempotencyKey`**, di fragmen root di samping `CorrelationId`: `in: header`, `name: Idempotency-Key`, `required: true`, `schema` `type: string`, `minLength: 1`, `maxLength: 255`, `pattern: "^[!-~]{1,255}$"`. Deskripsinya menyatakan penolakan `400 IDEMPOTENCY_KEY_INVALID`. Fragmen modul merujuknya dengan `$ref: "#/components/parameters/IdempotencyKey"`, seperti yang sudah dilakukan untuk `CorrelationId`.
2. **`required` tidak bervariasi.** Ke-93 deklarasi inline semuanya `required: true`, jadi satu komponen tidak kehilangan informasi. Bila suatu rute kelak butuh header opsional, ia menambah komponen bernama kedua (misalnya `IdempotencyKeyOptional`) — tidak pernah override inline.
3. **Komponen sepakat dengan runtime.** `IDEMPOTENCY_KEY_MAX_LENGTH` dan `IDEMPOTENCY_KEY_PATTERN` di `src/lib/security/idempotency-key-bound.ts` tetap satu-satunya sumber kebenaran; sebuah tes menegaskan `maxLength`/`minLength`/`pattern` OpenAPI menerima dan menolak persis seperti pola runtime.
4. **Gate melarang deklarasi inline.** `tests/openapi-idempotency-key-component.test.ts` (bagian dari `bun run test`, jadi `bun run check`) gagal pada parameter `name: Idempotency-Key` mana pun di `openapi/awcms-public-api.src.yaml` atau `openapi/modules/*.yaml`, sehingga modul baru tidak dapat memunculkan lagi deklarasi tanpa batas.
5. **Snapshot pra-migrasi yang dibekukan tidak disunting.** `tests/openapi-bundle.test.ts` kini membandingkan `components.parameters` dan setiap path pra-migrasi dengan parameter `Idempotency-Key` disisihkan di kedua sisi (deklarasi inline di snapshot, `$ref` di bundle), dan menegaskan `IdempotencyKey` adalah satu-satunya komponen parameter yang ditambahkan. Ini satu-satunya perubahan terkaji pada kontrak itu: parameter memperoleh batas, penyempitan bagi pemanggil yang sudah mengirim nilai di luar batas.

## Konsekuensi

- **Positif:** batas terlihat di kontrak dan di referensi ter-generate; satu tempat untuk mengubah; gate menjaganya.
- **Netral:** tanpa migrasi, endpoint, event, atau perubahan runtime. `info.version` tidak berubah.
- **Negatif:** konsumen yang men-generate klien dari bundle melihat `$ref` menggantikan parameter inline, dan kini melihat batas panjang. Perilakunya sudah ditegakkan di tepi.

## Alternatif yang dipertimbangkan

- **`maxLength`/`pattern` inline di setiap deklarasi plus gate codemod** — ditolak: 93 salinan satu aturan, dan gate yang harus memeriksa teks tiap salinan alih-alih satu definisi.
- **Mendokumentasikan batas hanya dalam prosa** — ditolak: itulah keadaan yang diperbaiki ADR ini.
