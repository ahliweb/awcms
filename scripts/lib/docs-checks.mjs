/**
 * docs-checks.mjs — logika murni pemeriksa dokumentasi (tanpa I/O).
 *
 * Diadaptasi dari awcms-mini (`scripts/lib/docs-checks.mjs`). Fungsi di sini
 * bebas dari filesystem/git agar mudah di-unit-test. Orkestrasi + I/O (git
 * ls-files, baca berkas, resolve tautan, exit code) berada di
 * `scripts/check-docs.mjs`.
 */

/** Tipe diagram Mermaid yang dikenal. */
export const MERMAID_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "requirementDiagram",
  "C4Context",
  "block-beta"
];

/**
 * Satu temuan pemeriksaan.
 * @typedef {{ file: string, line: number, message: string }} Problem
 */

/**
 * Validasi blok kode berpagar mermaid: setiap blok tertutup dan diawali tipe diagram dikenal.
 * @param {string} file
 * @param {string[]} lines
 * @returns {Problem[]}
 */
export function checkMermaid(file, lines) {
  /** @type {Problem[]} */
  const problems = [];
  let inBlock = false;
  let blockStart = 0;
  let sawType = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (!inBlock && trimmed === "```mermaid") {
      inBlock = true;
      blockStart = i + 1;
      sawType = false;
      continue;
    }
    if (inBlock) {
      if (trimmed === "```") {
        if (!sawType) {
          problems.push({
            file,
            line: blockStart,
            message: "blok mermaid tanpa tipe diagram dikenal"
          });
        }
        inBlock = false;
        continue;
      }
      if (!sawType && trimmed.length > 0) {
        const first = (trimmed.split(/\s|\{/)[0] ?? "").trim();
        if (!MERMAID_TYPES.includes(first)) {
          problems.push({
            file,
            line: i + 1,
            message: `tipe diagram mermaid tak dikenal: "${first}"`
          });
        }
        sawType = true; // hanya periksa baris konten pertama
      }
    }
  }
  if (inBlock) {
    problems.push({
      file,
      line: blockStart,
      message: "blok ```mermaid tidak ditutup"
    });
  }
  return problems;
}

/**
 * Slug heading gaya GitHub: lowercase, buang tanda baca (pertahankan word,
 * spasi, hyphen), lalu tiap whitespace → satu hyphen. GitHub **tidak**
 * menggabungkan spasi/hyphen beruntun, jadi `"a & b"` → `"a--b"`.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

/**
 * Kumpulan slug heading dari sebuah dokumen Markdown.
 * @param {string} md
 * @returns {Set<string>}
 */
export function headingSlugs(md) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const line of md.split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (h) set.add(slugify(h[1] ?? ""));
  }
  return set;
}

/**
 * Escape hatch untuk `checkNaming`, keyed `"relative/path:lineNumber"` — untuk
 * referensi historis yang SAH ke identifier `awcms-mini`/`AWCMS_MINI_` milik
 * repo acuan (mis. dokumen audit yang mencatat fakta sejarah pengembangan
 * awcms-mini, bukan kontrak repo ini). Bukan untuk menyembunyikan sisa
 * porting yang belum diadaptasi — tambahkan entri baru hanya dengan alasan
 * tercatat di commit yang menambahkannya.
 */
export const NAMING_EXEMPTIONS = new Set([
  "docs/awcms/18_configuration_env_reference.md:279",
  "docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md:149",
  "docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md:221"
]);

/**
 * Deteksi sisa penamaan repo acuan yang belum diadaptasi: `awcms_mini_x` /
 * `awcms-mini_x` / `AWCMS_MINI_X` — identifier tabel/env-var bergaya
 * `awcms(-|_)mini_<suffix>` yang seharusnya menjadi `awcms_<suffix>` /
 * `AWCMS_<SUFFIX>` di repo ini. Regex mewajibkan underscore tepat setelah
 * "mini" (bukan hyphen) supaya referensi majemuk yang sah ke repo acuan
 * (mis. nama skill `awcms-mini-ui-screen`, tautan `docs/awcms-mini/`, atau
 * sebutan bare "awcms-mini") tidak pernah cocok — pola itu selalu memakai
 * hyphen kedua, tidak pernah underscore.
 * @param {string} file
 * @param {string[]} lines
 * @returns {Problem[]}
 */
