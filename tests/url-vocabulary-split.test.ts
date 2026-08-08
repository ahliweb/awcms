/**
 * ADR-0071 §4 must agree with the filesystem it schedules work against.
 *
 * ## Why this gate exists at all
 *
 * ADR-0071 splits the family's public URL vocabulary — `/blog/**` here,
 * `/news/**` in `awcms-astro` — and the rule takes effect the day it lands.
 * The code does not: the four `/news/**` routes ADR-0059 built are still served,
 * and `publicRouteMode` still defaults to `domain_default`, so they are ON for
 * every tenant that has not turned them off. §4 states that window openly.
 *
 * A stated window is a promise, and this repo's whole convention is that a
 * promise without a checker is a promise that gets forgotten. The natural
 * mechanism — `Accepted (belum diimplementasikan)` and
 * `tests/adr-implementation-status.test.ts` — CANNOT be used here, and the
 * reason is worth writing down because it will come up again: that gate binds
 * the qualifier to the PRESENCE of promised artifacts (absent → qualified,
 * present → plain). ADR-0071 promises a REMOVAL, so the direction is inverted,
 * and rule (d) of that gate forbids the qualifier off-map. Hence this gate:
 * same two-way discipline, opposite shape of promise.
 *
 * ## What it enforces
 *
 * - (a) routes present → §4 MUST read `BELUM DILAKSANAKAN`;
 * - (b) routes absent  → §4 MUST read `SUDAH DILAKSANAKAN` — removing them
 *   forces the flip in the same PR;
 * - (c) exactly one marker — an ADR carrying both says nothing;
 * - (d) the ADR file itself must exist, so the gate cannot pass by vacuity.
 *
 * The decision logic is a pure function over an injected snapshot and is
 * mutation-proven below: each direction has a test feeding it the defect it
 * must catch. No database, no network.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = process.cwd();

const ADR_PATH = path.resolve(
  REPO_ROOT,
  "docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md"
);

/**
 * The route files ADR-0071 §4.1 schedules for removal. ANY of them surviving
 * means the removal has not happened — a half-removed family is still a family
 * this repo serves, so the gate treats it as outstanding rather than done.
 */
const NEWS_ROUTE_FILES = [
  "src/pages/news/index.ts",
  "src/pages/news/[slug].ts",
  "src/pages/news/category/[slug].ts",
  "src/pages/news/tag/[slug].ts"
] as const;

/**
 * The marker carries a prefix on purpose. An earlier draft matched the bare
 * words and counted TWO: §4's own step list tells the implementer to flip the
 * marker, so it spells the target state in prose. A status marker that its own
 * instructions can trip is a marker that reports on its wording, not its state.
 */
const MARKER_PREFIX = "**Status pelaksanaan §4:**";
const MARKER_OUTSTANDING = `${MARKER_PREFIX} BELUM DILAKSANAKAN`;
const MARKER_DONE = `${MARKER_PREFIX} SUDAH DILAKSANAKAN`;

export type VocabularySplitSnapshot = {
  /** Whether the ADR file was found at all. */
  adrExists: boolean;
  /** Route files from `NEWS_ROUTE_FILES` that still exist. */
  survivingRoutes: readonly string[];
  /** How many times each marker appears in the ADR body. */
  outstandingMarkers: number;
  doneMarkers: number;
};

export type VocabularySplitVerdict = {
  ok: boolean;
  /** Empty when `ok`; one entry per rule violated otherwise. */
  problems: readonly string[];
};

/**
 * Decide whether ADR-0071 §4 tells the truth about the filesystem.
 *
 * Pure on purpose: the filesystem read happens once, in the test below, so the
 * rule itself can be fed the defects it must catch without touching disk.
 */
