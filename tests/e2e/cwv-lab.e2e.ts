/**
 * Core Web Vitals — pengukuran LAB (ADR-0067 Opsi D, adendum 2026-08-05).
 *
 * NOL data pengunjung: spec ini menjalankan Chromium harness terhadap build
 * repo sendiri. Tidak ada skrip klien yang dikirim ke pengunjung, tidak ada
 * endpoint publik baru, tidak ada tabel, tidak ada sentuhan pada
 * `visitor_analytics` — postur privasi modul itu tidak berubah sedikit pun.
 *
 * Batas yang WAJIB ikut dibaca (ADR-0067 §Opsi D):
 *
 * - Angka di sini adalah angka LAB: satu mesin, satu jaringan, satu jalankan.
 *   Ia DETEKTOR REGRESI ("apakah perubahan ini membuat halaman lebih
 *   lambat?"), BUKAN p75 lapangan ("apa yang benar-benar dialami pengunjung
 *   kami?" — itu wilayah RUM/Opsi B, keputusan pemilik produk). Jangan pernah
 *   mengutip angka dari log spec ini seolah-olah Core Web Vitals lapangan.
 * - INP sengaja TIDAK diukur dan TIDAK diklaim: INP didefinisikan atas
 *   interaksi pengguna nyata sepanjang kunjungan; di lab tanpa interaksi
 *   nyata, angka yang keluar hanyalah artefak klik sintetis. Dari trio CWV,
 *   yang jujur terukur di lab adalah LCP dan CLS — maka hanya itu yang diukur.
 * - Gerbang yang tidak berjalan harus MENYATAKANNYA: saat `E2E_CWV_LAB` tidak
 *   diset, spec ini MENCETAK pernyataan skip yang jelas (bukan lolos senyap);
 *   dan saat berjalan, LCP yang tidak terekam (observer tidak menghasilkan
 *   entry) adalah KEGAGALAN, bukan kelulusan — gerbang yang "hijau" karena
 *   tidak mengukur apa-apa adalah gerbang yang membusuk.
 *
 * Halaman yang diukur: `/login` — permukaan publik nyata yang di-serve build
 * dan sudah disentuh suite E2E smoke (`login.e2e.ts`), sehingga tidak butuh
 * fixture/seed baru dan mengikuti harness yang sama persis.
 *
 * Run (konvensi suite E2E — pemanggil menyediakan server):
 * `bun run build && bun run start` di satu terminal, lalu
 * `E2E_CWV_LAB=1 bun run perf:cwv:lab` di terminal lain. Job CI `e2e-smoke`
 * men-set env-nya dan menjalankan spec ini sebagai bagian `bun run test:e2e`.
 */
import { test, expect } from "./support/e2e-read-wave";

/**
 * Ambang "baik" Core Web Vitals (https://web.dev/articles/vitals):
 * LCP ≤ 2500 ms, CLS ≤ 0,1. Di lapangan ambang ini dinilai pada p75 kunjungan
 * nyata; DI SINI ia dipakai sebagai batas kelulusan LAB satu mesin — halaman
 * yang sama, mesin yang sama, build yang berubah. Lulus di sini TIDAK berarti
 * p75 lapangan "baik"; gagal di sini berarti build ini meregresi halaman itu
 * di kondisi lab.
 */
const LCP_GOOD_LAB_MS = 2500;
const CLS_GOOD_LAB = 0.1;

/** Permukaan publik yang diukur — sama dengan yang disentuh E2E smoke. */
const MEASURED_PATH = "/login";

const enabled = process.env.E2E_CWV_LAB === "1";

if (!enabled) {
  // Pernyataan skip EKSPLISIT (batas ADR-0067 §Opsi D: gerbang lab yang tidak
  // berjalan harus menyatakannya). Playwright juga menandai test-nya skipped,
  // tetapi baris ini menjamin pernyataannya terlihat di log reporter apa pun.
  console.log(
    "[cwv-lab] SKIP: E2E_CWV_LAB tidak diset — pengukuran Core Web Vitals lab (ADR-0067 Opsi D) TIDAK berjalan. " +
      "Set E2E_CWV_LAB=1 dengan server build tersedia di E2E_BASE_URL untuk menjalankannya; job CI e2e-smoke melakukannya otomatis."
  );
}

