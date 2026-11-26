/**
 * opengrep-scan.ts — leg SAST "bebas" (OpenGrep + aturan tersalin, tanpa registry).
 *
 * Standar lintas-portofolio internal DL-098. Subperintah:
 *   scan            (bawaan) jalankan OpenGrep, bandingkan dengan baseline, gerbang ERROR baru.
 *   baseline --buat     buat baseline (hanya bila belum ada) dari semua temuan ERROR saat ini.
 *   baseline --rapikan  buang entri basi dari baseline; tidak pernah menambah.
 *   sinkron-aturan  sinkron ulang salinan opengrep-rules pada commit terpin.
 *
 * Exit: 0 lolos, 1 ada ERROR baru, 2 galat alat (gagal tertutup).
 * Runtime: Bun saja.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { arch, homedir, platform, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------- pin (ubah sengaja, lihat README)

/** Naikkan hanya lewat prosedur README: unduh, cek digest release, uji, perbarui pin. */
export const OPENGREP_VERSION = "v2.1.0";
export const OPENGREP_ASSETS: Readonly<
  Record<string, { asset: string; sha256: string }>
> = {
  x64: {
    asset: "opengrep_linux_x86",
    sha256: "d6a68a84c01a3d8ee933f60847decf1b4d0fd7791a26833b32b95922baf28974"
  },
  arm64: {
    asset: "opengrep_linux_aarch64",
    sha256: "3abfc87d66f208efd143a1b408d489af934cea7d9968ab1f37dca001f9886092"
  }
};
export const RULES_REPO = "https://github.com/opengrep/opengrep-rules.git";
export const RULES_COMMIT = "f1d2b562b414783763fd02a6ed2736eaed622efa";
export const RULES_DIRS = ["javascript", "typescript"] as const;

export const SAST_DIR = "tools/ci/sast";
export const RULES_REL = `${SAST_DIR}/rules`;
export const BASELINE_REL = `${SAST_DIR}/baseline.json`;

export const DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  ".astro",
  "coverage",
  "graphify-out",
  "playwright-report",
  "test-results",
  "blob-report",
  "*.min.js",
  RULES_REL
];

// ---------------------------------------------------------------- logika murni

export type Severity = "ERROR" | "WARNING" | "INFO";

