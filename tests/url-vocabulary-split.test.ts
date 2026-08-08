/**
 * ADR-0071 §4 must agree with the filesystem it schedules work against.
 *
 * ## Why this gate exists at all
 *
 * ADR-0071 splits the family's public URL vocabulary — `/blog/**` here,
 * `/news/**` in `awcms-astro` — and the rule took effect the day it landed
 * while the code did not: the four routes ADR-0059 built were still served, and
 * `publicRouteMode` still defaulted to `domain_default`. §4 stated that window
 * openly, and this gate held the ADR to it until the removal shipped. The
 * window is now CLOSED (§4 reads `SUDAH DILAKSANAKAN`, `src/pages/news` is
 * gone), which is exactly when the gate's second job begins — see rule (e).
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
 * - (d) the ADR file itself must exist, so the gate cannot pass by vacuity;
 * - (e) routes absent → no CURRENT-STATE document may still claim they exist.
 *
 * Rule (e) is the half this gate was missing, and the omission had already
 * cost: after the removal landed, `AGENTS.md` — the first file every agent
 * reads — still carried a blockquote SCHEDULING the deletion as outstanding
 * work, naming this very test as its enforcer. `docs/ARCHITECTURE.md` said the
 * routes "SUDAH ada"; `docs/PROJECT_STATE.md` listed the family under "sudah
 * selesai (jangan dibangun ulang)"; the `awcms-blog-content` skill frontmatter
 * advertised "DUA keluarga rute publik". Every one of those passed rules (a)-(d)
 * because those rules only ever read the ADR and the filesystem.
 *
 * That direction of rot is the dangerous one. "This does not exist yet" ages
 * into a confident lie that sends the next reader to build what is already
 * built; here the mirror image sent them to find what was already deleted, or
 * to rebuild a route family the ADR three paragraphs above forbids.
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
 * The route directory ADR-0071 §4.1 schedules for removal. ANY file surviving
 * under it means the removal has not happened — a half-removed family is still
 * a family this repo serves, so the gate treats it as outstanding rather than
 * done.
 *
 * A DIRECTORY, not a list of four filenames, and that was a real hole rather
 * than a hypothetical one: the first draft named
 * `src/pages/news/{index,[slug],category/[slug],tag/[slug]}.ts` literally, so a
 * `src/pages/news/index.astro` — the same route, the extension Astro prefers
 * for pages — satisfied every assertion while the family was back. Reproduced
 * before this change: dropping a one-line `.astro` file there left the suite at
 * 9 pass / 0 fail.
 */
const NEWS_ROUTE_DIR = "src/pages/news";

/**
 * The marker carries a prefix on purpose. An earlier draft matched the bare
 * words and counted TWO: §4's own step list tells the implementer to flip the
 * marker, so it spells the target state in prose. A status marker that its own
 * instructions can trip is a marker that reports on its wording, not its state.
 */
const MARKER_PREFIX = "**Status pelaksanaan §4:**";
const MARKER_OUTSTANDING = `${MARKER_PREFIX} BELUM DILAKSANAKAN`;
const MARKER_DONE = `${MARKER_PREFIX} SUDAH DILAKSANAKAN`;

/**
 * Rule (e)'s corpus: the files a reader treats as CURRENT STATE. ADRs are
 * deliberately absent — an ADR records a decision at a point in time, and
 * ADR-0059 is supposed to still say `/news/**` exists. `docs/awcms/` at large is
 * absent for the reason ADR-0062 §3 and §10 of the standards doc already give:
 * it is a mix of history and target specification. The one exception is
 * `standar-performa-dan-keamanan.md`, which declares itself a living
 * current-state document.
 */
const CURRENT_STATE_CORPUS = [
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/PROJECT_STATE.md",
  "docs/awcms/standar-performa-dan-keamanan.md",
  "src/modules/*/README.md",
  ".claude/skills/*/SKILL.md"
] as const;

/** The three names ADR-0071 §4 removed from the code. */
const REMOVED_TOKENS = [
  "src/pages/news",
  "publicRouteMode",
  "withHostResolvedBlogTenant",
  "/news/**"
] as const;

