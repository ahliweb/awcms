/**
 * client-asset-budget.ts — `bun run build:asset-budget:check`.
 *
 * Closes gap C6 of `docs/awcms/standar-performa-dan-keamanan.md` §9: the repo
 * had no budget on what the browser must download. Runs AFTER `astro build`
 * (the `build` target chains it) and fails when `dist/client` outgrows the
 * budgets below. Pure filesystem arithmetic — no database, no network.
 *
 * ## Why gate this today
 *
 * Measured on 2026-08-05, `dist/client` is 139,048 bytes across 45 files —
 * 35 JS files (77,449 B) and 10 CSS files (61,599 B); the largest single file
 * is `css/public-content.css` at 16,800 B. That is the cheapest moment a
 * budget will ever have: every later moment starts from a bigger baseline and
 * a budget written then would ratify whatever had already accreted. Client
 * weight grows one island at a time and no test notices; the symptom arrives
 * as "the public pages feel slow" long after the import that caused it.
 *
 * ## The budgets, derived from that measurement
 *
 * The original single ceiling (`TOTAL_BUDGET_BYTES` = 180,000 — baseline
 * 139,048 B + ~29% headroom) was split by ADR-0101 into one budget per
 * audience, `READER_BUDGET_BYTES` and `APP_BUDGET_BYTES`; see the section on
 * the split below for the measurement that forced it. Both still catch slow
 * accretion, now without one surface's growth hiding inside the other's.
 *
 * - `PER_FILE_BUDGET_BYTES` = 21,000 — largest file 16,800 B + 25%. Catches
 *   the other failure mode: one island importing a charting/date/editor
 *   dependency and shipping it as a single 200 KB chunk, which a generous
 *   total budget alone would absorb for a while and then blame on the NEXT
 *   change.
 *
 * Raising a budget is allowed — deliberately. The constant lives here so the
 * raise is a reviewed diff, and the reviewer's question is written down: what
 * feature bought this weight, and was it re-measured (`du -sb dist/client`)
 * rather than bumped until green?
 *
 * ## The first time that question was asked, the answer was no (Issue #552)
 *
 * On 2026-08-13 five admin screens landed in one day and the total reached
 * 176,670 B — 3,330 B of headroom, about two more screens. The budget had done
 * exactly what it exists to do, and the tempting fix was to raise it.
 *
 * It was not raised. The measurement said why: per-page script chunks were
 * 98,379 B across 43 files sharing 1,039 B between them, because every screen
 * hand-wrote the same lock/send/reload/report lifecycle. Moving that lifecycle
 * into `src/lib/ui/admin-form-client.ts` and converting all 36 screens took the
 * total to 153,970 B — 26,030 B of headroom, from a change that shipped no
 * less behaviour. A raise would have bought the same headroom by deleting the
 * question.
 *
 * That is the precedent this constant is meant to force, and it is recorded
 * here rather than in a commit message because the next person to hit the
 * ceiling reads this file, not the log.
 *
 * ## Why nothing is excluded
 *
 * Every byte in `dist/client` today is app shell (JS + CSS). Content images
 * never pass through the build — they live in R2 via `media_library` — and no
 * fonts are shipped. A pre-emptive exclusion class (e.g. "images don't count")
 * would be a blind spot with no current benefit: if image files ever appear in
 * `dist/client`, that is exactly the growth this gate exists to surface, and
 * the right response is a deliberate exclusion recorded here, not a silent one.
 *
 * ## Why a missing or empty `dist/client` FAILS
 *
 * A gate that passes when its input is absent is the "green while wrong"
 * failure mode this repo has recorded more than once. No `dist/client` means
 * the build has not run — the fix is `bun run build`, and the message says so.
 * An EMPTY `dist/client` fails for the same reason: the build always emits
 * CSS for the admin screens, so zero files means this script is measuring the
 * wrong directory or the build broke, never that the client got lighter.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIST = "dist/client";

/**
 * Which audience downloads each `public/` file — the ONLY assets a public
 * content page loads (ADR-0101).
 *
 * Everything under `_astro/` is Astro build output for `.astro` pages, and
 * every one of those pages is admin, auth, the landing page, or the theming
 * preview — so `_astro/*` is classified `app` structurally, with no list to
 * maintain. `public/` is copied through verbatim and has no such structure, so
 * its files are declared here.
 *
 * **This registry is a GATE, not documentation.** A file in `public/` that is
 * not declared fails the check, and a declaration whose file is gone fails it
 * too. That is deliberate: `src/lib/security/security-headers.ts` carried the
 * sentence "`public/` holds exactly two files" while `public/` held three,
 * because nothing forced the enumeration to stay true. An assertion nothing
 * re-checks is a claim, and this one had already decayed.
 */