/** Bentuk minimal satu hasil dari `--json` OpenGrep. */
export interface RawResult {
  check_id: string;
  path: string;
  start: { line: number; col?: number };
  end: { line: number; col?: number };
  extra: {
    message?: string;
    severity?: string;
    lines?: string;
    fingerprint?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface Finding {
  rule: string;
  path: string;
  severity: Severity;
  line: number;
  endLine: number;
  message: string;
  fingerprint: string;
}

export interface BaselineEntry {
  rule: string;
  path: string;
  fingerprint: string;
  alasan: string;
  /** Info saja, bukan kunci. */
  baris?: number;
}

export interface Baseline {
  versi: 1;
  entri: BaselineEntry[];
}

/** Rapatkan whitespace sehingga pergeseran indentasi/format tidak mengubah sidik jari. */
export function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/**
 * Id aturan dari mesin berawalan path direktori aturan (titik-titik). Buang awalan itu
 * supaya sidik jari sama di mana pun aturan diletakkan.
 */
export function normalizeRuleId(id: string): string {
  const marker = "tools.ci.sast.rules.";
  const i = id.lastIndexOf(marker);
  if (i >= 0) return id.slice(i + marker.length);
  const m = /(?:^|\.)((?:javascript|typescript|lokal)\..+)$/.exec(id);
  return m ? m[1]! : id;
}

export function fingerprintOf(
  rule: string,
  path: string,
  lineText: string,
  occurrence: number
): string {
  return createHash("sha256")
    .update(`${rule}\n${path}\n${normalizeLine(lineText)}\n${occurrence}`)
    .digest("hex");
}

function toSeverity(s: string | undefined): Severity {
  const u = (s ?? "").toUpperCase();
  if (u === "ERROR" || u === "WARNING" || u === "INFO") return u;
  // Severity tak dikenal diperlakukan sebagai ERROR: gagal tertutup.
  return "ERROR";
}

/**
 * Ubah hasil mentah menjadi temuan ber-sidik-jari. `readSource(path, start, end)` mengembalikan
 * teks baris sumber (start..end, 1-based). Indeks kemunculan diberikan per (aturan, path, teks)
 * menurut urutan baris/kolom, sehingga duplikat tetap berbeda dan stabil.
 */
export function buildFindings(
  results: readonly RawResult[],
  readSource: (path: string, start: number, end: number) => string
): Finding[] {
  const sorted = results
    .map((r) => ({
      r,
      path: normalizePath(r.path),
      rule: normalizeRuleId(r.check_id)
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.r.start.line - b.r.start.line ||
        (a.r.start.col ?? 0) - (b.r.start.col ?? 0) ||
        a.rule.localeCompare(b.rule)
    );
  const seen = new Map<string, number>();
  return sorted.map(({ r, path, rule }) => {
    const text = normalizeLine(readSource(path, r.start.line, r.end.line));
    const key = `${rule}\n${path}\n${text}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return {
      rule,
      path,
      severity: toSeverity(r.extra.severity),
      line: r.start.line,
      endLine: r.end.line,
      message: (r.extra.message ?? "").split("\n")[0] ?? "",
      fingerprint: fingerprintOf(rule, path, text, n)
    };
  });
}

export function sortEntries(
  entries: readonly BaselineEntry[]
): BaselineEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.rule.localeCompare(b.rule) ||
      a.fingerprint.localeCompare(b.fingerprint)
  );
}

/** Validasi bentuk baseline; lempar bila rusak (gagal tertutup). */
export function parseBaseline(raw: unknown): Baseline {
  const o = raw as { versi?: unknown; entri?: unknown } | null;
  if (!o || o.versi !== 1 || !Array.isArray(o.entri))
    throw new Error("Baseline rusak: butuh {versi:1, entri:[...]}");
  const seen = new Set<string>();
  for (const e of o.entri as BaselineEntry[]) {
    for (const k of ["rule", "path", "fingerprint", "alasan"] as const) {
      if (typeof e?.[k] !== "string" || (e[k] as string).trim() === "") {
        throw new Error(
          `Entri baseline tanpa bidang "${k}" (alasan wajib): ${JSON.stringify(e)}`
        );
      }
    }
    if (seen.has(e.fingerprint))
      throw new Error(`Entri baseline ganda: ${e.fingerprint}`);
    seen.add(e.fingerprint);
  }
  return { versi: 1, entri: o.entri as BaselineEntry[] };
}

export interface DiffResult {
  /** ERROR yang tidak ada di baseline: menggagalkan gerbang. */
  baru: Finding[];
  /** ERROR yang tercakup baseline. */
  tercakup: Finding[];
  /** Entri baseline yang tidak ditemukan lagi. */
  basi: BaselineEntry[];
}

export function diffBaseline(
  findings: readonly Finding[],
  baseline: Baseline
): DiffResult {
  const errors = findings.filter((f) => f.severity === "ERROR");
  const known = new Set(baseline.entri.map((e) => e.fingerprint));
  const present = new Set(errors.map((f) => f.fingerprint));
  return {
    baru: errors.filter((f) => !known.has(f.fingerprint)),
    tercakup: errors.filter((f) => known.has(f.fingerprint)),
    basi: baseline.entri.filter((e) => !present.has(e.fingerprint))
  };
}

export function createBaseline(
  findings: readonly Finding[],
  tanggal: string
): Baseline {
  const entri = findings
    .filter((f) => f.severity === "ERROR")
    .map((f) => ({
      rule: f.rule,
      path: f.path,
      fingerprint: f.fingerprint,
      alasan: `temuan lama saat adopsi ${tanggal}`,
      baris: f.line
    }));
  return { versi: 1, entri: sortEntries(entri) };
}

/** Lempar bila `baru` memuat sidik jari yang tidak ada di `lama`: baseline hanya boleh menyusut. */
export function assertNoAdditions(lama: Baseline, baru: Baseline): void {
  const known = new Set(lama.entri.map((e) => e.fingerprint));
  const tambahan = baru.entri.filter((e) => !known.has(e.fingerprint));
  if (tambahan.length > 0) {
    throw new Error(
      `Baseline TIDAK BOLEH bertambah lewat skrip (${tambahan.length} entri baru). Tambah dengan edit tangan + alasan.`
    );
  }
}

/** Buang entri basi; sisanya utuh (alasan dipertahankan). Tidak pernah menambah. */
export function tidyBaseline(
  lama: Baseline,
  findings: readonly Finding[]
): { baseline: Baseline; dibuang: BaselineEntry[] } {
  const present = new Set(
    findings.filter((f) => f.severity === "ERROR").map((f) => f.fingerprint)
  );
  const baseline: Baseline = {
    versi: 1,
    entri: sortEntries(lama.entri.filter((e) => present.has(e.fingerprint)))
  };
  assertNoAdditions(lama, baseline);
  return {
    baseline,
    dibuang: lama.entri.filter((e) => !present.has(e.fingerprint))
  };
}

export function countBySeverity(
  findings: readonly Finding[]
): Record<Severity, number> {
  const c: Record<Severity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

// ---------------------------------------------------------------- argumen

export interface Options {
  command: "scan" | "baseline" | "sinkron-aturan";
  root: string;
  baseline: string;
  aturan: string;
  cache?: string;
  keluaran?: string;
  exclude: string[];
  buat: boolean;
  rapikan: boolean;
}

export function parseArgs(
  argv: readonly string[],
  cwd: string = process.cwd()
): Options {
  const args = [...argv];
  let command: Options["command"] = "scan";
  const first = args[0];
  if (first === "scan" || first === "baseline" || first === "sinkron-aturan") {
    command = first;
    args.shift();
  }
  const o = {
    root: cwd,
    baseline: "",
    aturan: "",
    cache: undefined as string | undefined,
    keluaran: undefined as string | undefined,
    exclude: [] as string[],
    buat: false,
    rapikan: false
  };
  const takesValue = new Set([
    "--root",
    "--baseline",
    "--aturan",
    "--cache",
    "--keluaran",
    "--exclude"
  ]);
  for (let i = 0; i < args.length; i++) {
    let a = args[i]!;
    let val: string | undefined;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      val = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a === "--buat") o.buat = true;
    else if (a === "--rapikan") o.rapikan = true;
    else if (takesValue.has(a)) {
      if (val === undefined) {
        val = args[++i];
        if (val === undefined) throw new Error(`Opsi ${a} butuh nilai`);
      }
      if (a === "--exclude") o.exclude.push(val);
      else (o as Record<string, unknown>)[a.slice(2)] = val;
    } else throw new Error(`Opsi tidak dikenal: ${a}`);
  }
  const root = resolve(cwd, o.root);
  return {
    command,
    root,
    baseline: o.baseline ? resolve(cwd, o.baseline) : join(root, BASELINE_REL),
    aturan: o.aturan ? resolve(cwd, o.aturan) : join(root, RULES_REL),
    cache: o.cache ? resolve(cwd, o.cache) : undefined,
    keluaran: o.keluaran ? resolve(cwd, o.keluaran) : undefined,
    exclude: o.exclude,
    buat: o.buat,
    rapikan: o.rapikan
  };
}

// ---------------------------------------------------------------- binary

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

export function opengrepCacheDir(override?: string): string {
  if (override) return override;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "opengrep", OPENGREP_VERSION);
}

/** Pastikan binary terpin ada dan terverifikasi. Unduh ke `.part`, verifikasi, baru rename. */
export async function ensureOpengrep(cacheOverride?: string): Promise<string> {
  const pin = platform() === "linux" ? OPENGREP_ASSETS[arch()] : undefined;
  if (!pin)
    throw new Error(
      `Tidak ada binary OpenGrep terpin untuk ${platform()}/${arch()} (hanya linux x64 dan arm64).`
    );
  const dir = opengrepCacheDir(cacheOverride);
  const exe = join(dir, "opengrep");
  // Binary di cache dipercaya hanya setelah diverifikasi ulang.
  if (existsSync(exe) && (await sha256File(exe)) === pin.sha256) return exe;

  mkdirSync(dir, { recursive: true });
  const part = `${exe}.part`;
  rmSync(part, { force: true });
  rmSync(exe, { force: true });
  const url = `https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}/${pin.asset}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
  if (!res.ok) throw new Error(`Unduh OpenGrep gagal: ${res.status} ${url}`);
  await Bun.write(part, res);
  const actual = await sha256File(part);
  if (actual !== pin.sha256) {
    rmSync(part, { force: true });
    throw new Error(
      `Checksum OpenGrep tidak cocok: harap ${pin.sha256}, dapat ${actual}. Binary ditolak.`
    );
  }
  chmodSync(part, 0o755);
  renameSync(part, exe);
  return exe;
}

// ---------------------------------------------------------------- proses

/** Jumlah job mesin: CI_LOKAL_CPUS bila ada (wrapper ci-lokal), bawaan 5. */
export function jobsFromEnv(
  env: Record<string, string | undefined> = process.env
): number {
  const n = Number.parseInt(env.CI_LOKAL_CPUS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

let childProc: { kill: (sig?: number) => void } | undefined;

async function run(
  cmd: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  // OpenGrep v2.1.0 tidak punya --metrics; env ini menjaga tanpa telemetri bila ada di versi lain.
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, SEMGREP_SEND_METRICS: "off" }
  });
  childProc = p;
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited
  ]);
  return { code, stdout, stderr };
}

function countRuleFiles(dir: string): number {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) n += countRuleFiles(p);
    else if (/\.ya?ml$/.test(e.name)) n++;
  }
  return n;
}