/**
 * Rule (e) fires on a token NEXT TO an existence claim — never on the token
 * alone, and that narrowness is the whole design.
 *
 * A blanket ban would turn red on the sentences that are RIGHT: the
 * `blog_content` README and descriptor both name `publicRouteMode` and
 * `withHostResolvedBlogTenant` precisely to say they are gone, and that is the
 * text a reader most needs. A gate that reddens on correct prose teaches its
 * readers to weaken it — the failure mode `skills:check` already went through
 * three drafts to avoid.
 *
 * So the phrase list is the detector, in the shape
 * `tests/module-absence-claims.test.ts` established for the mirror-image defect
 * ("this module does not exist" about a module that does). Add to it when a new
 * spelling of the claim appears; do not widen it to bare tokens.
 */
const EXISTENCE_PHRASES = [
  "MASIH ADA",
  "masih ada",
  "SUDAH ada",
  "sudah ada",
  "kini ada",
  "kini SUDAH",
  "DUA keluarga rute publik",
  "masih `domain_default`",
  "still served",
  "are still"
] as const;

/**
 * Text between these markers is exempt from rule (e). It exists for ONE
 * legitimate case: quoting the superseded claim verbatim so the record shows
 * what was believed. This repo's convention is to strike text through rather
 * than delete it, and a quoted lie is still the words of a lie — so it must be
 * fenced rather than silently tolerated.
 */
const HISTORICAL_OPEN = "<!-- historis:mulai -->";
const HISTORICAL_CLOSE = "<!-- historis:selesai -->";

/**
 * How close a claim phrase must sit to a removed token to count as being ABOUT
 * it. Whole-line pairing is not usable here: markdown in this repo is written
 * one paragraph per line, and a real one runs 1.721 characters — long enough
 * that "sudah ada" (about ad/widget HELPERS) landed ~300 characters from an
 * unrelated `src/pages/news` mention and was reported as a claim about the
 * routes. That verdict happened to be right about the file and wrong about the
 * reason, which is the worst kind: it teaches the reader that the gate's
 * message cannot be trusted, and the next real hit gets edited away.
 */
const CLAIM_PROXIMITY = 160;

/** The claim phrase sitting within `CLAIM_PROXIMITY` of a removed token, if any. */
export function findClaim(line: string): string | null {
  for (const token of REMOVED_TOKENS) {
    let at = line.indexOf(token);

    while (at !== -1) {
      const window = line.slice(
        Math.max(0, at - CLAIM_PROXIMITY),
        at + token.length + CLAIM_PROXIMITY
      );
      const phrase = EXISTENCE_PHRASES.find((entry) => window.includes(entry));

      if (phrase) return phrase;
      at = line.indexOf(token, at + token.length);
    }
  }

  return null;
}

export function stripHistoricalBlocks(source: string): string {
  const parts: string[] = [];
  let cursor = 0;

  for (;;) {
    const open = source.indexOf(HISTORICAL_OPEN, cursor);
    if (open === -1) {
      parts.push(source.slice(cursor));
      break;
    }

    parts.push(source.slice(cursor, open));
    const close = source.indexOf(HISTORICAL_CLOSE, open);

    if (close === -1) {
      // An unclosed block would exempt the entire rest of the file. Keeping the
      // remainder IN the corpus makes that mistake loud instead of silent.
      parts.push(source.slice(open + HISTORICAL_OPEN.length));
      break;
    }

    // Newlines only: keeps reported line numbers honest.
    parts.push(
      source.slice(open, close).replace(/[^\n]/g, "") // blank out, keep lines
    );
    cursor = close + HISTORICAL_CLOSE.length;
  }

  return parts.join("");
}