/** Hasil yang dikumpulkan init-script di dalam halaman. */
type CwvSample = {
  /** Kedua entry type didukung browser (kalau tidak, ukurannya bohong). */
  supported: boolean;
  /** startTime entry `largest-contentful-paint` TERAKHIR, ms. 0 = tak terekam. */
  lcpMs: number;
  /**
   * CLS per definisi lapangan: nilai maksimum di antara "session window"
   * (jendela ≤ 5 s, gap antar-shift < 1 s), hanya shift tanpa input terkini.
   * Pada satu pemuatan lab tanpa interaksi biasanya identik dengan jumlah
   * seluruh shift, tetapi dihitung per definisi supaya angkanya sebanding
   * dengan literatur CWV.
   */
  cls: number;
};

test.describe("Core Web Vitals lab (ADR-0067 Opsi D)", () => {
  test.skip(
    !enabled,
    "E2E_CWV_LAB=1 tidak diset — gerbang CWV lab dinyatakan skip, lihat log [cwv-lab] (ADR-0067 Opsi D)"
  );

  test(`${MEASURED_PATH}: LCP dan CLS dalam ambang "baik" CWV — angka lab, bukan p75 lapangan`, async ({
    page
  }) => {
    // Observer dipasang SEBELUM skrip halaman mana pun berjalan (init script),
    // dengan `buffered: true` supaya entry yang terjadi sebelum observer aktif
    // tetap terbaca.
    await page.addInitScript(() => {
      const supportedTypes = PerformanceObserver.supportedEntryTypes ?? [];
      const state = {
        supported:
          supportedTypes.includes("largest-contentful-paint") &&
          supportedTypes.includes("layout-shift"),
        lcpMs: 0,
        cls: 0
      };
      (window as unknown as { __cwvLab: typeof state }).__cwvLab = state;
      if (!state.supported) return;

      // LCP: kandidat terakhir yang dilaporkan adalah nilainya (tanpa
      // interaksi pengguna, daftar kandidat berhenti sendiri saat halaman
      // stabil).
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.lcpMs = entry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });

      // CLS: session window ≤ 5 s dengan gap < 1 s, abaikan shift yang terjadi
      // ≤ 500 ms setelah input (hadRecentInput) — mengikuti definisi CWV.
      let windowValue = 0;
      let windowFirstTs = 0;
      let windowLastTs = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          };
          if (shift.hadRecentInput) continue;
          const inWindow =
            windowValue > 0 &&
            shift.startTime - windowLastTs < 1000 &&
            shift.startTime - windowFirstTs < 5000;
          if (inWindow) {
            windowValue += shift.value;
            windowLastTs = shift.startTime;
          } else {
            windowValue = shift.value;
            windowFirstTs = shift.startTime;
            windowLastTs = shift.startTime;
          }
          if (windowValue > state.cls) state.cls = windowValue;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    const response = await page.goto(MEASURED_PATH, {
      waitUntil: "networkidle"
    });
    expect(response?.status()).toBe(200);

    // Beri waktu layout menetap + observer buffered menyalurkan entry-nya —
    // LCP/CLS dilaporkan asinkron setelah paint, bukan tepat pada `load`.
    await page.waitForTimeout(1_000);

    const sample = await page.evaluate<CwvSample>(
      () => (window as unknown as { __cwvLab: CwvSample }).__cwvLab
    );

    // Gerbang yang tidak mengukur harus GAGAL menyatakannya, bukan lolos:
    // browser tanpa dukungan entry type, atau LCP yang tidak pernah terekam,
    // berarti tidak ada pengukuran — bukan pengukuran yang bagus.
    expect(
      sample.supported,
      "browser harness tidak mendukung largest-contentful-paint/layout-shift — pengukuran CWV lab TIDAK terjadi"
    ).toBe(true);
    expect(
      sample.lcpMs,
      "tidak ada entry largest-contentful-paint yang terekam — pengukuran CWV lab TIDAK terjadi"
    ).toBeGreaterThan(0);

    // Angka lab dicetak ke log supaya tercatat per-run di CI — sebagai jejak
    // regresi, BUKAN untuk dikutip sebagai p75 lapangan.
    console.log(
      `[cwv-lab] ${MEASURED_PATH} LCP=${sample.lcpMs.toFixed(0)}ms (ambang lab ${LCP_GOOD_LAB_MS}ms) ` +
        `CLS=${sample.cls.toFixed(4)} (ambang lab ${CLS_GOOD_LAB}) — angka LAB satu mesin, bukan p75 lapangan`
    );

    expect(sample.lcpMs).toBeLessThanOrEqual(LCP_GOOD_LAB_MS);
    expect(sample.cls).toBeLessThanOrEqual(CLS_GOOD_LAB);
  });
});