interface ScanOutcome {
  findings: Finding[];
  engineErrors: { type?: string; level?: string; message?: string }[];
  scanned: number;
  ruleFiles: number;
  ms: number;
  sarifPath?: string;
}

function baselineOrEmpty(path: string): Baseline | null {
  if (!existsSync(path)) return null;
  return parseBaseline(JSON.parse(readFileSync(path, "utf8")));
}

/** Jalankan mesin di `tmp` (artefak antara dihapus pemanggil dalam finally). */
async function runEngine(
  opts: Options,
  tmp: string,
  wantSarif: boolean
): Promise<ScanOutcome> {
  const ruleFiles = countRuleFiles(opts.aturan);
  if (ruleFiles === 0)
    throw new Error(
      `Tidak ada berkas aturan di ${opts.aturan}. Jalankan "sinkron-aturan".`
    );
  const exe = await ensureOpengrep(opts.cache);
  const jsonOut = join(tmp, "opengrep.json");
  const sarifOut = join(tmp, "opengrep.sarif");

  const help = await run([exe, "scan", "--help"], opts.root);
  const sarifOk = wantSarif && /--sarif-output/.test(help.stdout + help.stderr);

  const config = isAbsolute(opts.aturan)
    ? opts.aturan
    : relative(opts.root, opts.aturan);
  const args = [
    "scan",
    `--config=${config}`,
    `--jobs=${jobsFromEnv()}`,
    "--disable-version-check",
    "--x-ignore-semgrepignore-files",
    "--json",
    `--json-output=${jsonOut}`,
    ...(sarifOk ? [`--sarif-output=${sarifOut}`] : []),
    "--quiet",
    ...[...DEFAULT_EXCLUDES, ...opts.exclude].map((p) => `--exclude=${p}`),
    "."
  ];
  const t0 = Date.now();
  const r = await run([exe, ...args], opts.root);
  const ms = Date.now() - t0;
  if (r.code !== 0)
    throw new Error(`OpenGrep exit ${r.code}: ${r.stderr.slice(-2000)}`);
  if (!existsSync(jsonOut))
    throw new Error("OpenGrep tidak menulis keluaran JSON");
  const doc = JSON.parse(readFileSync(jsonOut, "utf8")) as {
    results?: RawResult[];
    errors?: { type?: string; level?: string; message?: string }[];
    paths?: { scanned?: string[] };
  };
  if (!Array.isArray(doc.results))
    throw new Error("Keluaran JSON OpenGrep tanpa `results`");

  const cache = new Map<string, string[]>();
  const readSource = (path: string, start: number, end: number): string => {
    let lines = cache.get(path);
    if (!lines) {
      lines = readFileSync(join(opts.root, path), "utf8").split(/\r?\n/);
      cache.set(path, lines);
    }
    return lines.slice(start - 1, end).join("\n");
  };
  return {
    findings: buildFindings(doc.results, readSource),
    engineErrors: doc.errors ?? [],
    scanned: doc.paths?.scanned?.length ?? 0,
    ruleFiles,
    ms,
    sarifPath: sarifOk ? sarifOut : undefined
  };
}

