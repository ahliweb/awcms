🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](public-form-challenge.md)

<!-- i18n-source-hash: sha256:37b03360aec6dc6269ba8b94770f81c6157b63d4b2e465745ab5fa6158ad8e29 -->

# Seam challenge (captcha) form publik

Referensi implementasi Issue #1353 (keputusan pemilik K9, 22 November 2026). Kontrak modul `4.8.0`. **Tanpa migration.** Cloudflare Turnstile ([ADR-0029](../adr/0029-deployment-profile-aware-turnstile-bot-protection.md), `turnstile-bot-protection.md`) adalah provider pertama di belakangnya, dan call site per-rute-nya yang dulu kini lewat seam ini, jadi hanya ada **satu** jalur.

## 1. Apa ini

Form pra-sesi (login, lupa/reset password, register, terima undangan, setup platform, atau form publik milik modul) memilih ikut challenge kehadiran manusia dengan satu panggilan:

```ts
const refused = await enforcePublicFormCaptcha(request, "my_form", body, {
  clientIp
});
if (refused) return refused;
```

Tanpa mengedit berkas bersama. `src/lib/security/public-form-challenge.ts` memiliki seam; modul menyumbang provider dari descriptor-nya sendiri (`ModuleDescriptor.publicFormChallengeProviders`, model ADR-0164: seam membaca daftar modul lewat extension-point source yang dipasang `src/middleware.ts`). Platform hanya mengirim satu provider, Turnstile, dideklarasikan `identity-access`. Ia tidak mengirim widget atau teka-teki sendiri.

**Rate limit tiap rute tetap kontrol utama.** Ia berjalan sebelum seam dan tidak dilonggarkan olehnya.

## 2. Kontrak, sesuai urutan penegakannya

| Properti                | Perilaku                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mati secara default     | Tidak ada provider terdeklarasi yang dinyalakan `isEnabled(env)`-nya sendiri berarti panggilan mengembalikan `null`; deployment yang tidak menyetel apa pun berperilaku persis seperti sebelumnya. Turnstile hidup hanya dengan gerbang profil full-online dan `TURNSTILE_ENABLED=true`.                             |
| Satu provider           | Lebih dari satu provider menyala adalah kesalahan konfigurasi dan permintaan **ditolak**. Provider yang `isEnabled`-nya melempar juga ditolak, tidak pernah dianggap mati.                                                                                                                                           |
| Fail-closed             | Token hilang, verifier menolak, verifier yang **melempar**, yang tak menjawab dalam 10 dtk, dan hasil selain persis `{ ok: true }` semuanya menolak permintaan. Teks error verifier tidak pernah dicatat atau dikembalikan.                                                                                          |
| Sekali pakai            | Token yang disajikan dibakar (di-hash, dibatasi 10 000 entri, 15 menit, per proses) **sebelum** verifier ditanya, sehingga replay ditolak walau permintaan berpacu, dan percobaan yang ditolak tak bisa diulang dengan token sama. `verify` provider adalah sumber kebenaran lintas proses; ini pertahanan berlapis. |
| Terikat form dan tenant | `verify` menerima nama form dan tenant (`x-awcms-tenant-id`, atau opsi `tenantId`, atau `null` untuk form tanpa tenant) dan wajib menolak token yang diterbitkan untuk yang lain. Turnstile mengikat form (`action`-nya) dan hostname; ia tak punya konsep tenant, jadi ikatan tenantnya adalah host deployment.     |
| Tanpa oracle            | Semua selain "tidak ada yang disajikan" adalah satu respons: form salah, tenant salah, replay, kedaluwarsa, error verifier dan timeout tak terbedakan. "Tidak ada yang disajikan" adalah `CHALLENGE_REQUIRED` agar klien tahu harus menampilkan widget-nya.                                                          |
| Masukan terbatas        | Field lebih dari 4 096 karakter ditolak tanpa menjangkau verifier; field non-string dianggap tidak ada.                                                                                                                                                                                                              |

## 3. Kontrak provider

