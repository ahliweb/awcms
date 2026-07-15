---
name: awcms-ux-review
description: Audit dan tingkatkan kualitas UI/UX AWCMS di atas baseline design system. Gunakan saat diminta "review UX", "perbaiki tampilan/usability", audit aksesibilitas, atau menaikkan kualitas layar admin/POS/portal yang sudah ada. Berbeda dari awcms-ui-screen (membangun layar baru sesuai standar) — skill ini menilai & menaikkan mutu layar yang sudah jadi.
---

# AWCMS — UI/UX Improvement Review

Sumber kebenaran: **`docs/awcms/14_ui_ux_design_system.md`** (token, komponen, state pattern, a11y, i18n, theming) dan **`docs/awcms/15_frontend_architecture_integration.md`** (SSR/islands, API client, offline). Skill ini **peningkatan** — bukan membangun dari nol (itu `awcms-ui-screen`), melainkan menemukan gap kualitas dan menaikkannya.

## Prinsip peningkatan

Ukur dulu, baru ubah: identifikasi masalah nyata (heuristik usability, hasil axe/kontras, layout shift) sebelum menyentuh kode. Perbaikan UX **tidak boleh** melemahkan kontrol backend (UI hiding bukan otorisasi) atau membocorkan data sensitif.

## Checklist audit

- [ ] **Empat state lengkap** — setiap list/detail punya loading (skeleton, bukan spinner kosong), empty (+CTA), error (`StateNotice.astro`, `src/components/ui`, Issue #434 — bedakan "akses ditolak" dari "gagal sementara"; sebelumnya kegagalan SSR = 500 mentah tanpa jalur render sama sekali di beberapa layar), ready. Cari layar yang hanya render "ready".
- [ ] **A11y WCAG 2.1 AA** — kontras ≥4.5:1 (teks) / ≥3:1 (UI/grafik) — pakai `--color-*-strong` (Issue #434) untuk teks putih di atas warna solid, varian polos sering <4.5:1; fokus terlihat, label eksplisit tiap input, `aria-*` benar, dialog trap fokus + `Esc`, status tak hanya lewat warna, target sentuh ≥44px di mobile. **Verifikasi kontras/CSP/interaksi nyata butuh browser sungguhan** (headless-Chrome/CDP) — curl/HTML statis tidak mengeksekusi JS/CSS sehingga tidak bisa mendeteksi elemen yang secara visual tidak berfungsi (contoh nyata: CSP hash manual yang salah pernah membuat tombol tema tak merespons klik sama sekali, Issue #437 — hanya ketahuan lewat sesi CDP nyata, bukan mental-pass).
- [ ] **Keyboard-only** — semua aksi tercapai tanpa mouse; POS mengikuti peta F1–F10 (doc 14); urutan tab logis; skip-link bila perlu (`AdminLayout.astro`, Issue #434).
- [ ] **Perceived performance** — tanpa layout shift (reserve ruang gambar/tabel), optimistic update dengan rollback (POS cart), no flash of wrong theme, feedback <100ms untuk aksi lokal.
- [ ] **Konsistensi token/komponen** — tak ada warna/ukuran/spacing hardcode; pakai `--color-*`/`--sp-*`/`--fs-*`; komponen dari `src/components/ui`, bukan duplikat ad-hoc.
- [ ] **Dark/light parity** — kedua tema diuji; kontras & keterbacaan setara; `data-theme` konsisten.
- [ ] **Responsif** — admin desktop-first tapi tetap usable di tablet; portal customer mobile-first; tak ada horizontal scroll tak sengaja; tabel lebar → scroll container (`overflow-x: auto`, Issue #434).
- [ ] **Form UX** — validasi inline + pesan spesifik per field (bukan hanya banner), disable saat submit + cegah double-submit (`lockElement`, `src/lib/ui/admin-form-client.ts`, Issue #434 — `disabled`+`aria-busy` selama request, reuse jangan duplikasi per halaman), preserve input saat error, autocomplete/inputmode tepat.
- [ ] **Micro-copy & i18n-ready** — teks jelas, ringkas, konsisten istilah (doc 19 glossary); lihat skill `awcms-i18n` untuk detail katalog `.po`/locale/formatter — cari string hardcode yang lolos ekstraksi sebelumnya (komponen kecil seperti theme toggle sering terlewat, Issue #434).
- [ ] **Masking di UI** — data sensitif lewat `MaskedText`; tak ada PII mentah tercache di IndexedDB/localStorage.
- [ ] **Offline-first terlihat** — status koneksi & antrean sync jelas (`SyncIndicator`/`OfflineBanner`); aksi tetap tersimpan lokal saat offline (doc 15).

## Heuristik usability (Nielsen, ringkas)

Visibilitas status sistem · kecocokan dengan dunia nyata · kontrol & kebebasan user (undo/cancel) · konsistensi & standar · pencegahan error (konfirmasi aksi destruktif) · recognition over recall · fleksibilitas (shortcut) · desain minimalis · pesan error membantu pemulihan · bantuan/dokumentasi bila perlu.

## Output

Daftar temuan berperingkat (blocker a11y → mayor → minor → polish), tiap temuan: lokasi (file/komponen), dampak ke user, dan patch yang disarankan. Verifikasi: 4 state dapat didemokan, keyboard-only pass, axe/kontras pass AA (browser sungguhan, bukan cuma HTML statis), tak ada string/warna hardcode, tak ada `fetch` mentah (lewat `submitJson`/`apiFetch` — pakai yang sudah ada di halaman itu, jangan campur pola).

## Skill terkait

`awcms-ui-screen` (membangun layar sesuai standar), `awcms-i18n` (katalog `.po`, locale, formatter), `awcms-sensitive-data` (masking), `awcms-testing` (render/state test), `awcms-performance` (waktu muat & data fetching).