export const PUBLIC_ASSET_AUDIENCE: Readonly<Record<string, "reader" | "app">> =
  Object.freeze({
    // Linked by the shell in `blog-content/domain/public-page-rendering.ts`
    // (`PUBLIC_CONTENT_STYLESHEET_HREF`) — every public article, page and index.
    "css/public-content.css": "reader",
    // Linked by `src/pages/blog/[tenantCode]/[slug].ts`
    // (`NEWS_SHARE_CLIENT_SCRIPT_SRC`) — the share annotator on article pages.
    "js/news-share.js": "reader",
    // Registered by `src/lib/ui/push-subscription-client.ts`, reached from the
    // `/admin/push-notifications` console. A reader never fetches it.
    "push-sw.js": "app"
  });

/**
 * What a READER downloads: 21,415 B measured 2026-08-20, budget 24,000.
 *
 * Deliberately tight. This is the number the original budget's premise — "the
 * public pages feel slow" — was always about, and 2,585 B of headroom is about
 * one more small script. It should be hard to grow this without saying why.
 */
export const READER_BUDGET_BYTES = 24_000;

/**
 * What the APP surface downloads (admin, auth, landing, theming preview):
 * 165,274 B measured 2026-08-20, budget 172,000 (~4%).
 *
 * This inherits the accretion history below — it is the old total minus the
 * reader assets, and it keeps the old total's job of catching slow growth one
 * admin screen at a time.
 *
 * Its immediate predecessor was `TOTAL_BUDGET_BYTES` = 192,000, **raised on 19
 * August 2026 for the Portable Text block editor (ADR-0100, Issue #589), and
 * the measurement was the argument.**
 *
 * Measured on clean builds (`rm -rf dist && bun run build` — a stale `dist`
 * produced a wrong delta once already, so the clean step is not optional):
 *
 * ```
 * main                                     181,418 B
 * + the block editor                       186,689 B   (delta 5,271 B)
 * ```
 *
 * **5,271 B for a rich-text editor** — 3,942 B of client script and 1,329 B of
 * CSS. That number is the whole decision record for Issue #589. The alternative
 * on the table was TipTap + ProseMirror, roughly 150-250 kB across ~20
 * transitive packages, which would have broken the 27,000 B per-file cap about
 * tenfold and roughly doubled this total, in a repo that ships exactly TWO
 * runtime dependencies.
 *
 * It is that small because the vocabulary is CLOSED (ADR-0100): three
 * decorators, one annotation, eight block styles, two list kinds. A general
 * editing framework is large because it must handle a vocabulary nobody has
 * enumerated; this one does not, so it does not need one.
 *
 * ## History worth keeping, because two earlier numbers here were wrong
 *
 * 180,000 -> briefly 190,000 -> back to 180,000 -> 184,000 -> 192,000.
 *
 * The 190,000 raise rested on `main` measuring 181,336 B against a 180,000 B
 * ceiling — true when measured, and then astro 7.2.0 -> 7.2.3 shed 2,411 B of
 * its own output and put `main` back under. It was reverted rather than kept: a
 * budget raised past a breach that has since healed has stopped measuring
 * anything. 184,000 followed a real 2,493 B admin screen (first reported as
 * 82 B, measured against a stale `dist`).
 *
 * ## A hypothesis worth not re-testing (Issue #590)
 *
 * The hypothesis that `_astro/error-log.*.css` (24,909 B, the largest file) is
 * bloated by duplicating `admin-screens.css` is **DISPROVED**. That chunk is
 * `src/styles/admin.css` (37,596 B of source), the AdminLayout stylesheet; it
 * carries `.admin-shell`/`.skip-link` while `_astro/admin-screens.*.css`
 * separately carries `.page-header`/`.admin-section-title`. They share nothing.
 * It is merely NAMED after `error-log` because Vite names a shared CSS chunk
 * after one of its JS importers.
 *
 * ## The split this file now enforces (Issue #590, ADR-0101)
 *
 * A single conflated ceiling was measuring the wrong thing. Attribution from
 * Astro's own SSR route manifest (`dist/server/entry.mjs`, not from file
 * names) on 2026-08-20:
 *
 * ```
 * reader  (public content pages)   21,415 B   css/public-content.css + js/news-share.js
 * app     (admin, auth, landing)  165,274 B   every _astro/* chunk + push-sw.js
 * ```
 *
 * **The decisive fact: a public content page loads ZERO `_astro` assets.**
 * Those pages are not Astro components — `src/pages/blog/`, `[...path].ts`,
 * the feeds and the sitemaps are `.ts` routes that emit their own shell via
 * `public-page-rendering.ts`, linking two absolute paths out of `public/`. The
 * only non-admin routes carrying `styles` in the manifest are `/`, the five
 * auth pages, and `/theming/preview/[token]`.
 *
 * So reader weight was 11% of a number dominated by admin, which made it
 * effectively unmeasured: a 5,000 B reader-facing regression is a **23%**
 * increase in what a reader downloads — exactly the premise this budget was
 * built on — and it passed silently under a 192,000 B ceiling.
 *
 * An earlier revision of this comment said "roughly 40% of the total is
 * admin-only". That was wrong in the other direction: admin-reachable is ~73%
 * once page scripts are counted. Both numbers were guesses at a split nobody
 * had measured; the two budgets below are measured.
 */
