#!/usr/bin/env bun
/**
 * Sinkronisasi dua arah antara memory agent Claude Code (di luar repo, per-device)
 * dan snapshot-nya yang ter-commit di `docs/awcms/agent-memory.md`.
 *
 * Diadaptasi dari awcms-mini (`scripts/sync-agent-memory.ts`) — pola keluarga
 * yang sama, dengan path doc, header, redaksi placeholder, dan exclusion khas awcms.
 *
 * Memory agent hidup di `~/.claude/projects/<slug-cwd>/memory/` — **di luar** repo,
 * sehingga tidak ikut `git clone` dan hilang saat pindah device. Doc snapshot ini
 * membuatnya bisa dipulihkan:
 *
 *   bun run memory:docs:sync     # memory  -> docs (setelah menulis/mengubah memory)
 *   bun run memory:docs:restore  # docs    -> memory (device baru / checkout baru)
 *   bun run memory:docs:check    # gagal bila docs melenceng dari memory
 *
 * `slug` diturunkan dari cwd (`/home/data/dev_bun/awcms` →
 * `-home-data-dev-bun-awcms`), jadi device dengan path checkout berbeda
 * tetap menulis ke direktori memory-nya sendiri yang benar.
 *
 * `--check` **skip dengan exit 0** bila direktori memory tidak ada (mis. di CI
 * atau checkout segar) — gate ini menangkap drift pada device yang memang punya
 * memory, bukan memaksa CI memilikinya.
 */

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logScriptFailure } from "../src/lib/logging/error-log";

const DOC_PATH = path.resolve(process.cwd(), "docs/awcms/agent-memory.md");
const BEGIN =
  "<!-- BEGIN GENERATED MEMORY — jangan edit manual, jalankan `bun run memory:docs:sync` -->";
const END = "<!-- END GENERATED MEMORY -->";
const FILE_OPEN = "<!-- memory-file:";
const FILE_CLOSE = "-->";

function memoryDir(): string {
  // Skema slug Claude Code: setiap karakter non-alfanumerik pada path absolut cwd
  // menjadi `-` (`/home/data/dev_bun/awcms` → `-home-data-dev-bun-awcms`,
  // perhatikan `_` ikut menjadi `-`).
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug, "memory");
}

/**
 * Memory yang TIDAK BOLEH masuk snapshot. Repo ini publik.
 * Kriteria: device-specific (tak berguna di device lain) DAN/ATAU berbentuk-kredensial.
 * Menambah entri di sini = memory itu tidak ikut `restore` di device baru — sebutkan
 * alasannya, jangan diam-diam.
 */
const EXCLUDE = new Map<string, string>([
  [
    "awcms-local-postgres-docker.md",
    "Device-specific: nama container dev + port, pola netns lokal, dan password role Postgres throwaway (`awcms:awcms`). Tidak berguna di device lain — tiap device menjalankan container-nya sendiri."
  ]
]);

/**
 * Sanitasi isi memory sebelum diterbitkan ke repo publik.
 * Redaksi di sini bersifat defence-in-depth: aturan utamanya tetap "jangan pernah
 * menulis secret nyata ke memory".
 */
/**
 * `description:` YAML tanpa kutip akan **terpotong pada `#`** — YAML
 * memperlakukannya sebagai awal komentar. Memory di repo ini penuh rujukan
 * issue (`#171`), jadi ini bukan kasus tepi.
 *
 * Karena itu snapshot selalu menerbitkan `description` dalam kutip ganda.
 */