/** Galat mesin yang dianggap fatal: aturan rusak. Galat parse berkas sumber hanya dilaporkan. */
export function fatalEngineErrors(
  errors: readonly { type?: string; level?: string; message?: string }[]
) {
  return errors.filter(
    (e) =>
      /rule|config|schema|yaml/i.test(e.type ?? "") &&
      !/PartialParsing|Parse ?Error|Lexical/i.test(e.type ?? "")
  );
}

async function withTmp<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "opengrep-scan-"));
  // Dihentikan oleh batas waktu (ci-lokal mengirim SIGTERM): hapus artefak antara, hentikan mesin.
  const onSignal = (sig: NodeJS.Signals) => {
    childProc?.kill();
    rmSync(tmp, { recursive: true, force: true });
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    return await fn(tmp);
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFinding(f: Finding): string {
  return `  [${f.severity}] ${f.path}:${f.line}  ${f.rule}\n      ${f.message}`;
}

// ---------------------------------------------------------------- subperintah

async function cmdScan(opts: Options): Promise<number> {
  const baseline = baselineOrEmpty(opts.baseline) ?? {
    versi: 1 as const,
    entri: []
  };
  const baselineAda = existsSync(opts.baseline);
  const keluaran = opts.keluaran;
  return withTmp(async (tmp) => {
    const out = await runEngine(opts, tmp, keluaran !== undefined);
    const fatal = fatalEngineErrors(out.engineErrors);
    if (fatal.length > 0)
      throw new Error(
        `Galat mesin fatal: ${JSON.stringify(fatal.slice(0, 3))}`
      );
    const diff = diffBaseline(out.findings, baseline);
    const jumlah = countBySeverity(out.findings);
    const lolos = diff.baru.length === 0;
    const ringkasan = {
      versi: 1,
      mesin: `opengrep ${OPENGREP_VERSION}`,
      aturanCommit: RULES_COMMIT,
      berkasAturan: out.ruleFiles,
      berkasDipindai: out.scanned,
      waktuMs: out.ms,
      jumlah,
      baseline: {
        ada: baselineAda,
        entri: baseline.entri.length,
        tercakup: diff.tercakup.length,
        basi: diff.basi.length
      },
      errorBaru: diff.baru,
      basi: diff.basi,
      galatParse: out.engineErrors.length,
      lolos
    };
    if (keluaran) {
      mkdirSync(keluaran, { recursive: true });
      writeFileSync(
        join(keluaran, "ringkasan.json"),
        JSON.stringify({ ...ringkasan, temuan: out.findings }, null, 2) + "\n"
      );
      if (out.sarifPath && existsSync(out.sarifPath))
        cpSync(out.sarifPath, join(keluaran, "opengrep.sarif"));
    }
    console.log(
      `OpenGrep ${OPENGREP_VERSION}: ${out.ruleFiles} berkas aturan, ${out.scanned} berkas dipindai, ${out.ms} ms; ` +
        `ERROR=${jumlah.ERROR} WARNING=${jumlah.WARNING} INFO=${jumlah.INFO}; ` +
        `baseline ${baselineAda ? `${baseline.entri.length} entri (${diff.tercakup.length} tercakup, ${diff.basi.length} basi)` : "tidak ada"}`
    );
    if (diff.basi.length > 0)
      console.log(
        `Catatan: ${diff.basi.length} entri baseline basi; jalankan "baseline --rapikan".`
      );
    if (out.engineErrors.length > 0)
      console.log(
        `Catatan: ${out.engineErrors.length} galat parse berkas sumber (dilaporkan, tidak menggagalkan).`
      );
    if (!lolos) {
      console.log(
        `GAGAL: ${diff.baru.length} temuan ERROR baru di luar baseline:`
      );
      for (const f of diff.baru) console.log(formatFinding(f));
      console.log(
        "Perbaiki, atau (tinjauan manusia di PR) tambah entri baseline dengan edit tangan + alasan, atau `// nosemgrep: <rule-id>` beralasan."
      );
      return 1;
    }
    console.log("LOLOS: tidak ada ERROR baru.");
    return 0;
  });
}

async function cmdBaseline(opts: Options): Promise<number> {
  if (opts.buat === opts.rapikan)
    throw new Error("baseline: pilih tepat satu dari --buat atau --rapikan");
  if (opts.buat) {
    if (existsSync(opts.baseline))
      throw new Error(
        `Baseline sudah ada: ${opts.baseline}. Skrip tidak menambah entri; edit tangan.`
      );
    return withTmp(async (tmp) => {
      const out = await runEngine(opts, tmp, false);
      const b = createBaseline(out.findings, today());
      mkdirSync(dirname(opts.baseline), { recursive: true });
      writeFileSync(opts.baseline, JSON.stringify(b, null, 2) + "\n");
      console.log(
        `Baseline dibuat: ${b.entri.length} entri ERROR -> ${opts.baseline}`
      );
      return 0;
    });
  }
  const lama = baselineOrEmpty(opts.baseline);
  if (!lama) throw new Error(`Baseline tidak ada: ${opts.baseline}`);
  return withTmp(async (tmp) => {
    const out = await runEngine(opts, tmp, false);
    const { baseline, dibuang } = tidyBaseline(lama, out.findings);
    writeFileSync(opts.baseline, JSON.stringify(baseline, null, 2) + "\n");
    console.log(
      `Baseline dirapikan: ${dibuang.length} entri basi dibuang, ${baseline.entri.length} tersisa.`
    );
    return 0;
  });
}

function listRuleYaml(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listRuleYaml(p, acc);
    else if (/\.ya?ml$/.test(e.name)) acc.push(p);
  }
  return acc;
}