export function checkNaming(file, lines) {
  /** @type {Problem[]} */
  const problems = [];
  const pattern = /awcms[_-]mini_[a-z0-9]/i;
  lines.forEach((line, i) => {
    if (!pattern.test(line)) return;
    const lineNumber = i + 1;
    if (NAMING_EXEMPTIONS.has(`${file}:${lineNumber}`)) return;
    problems.push({
      file,
      line: lineNumber,
      message:
        "kemungkinan sisa penamaan repo acuan yang belum diadaptasi (gunakan prefix awcms_/AWCMS_, bukan awcms_mini_/AWCMS_MINI_)"
    });
  });
  return problems;
}

/**
 * Tautan Markdown yang diekstrak.
 * @typedef {{ target: string, index: number, line: number }} ExtractedLink
 */

/**
 * Ekstrak seluruh tautan `[teks](target)` beserta nomor barisnya.
 * @param {string} content
 * @returns {ExtractedLink[]}
 */
export function extractLinks(content) {
  /** @type {number[]} */
  const lineOffsets = [];
  {
    let idx = 0;
    for (const ln of content.split("\n")) {
      lineOffsets.push(idx);
      idx += ln.length + 1;
    }
  }
  /** @param {number} pos */
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((lineOffsets[mid] ?? 0) <= pos) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans + 1;
  };
  /** @type {ExtractedLink[]} */
  const links = [];
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = linkRe.exec(content))) {
    let target = (m[1] ?? "").trim();
    if (target.startsWith("<") && target.endsWith(">"))
      target = target.slice(1, -1);
    links.push({ target, index: m.index, line: lineOf(m.index) });
  }
  return links;
}

/**
 * Klasifikasi tautan untuk menentukan apakah perlu diverifikasi ke disk.
 * @param {string} target
 * @returns {"empty" | "anchor" | "external" | "relative"}
 */
export function classifyLink(target) {
  if (!target || target.startsWith("#"))
    return target.startsWith("#") ? "anchor" : "empty";
  if (/^(https?:|mailto:|tel:|data:)/i.test(target)) return "external";
  return "relative";
}

/**
 * Pisahkan target relatif menjadi path + anchor.
 * @param {string} target
 * @returns {{ path: string, hash: string | undefined }}
 */
export function splitTarget(target) {
  const [path, hash] = target.split("#");
  return { path: path ?? "", hash };
}

/**
 * Parse top-level `services:` keys out of a `docker-compose*.yml` file's
 * raw text — pure string parsing, no YAML library dependency: only
 * 2-space-indented `name:` keys while the current top-level (column-0)
 * section is `services` are collected, so sibling top-level sections with
 * the same indent style (`volumes:`, `networks:`) never get misread as
 * service names.
 * @param {string} content
 * @returns {Set<string>}
 */
export function parseComposeServiceNames(content) {
  /** @type {Set<string>} */
  const names = new Set();
  let section = "";
  for (const rawLine of content.split("\n")) {
    const topLevel = /^([A-Za-z][A-Za-z0-9_-]*):\s*(#.*)?$/.exec(rawLine);
    if (topLevel) {
      section = topLevel[1] ?? "";
      continue;
    }
    if (section !== "services") continue;
    const serviceKey = /^ {2}([A-Za-z0-9][A-Za-z0-9_.-]*):\s*(#.*)?$/.exec(
      rawLine
    );
    if (serviceKey) names.add(serviceKey[1] ?? "");
  }
  return names;
}

/**
 * `docker compose`/`docker-compose` subcommands that take zero or more
 * service names as trailing positional arguments.
 */
const COMPOSE_SERVICE_LIST_SUBCOMMANDS = new Set([
  "up",
  "down",
  "restart",
  "stop",
  "start",
  "logs",
  "ps",
  "kill",
  "pause",
  "unpause",
  "top",
  "build",
  "pull",
  "rm"
]);

/** Subcommands whose FIRST positional argument is a service name, and everything after it is a command run inside that service's container (never validated as a service). */
const COMPOSE_SERVICE_THEN_COMMAND_SUBCOMMANDS = new Set(["exec", "run"]);

/** Global/subcommand flags known to take a separate value token (skipped along with the flag itself) — e.g. `-f docker-compose.prod.yml`. Any other `-`-prefixed token is treated as a valueless flag. */
const COMPOSE_VALUE_FLAGS = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--profile",
  "--env-file"
]);