export function decideVocabularySplit(
  snapshot: VocabularySplitSnapshot
): VocabularySplitVerdict {
  const problems: string[] = [];

  if (!snapshot.adrExists) {
    return {
      ok: false,
      problems: [
        "ADR-0071 tidak ditemukan. Gerbang ini tidak boleh lolos karena ADR-nya hilang — " +
          "sebuah aturan yang berkasnya dihapus adalah aturan yang dicabut tanpa keputusan."
      ]
    };
  }

  const totalMarkers = snapshot.outstandingMarkers + snapshot.doneMarkers;
  if (totalMarkers !== 1) {
    problems.push(
      `ADR-0071 §4 wajib memuat TEPAT SATU penanda pelaksanaan; ditemukan ${totalMarkers} ` +
        `(${snapshot.outstandingMarkers}× "${MARKER_OUTSTANDING}", ${snapshot.doneMarkers}× "${MARKER_DONE}"). ` +
        "ADR yang memuat keduanya tidak menyatakan apa pun."
    );
    return { ok: false, problems };
  }

  const routesSurvive = snapshot.survivingRoutes.length > 0;

  if (routesSurvive && snapshot.doneMarkers === 1) {
    problems.push(
      `ADR-0071 §4 berkata "${MARKER_DONE}", tetapi rute berikut masih ada: ` +
        `${snapshot.survivingRoutes.join(", ")}. Aturan §Keputusan melarang keluarga ` +
        "`/news/**` dilayani repo ini — selama berkasnya ada, penandanya wajib " +
        `"${MARKER_OUTSTANDING}".`
    );
  }

  if (!routesSurvive && snapshot.outstandingMarkers === 1) {
    problems.push(
      `Seluruh rute \`/news/**\` sudah hilang, tetapi ADR-0071 §4 masih berkata ` +
        `"${MARKER_OUTSTANDING}". Balik penandanya menjadi "${MARKER_DONE}" pada PR yang ` +
        "sama dengan penghapusannya, dan perbarui daftar langkah §4 menjadi riwayat."
    );
  }

  return { ok: problems.length === 0, problems };
}

async function readSnapshot(): Promise<VocabularySplitSnapshot> {
  const adrExists = existsSync(ADR_PATH);
  if (!adrExists) {
    return {
      adrExists,
      survivingRoutes: [],
      outstandingMarkers: 0,
      doneMarkers: 0
    };
  }

  const body = await readFile(ADR_PATH, "utf8");

  return {
    adrExists,
    survivingRoutes: NEWS_ROUTE_FILES.filter((file) =>
      existsSync(path.resolve(REPO_ROOT, file))
    ),
    outstandingMarkers: body.split(MARKER_OUTSTANDING).length - 1,
    doneMarkers: body.split(MARKER_DONE).length - 1
  };
}

describe("ADR-0071 — kosakata URL publik dibelah", () => {
  test("§4 cocok dengan rute yang benar-benar ada di repo", async () => {
    const verdict = decideVocabularySplit(await readSnapshot());
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("ADR-nya ada, dan penandanya tepat satu", async () => {
    const snapshot = await readSnapshot();
    expect(snapshot.adrExists).toBe(true);
    expect(snapshot.outstandingMarkers + snapshot.doneMarkers).toBe(1);
  });

  // --- Mutasi: tiap arah diberi cacat yang wajib ia tangkap. ---

  test("MERAH bila rute masih ada tetapi ADR mengaku sudah selesai", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: ["src/pages/news/index.ts"],
      outstandingMarkers: 0,
      doneMarkers: 1
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("src/pages/news/index.ts");
  });

  test("MERAH bila rute sudah hilang tetapi ADR masih mengaku belum", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 1,
      doneMarkers: 0
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("SUDAH DILAKSANAKAN");
  });

  test("MERAH bila satu rute saja bertahan — penghapusan separuh bukan penghapusan", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: ["src/pages/news/tag/[slug].ts"],
      outstandingMarkers: 0,
      doneMarkers: 1
    });
    expect(verdict.ok).toBe(false);
  });

  test("MERAH bila ADR memuat kedua penanda sekaligus", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 1,
      doneMarkers: 1
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("TEPAT SATU");
  });

  test("MERAH bila ADR-nya sendiri hilang", () => {
    const verdict = decideVocabularySplit({
      adrExists: false,
      survivingRoutes: [],
      outstandingMarkers: 0,
      doneMarkers: 0
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("dicabut tanpa keputusan");
  });

  test("HIJAU pada keadaan hari ini: rute ada, penanda BELUM", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [...NEWS_ROUTE_FILES],
      outstandingMarkers: 1,
      doneMarkers: 0
    });
    expect(verdict.ok).toBe(true);
  });

  test("HIJAU pada keadaan sesudah implementasi: rute hilang, penanda SUDAH", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 0,
      doneMarkers: 1
    });
    expect(verdict.ok).toBe(true);
  });
});