export function renderSumber(
  commitDate: string,
  jumlah: number,
  tanggalSinkron: string
): string {
  return `# Sumber aturan SAST

Salinan aturan, bukan tulisan repo ini. Jangan edit tangan; sinkron ulang dengan skrip.

- Repo: ${RULES_REPO.replace(/\.git$/, "")} (diarsipkan upstream)
- Commit: \`${RULES_COMMIT}\`
- Tanggal commit: ${commitDate}
- Disalin pada: ${tanggalSinkron}
- Cakupan: semua berkas \`.yaml\` dan \`.yml\` di \`javascript/\` dan \`typescript/\` (${jumlah} berkas), ditambah \`LICENSE\` upstream utuh.
- Lisensi: Commons Clause + LGPL 2.1 (lihat \`LICENSE\`). Syarat Commons Clause menahan hak MENJUAL perangkat lunak; memakai aturan di CI internal tidak dibatasi.
- Tidak dipakai: aturan Semgrep Registry (\`p/...\`) dan repo semgrep/semgrep-rules.
- Aturan milik repo ada di \`lokal/\` dan tidak disentuh sinkron.

## Sinkron ulang

\`\`\`bash
bun tools/ci/sast/opengrep-scan.ts sinkron-aturan
\`\`\`

Skrip meng-clone sparse ke direktori sementara, checkout commit terpin di atas, memverifikasi \`git rev-parse HEAD\`, menyalin berkas, lalu menulis ulang berkas ini. Untuk pindah commit, ubah \`RULES_COMMIT\` di \`opengrep-scan.ts\` lewat PR, sinkron, lalu perbarui baseline dengan tinjauan manusia.
`;
}