function quoteDescription(content: string): string {
  return content.replace(/^description:[ \t]*(.*)$/m, (line, raw: string) => {
    const value = raw.trim();
    // Sudah dikutip (dan bukan sekadar diawali kutip di tengah kalimat) → biarkan.
    if (/^".*"$/s.test(value) || /^'.*'$/s.test(value)) return line;
    if (value === "") return line;
    return `description: "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
}

function sanitize(content: string): string {
  return quoteDescription(
    content
      // UUID sesi personal — tak bermakna di device/sesi lain.
      .replace(/^\s*originSessionId:.*$\n?/gm, "")
      // Home directory device-specific → `~`. HANYA homedir sungguhan: pola
      // `/home/<apa saja>` generik akan merusak path proyek bersama yang bermakna
      // (mis. `/home/data/dev_react/awcms-mini`, sumber kebenaran keluarga).
      .replace(
        new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "~"
      )
      // Placeholder berbentuk-password (mirror `.env.example`) — diredaksi supaya
      // secret scanner tidak menandai dokumen ini. Lihat `.env.example` untuk nilainya.
      .replace(/awcms_app_password/g, "<redacted — lihat .env.example>")
      .replace(/awcms_password/g, "<redacted — lihat .env.example>")
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readMemoryFiles(dir: string): Promise<Map<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !EXCLUDE.has(e.name))
    .map((e) => e.name)
    // MEMORY.md dulu (indeks), sisanya alfabetis — urutan stabil supaya diff bermakna.
    .sort((a, b) =>
      a === "MEMORY.md" ? -1 : b === "MEMORY.md" ? 1 : a.localeCompare(b)
    );

  const out = new Map<string, string>();
  for (const name of names) {
    out.set(name, sanitize(await readFile(path.join(dir, name), "utf8")));
  }
  return out;
}

/** Bagian generated: satu blok per file memory, dibungkus penanda yang bisa di-parse balik. */
function renderGenerated(files: Map<string, string>): string {
  const blocks: string[] = [];
  for (const [name, content] of files) {
    blocks.push(
      `${FILE_OPEN} ${name} ${FILE_CLOSE}\n\n\`\`\`\`\`markdown\n${content.trimEnd()}\n\`\`\`\`\`\n`
    );
  }
  return `${BEGIN}\n\n${blocks.join("\n")}\n${END}`;
}

function parseGenerated(doc: string): Map<string, string> {
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(
      `Penanda ${BEGIN} / ${END} tidak ditemukan di ${DOC_PATH}.`
    );
  }
  const body = doc.slice(start + BEGIN.length, end);
  const out = new Map<string, string>();
  const re =
    /<!-- memory-file:\s*(.+?)\s*-->\s*\n\n`````markdown\n([\s\S]*?)\n`````/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [, name, content] = m;
    if (!name || content === undefined) continue;
    // `name` comes from Markdown, and `restore` joins it onto the memory
    // directory before writing — so a crafted marker
    // (`<!-- memory-file: ../../../../.bashrc -->`) would write outside that
    // directory entirely. Accept only a plain `.md` basename; anything else is
    // a malformed or hostile snapshot, and failing loudly beats writing
    // somewhere unexpected.
    if (name !== path.basename(name) || !name.endsWith(".md")) {
      throw new Error(
        `Nama file memory tidak valid dalam snapshot: ${JSON.stringify(name)}. ` +
          `Harus berupa basename ".md" tunggal, tanpa komponen path.`
      );
    }
    out.set(name, `${content}\n`);
  }
  return out;
}

function renderExclusions(): string {
  if (EXCLUDE.size === 0) return "";
  const rows = [...EXCLUDE].map(
    ([name, why]) => `| \`${name.replace(/\.md$/, "")}\` | ${why} |`
  );
  return `## Sengaja TIDAK disertakan

Repo ini **publik**. Memory berikut tetap ada di device asalnya tetapi **tidak** masuk snapshot — jadi \`restore\` **tidak** akan memulihkannya, dan itu memang disengaja:

| Memory | Alasan |
| --- | --- |
${rows.join("\n")}

Isi yang tetap disertakan juga disanitasi otomatis: \`originSessionId\` dibuang, path home diganti \`~\`, dan placeholder berbentuk-password diredaksi (nilainya ada di \`.env.example\`).

Konsekuensi yang disengaja: \`MEMORY.md\` dan beberapa memory lain **tetap** merujuk memory yang dikecualikan (baris indeks + \`[[wikilink]]\`). Setelah \`restore\`, rujukan itu **menggantung** — itu normal, bukan snapshot rusak. Tulis ulang memory-nya secara lokal bila device baru memang membutuhkannya.

`;
}