/**
 * **Raised to 178,000 on 20 August 2026 for the Issue #595 authoring surface,
 * and the gate's own question was answered first.**
 *
 * The failure message asks whether the growth is per-screen duplication, the
 * way Issue #552's was — 43 screens hand-copying one lifecycle, which a shared
 * module recovered 22,700 B from. It is not. Three features bought it, each
 * shipping behaviour that did not exist:
 *
 * ```
 * after ADR-0101                     165,274 B
 * + media upload UI      (#610)      169,128 B   (+3,854)
 * + article SEO fields   (#611)      169,417 B   (+  289)
 * + featured-image picker(#612)      173,050 B   (+3,633)
 * ```
 *
 * The picker is a shared module (`lib/ui/media-picker-client.ts`) imported by
 * one screen today and by ad inventory (#594) next, so its bytes are paid once
 * rather than per screen — the shape #552 established, applied before the
 * second consumer exists rather than after.
 *
 * 178,000 is measured + ~2.9%. Deliberately not the ~4% the previous value
 * carried: the reader budget is where the tight constraint belongs, but the
 * admin surface has now grown three times in one working day, and a wider
 * margin here would buy silence rather than room.
 */
/**
 * **Raised to 185,000 on 21 August 2026 for `/admin/site-profile` (Issue #596,
 * ADR-0102), and the gate's question was answered with a change rather than an
 * argument.**
 *
 * It fired at 181,626 B and asked whether the growth was per-screen
 * duplication. **Part of it was.** `/admin/site-profile` is the second screen
 * to need the media picker, and its wiring had been hand-copied from
 * `/admin/blog` — the exact Issue #552 shape, caught this time BEFORE it
 * landed rather than 43 screens later. Extracting `wireMediaPickers` into
 * `lib/ui/media-picker-client.ts` gave back 1,444 B:
 *
 * ```
 * with the copy                      181,626 B
 * after extracting wireMediaPickers  180,182 B   (-1,444)
 * ```
 *
 * What remains is a genuinely new screen — a form with nine fields, a
 * repeating social-links builder, and two media choosers — shipping behaviour
 * that did not exist. 185,000 is measured + ~2.7%.
 *
 * **Raised to 186,000 on 21 August 2026 for the usage-rights editor on
 * `/admin/media` (Issue #615), after asking the gate's question and getting a
 * different answer this time.**
 *
 * It fired at 185,095 B — 95 over. The growth is 649 B, all of it in
 * `media.astro`'s own island:
 *
 * ```
 * media.astro island, before   5,360 B
 * media.astro island, after    6,009 B   (+649)
 * ```
 *
 * Checked for the Issue #552 shape and it is not there: the editor reuses
 * `messageBox`, `mutateAndReload`, `sendJson` and `inputValue` from
 * `lib/ui/admin-form-client.ts`, and its own code is one submit handler. The
 * form itself is SERVER-rendered from `?rights=<id>` precisely so the page
 * ships no client code for populating fields from row data — the cheaper of the
 * two designs was already taken.
 *
 * So this is a genuine addition: a newsroom could not record who took a
 * photograph at all, and now can. 186,000 is measured + ~0.5%, deliberately
 * tight — a wider margin here would buy silence rather than room, which is the
 * reason the previous raise gave for staying close to the measurement.
 */