async function cmdSinkron(opts: Options): Promise<number> {
  const git = async (cwd: string, ...a: string[]) => {
    const r = await run(["git", ...a], cwd);
    if (r.code !== 0)
      throw new Error(`git ${a.join(" ")} gagal: ${r.stderr.slice(-1000)}`);
    return r.stdout.trim();
  };
  return withTmp(async (tmp) => {
    const clone = join(tmp, "rules");
    mkdirSync(clone);
    await git(clone, "init", "-q");
    await git(clone, "remote", "add", "origin", RULES_REPO);
    await git(clone, "sparse-checkout", "set", ...RULES_DIRS);
    await git(
      clone,
      "fetch",
      "-q",
      "--depth",
      "1",
      "--filter=blob:none",
      "origin",
      RULES_COMMIT
    );
    await git(clone, "checkout", "-q", "--detach", "FETCH_HEAD");
    const head = await git(clone, "rev-parse", "HEAD");
    if (head !== RULES_COMMIT)
      throw new Error(`Commit tidak cocok pin: ${head} != ${RULES_COMMIT}`);
    const commitDate = await git(clone, "show", "-s", "--format=%cI", "HEAD");

    const dest = opts.aturan;
    for (const d of RULES_DIRS)
      rmSync(join(dest, d), { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    let jumlah = 0;
    for (const d of RULES_DIRS) {
      const src = join(clone, d);
      if (!existsSync(src) || !statSync(src).isDirectory())
        throw new Error(`Direktori ${d}/ tidak ada di commit terpin`);
      for (const f of listRuleYaml(src)) {
        const to = join(dest, relative(clone, f));
        mkdirSync(dirname(to), { recursive: true });
        cpSync(f, to);
        jumlah++;
      }
    }
    if (jumlah === 0) throw new Error("Tidak ada berkas aturan tersalin");
    const licenseSrc = join(clone, "LICENSE");
    if (!existsSync(licenseSrc))
      throw new Error("LICENSE upstream tidak ditemukan di commit terpin");
    cpSync(licenseSrc, join(dest, "LICENSE"));
    writeFileSync(
      join(dest, "SUMBER.md"),
      renderSumber(commitDate, jumlah, today())
    );
    console.log(
      `Sinkron aturan: ${jumlah} berkas + LICENSE + SUMBER.md -> ${dest} (commit ${RULES_COMMIT.slice(0, 12)})`
    );
    return 0;
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const opts = parseArgs(argv);
    if (opts.command === "sinkron-aturan") return await cmdSinkron(opts);
    if (opts.command === "baseline") return await cmdBaseline(opts);
    return await cmdScan(opts);
  } catch (e) {
    console.error(`GALAT ALAT: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
