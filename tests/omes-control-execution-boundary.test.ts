/**
 * Issue #1185 - execution boundary of the `omes_control` surface.
 *
 * `omes_control` is a tenant-scoped record store plus an owner/operator API.
 * Execution belongs to the enrolled OMES pull worker (outbound HTTPS pull,
 * ADR-0027 of the producer) and never to this application: the moment a file
 * under the module, its API routes or its admin screens can spawn a process,
 * open a shell/SSH session, open a raw socket or call an arbitrary host, this
 * repository has taken back the runtime-execution ownership that the module
 * README says it does not have.
 *
 * STATIC, no database, no network. The scanner removes comments first (so
 * prose about `child_process` is not a finding) and then looks at code:
 *
 * - module specifiers, in every spelling (`import ... from`, side-effect
 *   `import "x"`, `import("x")`, `require("x")`), with or without `node:`;
 * - `Bun.spawn`/`spawnSync`/`$`/`connect`/`udpSocket`, and named imports of
 *   `spawn`/`$` from `bun`;
 * - bare calls `exec(`/`execSync(`/`execFile(`/`spawn(`/`fork(` (a method call
 *   such as `RE.exec(x)` is a RegExp, not a shell, and is allowed);
 * - `eval(`, `new Function(`, `process.binding(`;
 * - any `fetch(` whose first argument is not a same-origin path literal, plus
 *   `WebSocket`, `EventSource`, `XMLHttpRequest`.
 *
 * Contract JSON and fixtures are excluded on purpose: several fixtures are
 * named `invalid-free-form-command*` and carry the very strings this test
 * forbids, to prove the contract REJECTS them.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const MODULE_ROOT = path.join(ROOT, "src", "modules", "omes-control");
const SCAN_ROOTS = [
  MODULE_ROOT,
  path.join(ROOT, "src", "pages", "api", "v1", "omes"),
  path.join(ROOT, "src", "pages", "admin", "omes")
];
const SCAN_FILES = [
  path.join(ROOT, "scripts", "omes-contract-preflight.ts"),
  path.join(ROOT, "scripts", "sync-omes-contracts.ts")
];
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".astro"
]);

/** Removes `//` and block comments outside string/template literals. */
function withoutComments(source: string, blankQuotedStrings = false): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (quote) {
      // Quoted ('/") text can be blanked for the code rules; templates stay
      // visible (a `${...}` expression is code).
      const blank = blankQuotedStrings && quote !== "`";
      if (c === "\\") {
        out += blank ? "  " : `${c}${n ?? ""}`;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += blank && quote !== null ? " " : c;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const FORBIDDEN_MODULES = new Set([
  "child_process",
  "net",
  "tls",
  "dgram",
  "dns",
  "http",
  "https",
  "http2",
  "vm",
  "cluster",
  "worker_threads",
  "ssh2",
  "ssh2-sftp-client",
  "node-ssh",
  "simple-git",
  "cross-spawn",
  "execa",
  "shelljs",
  "zx"
]);

const SPECIFIER_RES = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];

const CODE_RULES: Array<{ label: string; pattern: RegExp; raw?: boolean }> = [
  {
    label: "Bun process/socket API",
    pattern: /\bBun\s*\.\s*(spawn|spawnSync|\$|connect|udpSocket)(?![\w$])/
  },
  {
    label: "spawn/$ imported from bun",
    raw: true,
    pattern:
      /\bimport\s*\{[^}]*(?:\bspawn(?:Sync)?\b|\$)[^}]*\}\s*from\s*["']bun["']/
  },
  {
    label: "bare exec/spawn call",
    pattern:
      /(?<![.\w$])(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/
  },
  { label: "eval()", pattern: /(?<![.\w$])eval\s*\(/ },
  { label: "new Function()", pattern: /\bnew\s+Function\s*\(/ },
  { label: "process.binding()", pattern: /\bprocess\s*\.\s*binding\s*\(/ },
  {
    label: "WebSocket/EventSource/XMLHttpRequest",
    pattern: /\b(WebSocket|EventSource|XMLHttpRequest)\b/
  }
];

/** Findings for one source text; empty means the file is inside the boundary. */
function scanSource(source: string): string[] {
  const code = withoutComments(source);
  const codeOnly = withoutComments(source, true);
  const findings: string[] = [];

  for (const re of SPECIFIER_RES) {
    for (const m of code.matchAll(re)) {
      const bare = m[1]!.replace(/^node:/, "");
      if (FORBIDDEN_MODULES.has(bare.split("/")[0]!)) {
        findings.push(`forbidden module "${m[1]}"`);
      }
    }
  }
  for (const { label, pattern, raw } of CODE_RULES) {
    if (pattern.test(raw ? code : codeOnly)) findings.push(label);
  }
  // fetch: only a literal same-origin path ("/api/...") is allowed.
  for (const m of code.matchAll(/(?<![.\w$])fetch\s*\(\s*([^)]{0,80})/g)) {
    const arg = m[1]!.trim();
    if (!/^["'`]\/(?!\/)/.test(arg)) {
      findings.push(`fetch to a non-same-origin or non-literal target: ${arg}`);
    }
  }
  return findings;
}

function collect(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) {
      // Vendored contract JSON/fixtures are data, not code (see header).
      if (full === path.join(MODULE_ROOT, "contracts")) continue;
      collect(full, out);
    } else if (CODE_EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

describe("omes_control carries no execution capability (#1185)", () => {
  const files = [...SCAN_ROOTS.flatMap((r) => collect(r)), ...SCAN_FILES];

  test("the scan really covers the module, its routes and its admin screens", () => {
    const rel = files.map((f) => path.relative(ROOT, f));
    expect(files.length).toBeGreaterThan(40);
    expect(
      rel.some((f) => f.startsWith("src/modules/omes-control/domain/"))
    ).toBe(true);
    expect(rel.some((f) => f.startsWith("src/pages/api/v1/omes/worker/"))).toBe(
      true
    );
    expect(rel.some((f) => f.startsWith("src/pages/admin/omes/"))).toBe(true);
  });

  test("no non-fixture file spawns, shells out, opens a socket or calls an arbitrary host", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const finding of scanSource(readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(ROOT, file)}: ${finding}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("mutants: every forbidden shape is caught, in every spelling", () => {
    const mutants: Record<string, string> = {
      "static import": `import { exec } from "node:child_process";`,
      "bare specifier": `import cp from "child_process";`,
      "side-effect import": `import "node:child_process";`,
      "dynamic import": `const m = await import("node:child_process");`,
      require: `const m = require("child_process");`,
      "subpath specifier": `import x from "node:dns/promises";`,
      ssh2: `import { Client } from "ssh2";`,
      "Bun.spawn": `Bun.spawn(["ls"]);`,
      "Bun.spawn spaced": `Bun . spawnSync(["ls"]);`,
      "Bun.$": "await Bun.$`ls`;",
      "Bun.connect": `await Bun.connect({ hostname: "x", port: 1 });`,
      "named bun import": `import { $ } from "bun";`,
      "bare exec": `execSync("ls");`,
      "bare spawn": `spawn("ls");`,
      eval: `eval("1");`,
      "new Function": `new Function("return 1");`,
      "fetch absolute": `await fetch("https://example.test/x");`,
      "fetch protocol-relative": `await fetch("//example.test/x");`,
      "fetch variable": `await fetch(url);`,
      WebSocket: `new WebSocket("wss://example.test");`,
      "process.binding": `process.binding("spawn_sync");`
    };
    for (const [name, source] of Object.entries(mutants)) {
      expect(scanSource(source), name).not.toEqual([]);
    }
  });

  test("a mutant injected into a real shipped file turns the scan red", () => {
    const real = readFileSync(
      path.join(MODULE_ROOT, "domain", "worker-identity.ts"),
      "utf8"
    );
    expect(scanSource(real)).toEqual([]);
    expect(
      scanSource(`${real}\nimport { execSync } from "node:child_process";\n`)
    ).not.toEqual([]);
  });

  test("benign shapes are not findings: comments, RegExp.exec, same-origin fetch, text in strings", () => {
    const benign = [
      `// import { exec } from "node:child_process"; Bun.spawn(["x"])`,
      `/* execSync("ls"); fetch("https://x") */ const a = 1;`,
      `const m = /a(b)/.exec(value);`,
      `const m = RE.exec(value);`,
      `await fetch("/api/v1/omes/hermes-orchestration/events", { method: "POST" });`,
      `const note = "do not call exec( from here";`,
      `const url = "https://example.test/x"; // not fetched`
    ];
    for (const source of benign) expect(scanSource(source), source).toEqual([]);
  });
});