function header(count: number): string {
  return `# Snapshot Memory Agent AWCMS

> **File ini di-generate.** Jangan edit bagian generated secara manual — ubah memory-nya lalu jalankan \`bun run memory:docs:sync\`.

Memory agent Claude Code disimpan di \`~/.claude/projects/<slug-cwd>/memory/\` — **di luar repo**, sehingga **tidak ikut \`git clone\`** dan hilang saat berpindah device. Dokumen ini adalah snapshot ter-commit-nya, supaya konteks pengembangan bisa dipulihkan di device mana pun.

## Cara pakai

| Perintah | Arah | Kapan |
| --- | --- | --- |
| \`bun run memory:docs:sync\` | memory → docs | **Setiap kali** menulis/mengubah/menghapus memory, sebelum commit |
| \`bun run memory:docs:restore\` | docs → memory | Device baru / checkout baru — memulihkan seluruh memory |
| \`bun run memory:docs:check\` | verifikasi | Gagal bila docs melenceng dari memory (skip bila memory tak ada) |

\`slug\` diturunkan dari cwd, jadi device dengan path checkout berbeda tetap menulis ke direktori memory-nya sendiri yang benar.

## Aturan

- **Sumber kebenaran = memory aktif**, bukan dokumen ini. Saat konflik, \`memory:docs:sync\` menang; \`restore\` hanya untuk device yang memory-nya kosong.
- \`restore\` **menimpa** file bernama sama di memory. Pada device yang sudah punya memory lebih baru, jalankan \`sync\` dulu.
- Repo ini **publik**. Jangan pernah menulis secret/kredensial nyata ke memory — nilai seperti \`awcms_password\` adalah placeholder yang sama dengan \`.env.example\` dan memang sudah publik.
- \`MEMORY.md\` adalah indeks yang dimuat tiap sesi; file lain dimuat sesuai relevansi.

**Jumlah memory saat snapshot terakhir: ${count}.**

${renderExclusions()}`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const mode = args.find((a) => a !== "--force") ?? "--sync";
  const dir = memoryDir();

  if (mode === "--restore") {
    if (!(await exists(DOC_PATH)))
      throw new Error(`Tidak ada ${DOC_PATH} untuk dipulihkan.`);
    const files = parseGenerated(await readFile(DOC_PATH, "utf8"));
    if (files.size === 0)
      throw new Error("Snapshot kosong — tidak ada yang dipulihkan.");

    // Restore MENIMPA, dan snapshot sudah tersanitasi — memulihkan ke atas
    // memory hidup menimpa isi asli dengan versi teredaksi, satu arah dan
    // tak bisa dibatalkan. Karena itu restore menolak menimpa kecuali diminta
    // eksplisit.
    const collisions: string[] = [];
    for (const name of files.keys()) {
      if (await exists(path.join(dir, name))) collisions.push(name);
    }
    if (collisions.length > 0 && !force) {
      throw new Error(
        `Menolak menimpa ${collisions.length} file memory yang sudah ada di ${dir}\n` +
          `  (mis. ${collisions.slice(0, 3).join(", ")}${collisions.length > 3 ? ", …" : ""})\n\n` +
          `Restore ditujukan untuk device/checkout BARU yang memory-nya kosong.\n` +
          `Snapshot ini TERSANITASI (originSessionId dibuang, homedir → ~, placeholder\n` +
          `password diredaksi) — menimpanya ke atas memory hidup akan menanamkan hasil\n` +
          `redaksi itu secara permanen.\n\n` +
          `Bila memory hidup memang lebih baru: jalankan \`bun run memory:docs:sync\`.\n` +
          `Bila benar-benar ingin menimpa: tambahkan \`--force\`.`
      );
    }

    await mkdir(dir, { recursive: true });
    for (const [name, content] of files) {
      await writeFile(path.join(dir, name), content, "utf8");
    }
    console.log(
      `Memulihkan ${files.size} file memory ke ${dir}${force && collisions.length > 0 ? ` (--force: ${collisions.length} ditimpa)` : ""}`
    );
    return;
  }

  if (!(await exists(dir))) {
    if (mode === "--check") {
      console.log(`Tidak ada direktori memory (${dir}) — check dilewati.`);
      return;
    }
    throw new Error(
      `Tidak ada direktori memory (${dir}). Pakai --restore untuk memulihkan dari docs.`
    );
  }

  const files = await readMemoryFiles(dir);
  const generated = renderGenerated(files);
  const next = `${header(files.size)}${generated}\n`;

  if (mode === "--check") {
    const current = (await exists(DOC_PATH))
      ? await readFile(DOC_PATH, "utf8")
      : "";
    if (current.trim() !== next.trim()) {
      console.error(
        `${DOC_PATH} melenceng dari memory aktif (${files.size} file).\n` +
          `Jalankan: bun run memory:docs:sync`
      );
      process.exit(1);
    }
    console.log(`Snapshot memory sinkron (${files.size} file).`);
    return;
  }

  await writeFile(DOC_PATH, next, "utf8");
  console.log(
    `Menulis ${files.size} file memory ke ${path.relative(process.cwd(), DOC_PATH)}`
  );
}

main().catch((err) => {
  logScriptFailure("memory:docs sync FAILED", err);
  process.exit(1);
});