export const APP_BUDGET_BYTES = 186_000;

/**
 * Largest file at baseline 16,800 B (2026-08-05) + 25% was 21,000 B.
 *
 * **Raised to 27,000 B on 15 August 2026, and the reason is not "it grew".**
 * The per-file rule's stated premise — quoted in its own failure message — is
 * that "a single file this size usually means an island bundled a dependency".
 * That premise is what makes the rule sharp, and it does not hold for the file
 * that broke it: `admin.css` is the admin's SHARED stylesheet, parsed once and
 * cached across every screen, and it grew because it was missing half its
 * vocabulary. 125 classes used by the admin templates — every button, the
 * entire dashboard, the card/form system, `.visually-hidden` — had no rule at
 * all, so `/admin/account` and thirteen settings forms rendered as raw browser
 * controls.
 *
 * Splitting it to satisfy the old number was considered and rejected: two
 * stylesheets on every admin page cost a request and save nothing, so it would
 * improve the metric while making the thing the metric exists to protect
 * slightly worse.
 *
 * The surface budgets were deliberately NOT raised for it. The ceiling that
 * actually bounds what a reader downloads still binds at its own value, so
 * that change bought shape, not headroom.
 */
export const PER_FILE_BUDGET_BYTES = 27_000;

export type Audience = "reader" | "app";

export type ClientAsset = { path: string; bytes: number };

export type Measurement = { totalBytes: number; files: ClientAsset[] };

export type Budget = {
  readerBudgetBytes: number;
  appBudgetBytes: number;
  perFileBudgetBytes: number;
};

export type BudgetReport = {
  ok: boolean;
  totalBytes: number;
  readerBytes: number;
  appBytes: number;
  overReader: boolean;
  overApp: boolean;
  oversizedFiles: ClientAsset[];
  /** `public/` files present in the build but absent from the registry. */
  undeclared: ClientAsset[];
  /** Registry entries with no file in the build. */
  missing: string[];
  empty: boolean;
};

/**
 * Which budget an asset counts against.
 *
 * `_astro/*` is structural: it is Vite output for `.astro` pages, and no
 * public content route has one. Everything else came from `public/` and must
 * be declared — `undefined` here is what the gate turns into a failure, so a
 * new file cannot enter the build unclassified.
 */
export function classifyAsset(
  assetPath: string,
  registry: Readonly<Record<string, Audience>> = PUBLIC_ASSET_AUDIENCE
): Audience | undefined {
  const normalised = assetPath.split(path.sep).join("/");
  if (normalised.startsWith("_astro/")) return "app";
  return registry[normalised];
}

/**
 * Walk `root` recursively and size every regular file.
 *
 * Rejects when `root` does not exist — the caller decides how loudly. Files
 * come back sorted largest-first so failure output and "top 5" reporting need
 * no second sort.
 */
export async function measureClientAssets(root: string): Promise<Measurement> {
  const files: ClientAsset[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        files.push({ path: path.relative(root, absolute), bytes: info.size });
      }
    }
  }

  await walk(root);

  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

  return {
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
}