`ModulePublicFormChallengeProvider` (`src/modules/_shared/public-form-challenge-contract.ts`): `key`, `isEnabled(env)`, `issue(formName, tenantId) -> challenge`, `verify({ token, challengeId, challengeAnswer, formName, tenantId, remoteIp, env }) -> { ok: true } | { ok: false, reason }`, dan opsional `legacyTokenField`, `refusal` (kode dan pesan dari kontrak yang sudah terbit; Turnstile mempertahankan `TURNSTILE_REQUIRED` / `TURNSTILE_INVALID` dan field `turnstileToken`) serta `solveForTests`. Challenge aritmetika self-hosted dan provider pihak ketiga sama-sama implementasi yang sah; `issuePublicFormChallenge(formName, tenantId)` adalah pintu masuk server untuk endpoint yang menyerahkan challenge ke klien (platform tidak mengirim endpoint itu, karena tak ada provider miliknya yang membutuhkan).

Provider yang verifier-nya membaca **secret khusus-web** (`TURNSTILE_SECRET_KEY` Turnstile) wajib menjaga descriptor-nya RINGAN: `listModules()` di-import puluhan job, sehingga meng-import berkas pembaca secret akan memasukkannya ke import closure mereka (`tests/jobs-env-scoped-reach.test.ts`, bagian c, gagal, dan secret harus disalin ke setiap container job). `verify`/`issue`-nya karena itu me-resolve implementasi dari slot verifier (`_shared/public-form-challenge-verifier-slot.ts`) yang diisi `src/lib/security/public-form-challenge-bindings.ts`; seam meng-import berkas itu, jadi setiap proses yang menegakkan challenge punya binding-nya, dan tak ada job yang punya. Tanpa binding, `verify` melempar, yang ditolak seam. Provider tanpa secret khusus-web cukup mengimplementasi `verify` di descriptor-nya.

`bun run extension-points:check` memvalidasi deklarasi (key snake_case unik, tiga fungsi ada, kode penolakan wajar) dan menolak panggilan langsung `enforceTurnstileIfRequired` di luar `turnstile.ts` dan provider Turnstile: panggilan langsung adalah jalur kedua yang melewati pembakaran, tenggat, dan penolakan seragam.

## 4. Klien

Kontrak field: `challengeId`, `challengeAnswer`, `challengeToken`. `src/lib/ui/public-form-challenge-client.ts` membacanya dari form yang dikirim (`readChallengeFields`, yang juga membaca `cf-turnstile-response` Turnstile sebagai `challengeToken`) supaya halaman menyebarkannya ke body JSON, dan `focusChallengeOnRefusal` mengembalikan fokus ke elemen bertanda `data-challenge-widget` bila kode respons adalah penolakan challenge. Tanpa widget di halaman, helper mengembalikan `{}`, sehingga body persis seperti sebelumnya. Skrip halaman wajib **meng-import** helper: Astro meng-inline skrip tanpa import dan CSP aplikasi ini memblokir skrip inline.

Merender widget bersifat khusus-provider dan tetap di halaman yang menyalakan provider itu. Halaman lupa dan reset password memakai helper; `/reset-password` kini juga merender widget Turnstile (sebelumnya API reset mewajibkan token yang tak bisa dihasilkan halaman saat Turnstile hidup).

## 5. Harness integrasi

`invoke()` di `tests/integration/harness.ts` menambahkan challenge **terselesaikan** ke body JSON form pra-sesi platform bila provider menyala dan menawarkan `solveForTests`, sehingga suite tak perlu edit per rute. `challenge: false` memilih keluar (untuk menguji penolakan); field yang sudah ada di body tak pernah ditimpa. Tanpa provider menyala, yaitu default, tak ada yang berubah.

## 6. Titik terbuka

- Pembakaran sekali-pakai bersifat per proses. Provider tanpa jaminan sekali-pakai sendiri bisa di-replay lintas proses; kontrak mewajibkan jaminan itu di provider.
- Form publik modul lain (newsletter, comments, sumber website-engagement) mempertahankan perlindungannya sendiri; masing-masing dapat ikut seam dengan satu panggilan.