export type VocabularySplitSnapshot = {
  /** Whether the ADR file was found at all. */
  adrExists: boolean;
  /** Files that still exist under `src/pages/news`, whatever they are named. */
  survivingRoutes: readonly string[];
  /** How many times each marker appears in the ADR body. */
  outstandingMarkers: number;
  doneMarkers: number;
  /**
   * Current-state documents still asserting the removed family EXISTS, as
   * `path:line — "phrase"`. Empty is the healthy state once the routes are gone.
   */
  resurrectionClaims: readonly string[];
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

  // (e) Only once the routes are gone. While they survive, a document saying
  // they exist is telling the truth.
  if (!routesSurvive && snapshot.resurrectionClaims.length > 0) {
    problems.push(
      "Rute `/news/**` sudah tidak ada, tetapi dokumen current-state berikut masih " +
        `menyatakannya ADA: ${snapshot.resurrectionClaims.join("; ")}. ` +
        "Tulis ulang per konteks (jangan `sed` seragam), atau — bila teks itu memang " +
        `kutipan sejarah yang sengaja dipertahankan — pagari dengan ` +
        `\`${HISTORICAL_OPEN}\` … \`${HISTORICAL_CLOSE}\`.`
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
      doneMarkers: 0,
      resurrectionClaims: []
    };
  }

  const body = await readFile(ADR_PATH, "utf8");

  return {
    adrExists,
    survivingRoutes: await scanNewsRouteDir(),
    outstandingMarkers: body.split(MARKER_OUTSTANDING).length - 1,
    doneMarkers: body.split(MARKER_DONE).length - 1,
    resurrectionClaims: await scanResurrectionClaims()
  };
}

/** Every file under `src/pages/news`, whatever its name or extension. */
async function scanNewsRouteDir(): Promise<string[]> {
  const dir = path.resolve(REPO_ROOT, NEWS_ROUTE_DIR);

  if (!existsSync(dir)) {
    return [];
  }

  const found: string[] = [];

  for await (const entry of new Bun.Glob("**/*").scan({
    cwd: dir,
    dot: true,
    onlyFiles: true
  })) {
    found.push(`${NEWS_ROUTE_DIR}/${entry}`);
  }

  return found.sort();
}

async function scanResurrectionClaims(): Promise<string[]> {
  const claims: string[] = [];

  for await (const file of scanCorpus()) {
    const source = stripHistoricalBlocks(await Bun.file(file).text());

    source.split("\n").forEach((line, index) => {
      const hit = findClaim(line);
      if (hit) claims.push(`${file}:${index + 1} — "${hit}"`);
    });
  }

  return claims.sort();
}

async function* scanCorpus(): AsyncGenerator<string> {
  for (const pattern of CURRENT_STATE_CORPUS) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: REPO_ROOT,
      dot: true
    })) {
      yield file;
    }
  }
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
      doneMarkers: 1,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("src/pages/news/index.ts");
  });

  test("MERAH bila rute sudah hilang tetapi ADR masih mengaku belum", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 1,
      doneMarkers: 0,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("SUDAH DILAKSANAKAN");
  });

  test("MERAH bila satu rute saja bertahan — penghapusan separuh bukan penghapusan", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: ["src/pages/news/tag/[slug].ts"],
      outstandingMarkers: 0,
      doneMarkers: 1,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(false);
  });

  test("MERAH bila ADR memuat kedua penanda sekaligus", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 1,
      doneMarkers: 1,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("TEPAT SATU");
  });

  test("MERAH bila ADR-nya sendiri hilang", () => {
    const verdict = decideVocabularySplit({
      adrExists: false,
      survivingRoutes: [],
      outstandingMarkers: 0,
      doneMarkers: 0,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("dicabut tanpa keputusan");
  });

  test("HIJAU pada keadaan hari ini: rute ada, penanda BELUM", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: ["src/pages/news/index.ts", "src/pages/news/[slug].ts"],
      outstandingMarkers: 1,
      doneMarkers: 0,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(true);
  });

  test("HIJAU pada keadaan sesudah implementasi: rute hilang, penanda SUDAH", () => {
    const verdict = decideVocabularySplit({
      adrExists: true,
      survivingRoutes: [],
      outstandingMarkers: 0,
      doneMarkers: 1,
      resurrectionClaims: []
    });
    expect(verdict.ok).toBe(true);
  });
});