/**
 * Per-subcommand override: flags that are BOOLEAN for that specific
 * subcommand even though `COMPOSE_VALUE_FLAGS` lists the same token as
 * value-taking elsewhere — `-f`/`--follow` means "tail the log stream" for
 * `docker compose logs`, not "read this compose file", so it must never
 * swallow the next token (which is the actual service name being checked).
 */
const COMPOSE_BOOLEAN_FLAG_OVERRIDES = new Map([
  ["logs", new Set(["-f", "--follow"])]
]);

const COMPOSE_COMMAND_PATTERN =
  /\bdocker(?:-compose|\s+compose)\s+([a-zA-Z][\w-]*)((?:\s+\S+)*)/g;

/**
 * Cari referensi service dalam SATU snippet kode yang sudah terisolasi
 * (satu baris di dalam fenced code block, atau isi satu inline code span)
 * — tidak pernah dipanggil dengan teks prosa mentah, itulah yang membuat
 * pemotongan token di bawah aman: tidak ada kalimat lanjutan setelah span
 * kode yang bisa ikut tertelan.
 * @param {string} snippet
 * @returns {{ subcommand: string, candidates: string[] } | null}
 */
function findComposeServiceCandidates(snippet) {
  COMPOSE_COMMAND_PATTERN.lastIndex = 0;
  const match = COMPOSE_COMMAND_PATTERN.exec(snippet);
  if (!match) return null;

  const subcommand = match[1] ?? "";
  const rest = (match[2] ?? "").trim();
  const tokens = rest.length > 0 ? rest.split(/\s+/) : [];

  const booleanOverrides = COMPOSE_BOOLEAN_FLAG_OVERRIDES.get(subcommand);

  /** @type {string[]} */
  const positional = [];
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t] ?? "";
    if (token.startsWith("-")) {
      if (!booleanOverrides?.has(token) && COMPOSE_VALUE_FLAGS.has(token)) t++;
      continue;
    }
    positional.push(token);
  }

  if (COMPOSE_SERVICE_LIST_SUBCOMMANDS.has(subcommand)) {
    return { subcommand, candidates: positional };
  }
  if (
    COMPOSE_SERVICE_THEN_COMMAND_SUBCOMMANDS.has(subcommand) &&
    positional.length > 0
  ) {
    return { subcommand, candidates: [positional[0] ?? ""] };
  }
  return { subcommand, candidates: [] };
}

/**
 * Verifikasi bahwa setiap service name referenced in a `docker compose`/
 * `docker-compose` command actually exists in the given compose service
 * set. Deliberately scoped to CODE ONLY — fenced ```` ```...``` ```` block
 * lines and inline `` `...` `` code spans — never raw prose. Also
 * deliberately narrow on WHICH subcommands are validated: only a
 * RECOGNIZED subcommand immediately after `docker compose`/`docker-compose`
 * is checked (`up`/`down`/`exec`/`run`/... — see the two subcommand sets
 * above). `docker compose config`, `docker compose` with no subcommand,
 * etc. are skipped, never guessed at.
 *
 * Repo ini belum punya `docker-compose*.yml` (belum ada image/deploy
 * container) — `serviceNames` akan kosong sampai file itu ada, sehingga
 * check ini hanya benar-benar menemukan masalah begitu ada
 * `docker-compose*.yml` DAN prosa dokumentasi menyebut nama service yang
 * salah.
 * @param {string} file
 * @param {string} content
 * @param {ReadonlySet<string>} serviceNames
 * @returns {Problem[]}
 */
export function checkComposeServiceNames(file, content, serviceNames) {
  /** @type {Problem[]} */
  const problems = [];
  let inFence = false;

  content.split("\n").forEach((rawLine, i) => {
    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence;
      return;
    }

    /** @type {string[]} */
    const snippets = [];
    if (inFence) {
      snippets.push(rawLine.replace(/\s+#.*$/, ""));
    } else {
      const inlineRe = /`([^`\n]+)`/g;
      let m;
      while ((m = inlineRe.exec(rawLine))) {
        snippets.push((m[1] ?? "").replace(/\s+#.*$/, ""));
      }
    }

    for (const snippet of snippets) {
      const found = findComposeServiceCandidates(snippet);
      if (!found) continue;
      for (const candidate of found.candidates) {
        if (candidate.length === 0) continue;
        if (!serviceNames.has(candidate)) {
          problems.push({
            file,
            line: i + 1,
            message: `docker compose service tidak dikenal: "${candidate}" (subcommand "${found.subcommand}") — cek nama service di docker-compose.yml`
          });
        }
      }
    }
  });

  return problems;
}