export function evaluateBudget(
  measurement: Measurement,
  budget: Budget = {
    readerBudgetBytes: READER_BUDGET_BYTES,
    appBudgetBytes: APP_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES
  },
  registry: Readonly<Record<string, Audience>> = PUBLIC_ASSET_AUDIENCE
): BudgetReport {
  const empty = measurement.files.length === 0;

  let readerBytes = 0;
  let appBytes = 0;
  const undeclared: ClientAsset[] = [];

  for (const file of measurement.files) {
    const audience = classifyAsset(file.path, registry);
    if (audience === "reader") readerBytes += file.bytes;
    else if (audience === "app") appBytes += file.bytes;
    else undeclared.push(file);
  }

  const present = new Set(
    measurement.files.map((file) => file.path.split(path.sep).join("/"))
  );
  const missing = Object.keys(registry).filter(
    (declared) => !present.has(declared)
  );

  const overReader = readerBytes > budget.readerBudgetBytes;
  const overApp = appBytes > budget.appBudgetBytes;
  const oversizedFiles = measurement.files.filter(
    (file) => file.bytes > budget.perFileBudgetBytes
  );

  return {
    ok:
      !empty &&
      !overReader &&
      !overApp &&
      oversizedFiles.length === 0 &&
      undeclared.length === 0 &&
      missing.length === 0,
    totalBytes: measurement.totalBytes,
    readerBytes,
    appBytes,
    overReader,
    overApp,
    oversizedFiles,
    undeclared,
    missing,
    empty
  };
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1000).toFixed(1)} kB)`;
}

/**
 * Actionable failure text: which budget broke, by how much, and the five
 * largest files — because the fix is almost always in one of them.
 */
export function formatFailure(
  report: BudgetReport,
  measurement: Measurement,
  budget: Budget
): string[] {
  const lines: string[] = ["build:asset-budget:check FAILED"];

  if (report.empty) {
    lines.push(
      `  - ${CLIENT_DIST} exists but holds no files. The build always emits ` +
        "admin CSS, so this means the build broke or the wrong directory is " +
        "being measured — never that the client got lighter."
    );
    return lines;
  }

  if (report.overReader) {
    lines.push(
      `  - READER assets ${formatBytes(report.readerBytes)} exceed the budget ` +
        `of ${formatBytes(budget.readerBudgetBytes)}. This is what a visitor ` +
        "to a public article downloads, and it is the tightest budget here on " +
        "purpose (ADR-0101). Trim it, or re-measure and raise " +
        "READER_BUDGET_BYTES in scripts/client-asset-budget.ts as a reviewed " +
        "diff that says which reader-visible feature bought the weight."
    );
  }

  if (report.overApp) {
    lines.push(
      `  - APP assets ${formatBytes(report.appBytes)} exceed the budget of ` +
        `${formatBytes(budget.appBudgetBytes)}. That is the admin, auth and ` +
        "landing surface. Before raising APP_BUDGET_BYTES, check whether the " +
        "growth is per-screen duplication — Issue #552 recovered 22,700 B by " +
        "moving a hand-copied lifecycle into src/lib/ui/admin-form-client.ts."
    );
  }

  for (const file of report.undeclared) {
    lines.push(
      `  - ${file.path} (${formatBytes(file.bytes)}) is in the build but not ` +
        "in PUBLIC_ASSET_AUDIENCE. Declare it 'reader' (a public content page " +
        "links it) or 'app' (only an admin/auth page reaches it) in " +
        "scripts/client-asset-budget.ts. An unclassified asset is one nobody " +
        "has decided the audience of, which is how reader weight grew unseen."
    );
  }

  for (const declared of report.missing) {
    lines.push(
      `  - PUBLIC_ASSET_AUDIENCE declares ${declared}, which the build did ` +
        "not emit. Either public/ lost the file and the entry should go, or " +
        "the build is wrong. A registry describing files that no longer " +
        "exist is the decay this gate exists to stop."
    );
  }

  for (const file of report.oversizedFiles) {
    lines.push(
      `  - ${file.path} is ${formatBytes(file.bytes)}, over the per-file ` +
        `budget of ${formatBytes(budget.perFileBudgetBytes)}. A single file ` +
        "this size usually means an island bundled a dependency; split or " +
        "drop it, or raise PER_FILE_BUDGET_BYTES with the reasoning updated."
    );
  }

  lines.push("  Largest files:");
  for (const file of measurement.files.slice(0, 5)) {
    lines.push(`    ${formatBytes(file.bytes).padStart(22)}  ${file.path}`);
  }

  return lines;
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function main(): Promise<void> {
  const budget: Budget = {
    readerBudgetBytes: READER_BUDGET_BYTES,
    appBudgetBytes: APP_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES
  };

  let measurement: Measurement;
  try {
    measurement = await measureClientAssets(CLIENT_DIST);
  } catch (error) {
    if (isMissingDirectory(error)) {
      console.error(
        `build:asset-budget:check FAILED — ${CLIENT_DIST} tidak ada. ` +
          "Jalankan build dulu: `bun run build` (target `build` sudah " +
          "merantainya setelah `astro build`)."
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const report = evaluateBudget(measurement, budget);

  if (!report.ok) {
    for (const line of formatFailure(report, measurement, budget)) {
      console.error(line);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `build:asset-budget:check OK — ${measurement.files.length} files, total ` +
      `${formatBytes(report.totalBytes)}. Reader ` +
      `${formatBytes(report.readerBytes)} within ` +
      `${formatBytes(budget.readerBudgetBytes)}; app ` +
      `${formatBytes(report.appBytes)} within ` +
      `${formatBytes(budget.appBudgetBytes)}; largest file within ` +
      `${formatBytes(budget.perFileBudgetBytes)}.`
  );
}

if (import.meta.main) {
  await main();
}
