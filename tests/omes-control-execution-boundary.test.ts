/**
 * Issue #1185 - execution boundary of the `omes_control` surface.
 *
 * `omes_control` is a tenant-scoped record store plus an owner/operator API.
 * Execution belongs to the enrolled OMES pull worker (outbound HTTPS pull,
 * ADR-0027 of the producer) and never to this application: the moment a file
 * under the module, its API routes, its admin screens or its job scripts can
 * spawn a process, open a shell/SSH session, open a raw socket or call an
 * arbitrary host, this repository has taken back the runtime-execution
 * ownership that the module README says it does not have.
 *
 * STATIC, no database, no network, and deliberately a TRIPWIRE, not a sandbox:
 * it makes the common ways of reaching those capabilities fail the gate and
 * forces anything unusual through a reviewed allowlist in this file.
 *
 * It does not tokenise by regex. Every code part (a `.ts`/`.js` file, an
 * `.astro` frontmatter, each `<script>` body) goes through `Bun.Transpiler`,
 * a real parser: comments and types are gone, regex literals and template
 * literals are normalised, `import(\`x\`)` becomes `import("x")`. Then:
 *
 * - module specifiers come from `Transpiler.scanImports` (static, dynamic and
 *   `require`), so every spelling is seen; any `import(...)`/`require` the
 *   scanner could not resolve to a literal is itself a finding;
 * - a FORBIDDEN-IDENTIFIER list is matched anywhere in the parsed code, in
 *   any position (call, property, destructuring, alias, optional chain,
 *   `["bracket"]` access reaches the name through its string, so the string is
 *   matched too): `Bun`, `Deno`, `globalThis`, `Function`, `eval`, `spawn*`,
 *   `exec*`, `fork`, `sendBeacon`, `WebSocket`, `EventSource`,
 *   `XMLHttpRequest`, `Worker`, `.constructor`, `process.binding`/`dlopen`;
 * - `fetch` is allowed ONLY as a call whose first argument is a literal
 *   `/api/` path (same origin, no `//host` or `/\host` trick);
 * - the one legitimate egress wrapper, `ssrfSafeFetch`, is pinned to one file,
 *   one call and one literal host (see EGRESS_ALLOWLIST); any other use is a
 *   finding.
 *
 * Words inside strings are matched on purpose: the cost is a false positive
 * that a reviewer resolves by rewording; the alternative (blanking strings by a
 * hand-written tokenizer) is what let `/'/` blind the previous version.
 *
 * Contract JSON and fixtures are not code (extension filter), so fixtures named
 * `invalid-free-form-command*` that carry the very strings this test forbids
 * are not scanned, but any `.ts` placed beside them IS.
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
const SCRIPTS_DIR = path.join(ROOT, "scripts");
/** Every job/tooling script that mentions omes in its file name is in scope. */
const SCRIPT_NAME_RE = /omes/i;
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".astro"
]);

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
  "bun",
  "ssh2",
  "ssh2-sftp-client",
  "node-ssh",
  "simple-git",
  "cross-spawn",
  "execa",
  "shelljs",
  "zx"
]);

/** Matched as whole identifiers/words anywhere in parsed code. */
const FORBIDDEN_WORDS = [
  "Bun",
  "Deno",
  "globalThis",
  "Function",
  "eval",
  "spawn",
  "spawnSync",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
  "sendBeacon",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "dlopen",
  "_linkedBinding"
];
const WORD_RES = FORBIDDEN_WORDS.map(
  (w) =>
    [w, new RegExp(`(?<![\\w$])${w.replace("$", "\\$")}(?![\\w$])`)] as const
);

/**
 * The only egress this surface may have. `ssrfSafeFetch` may appear in exactly
 * this file, as one import plus one call whose URL is the literal GitHub API
 * base joined with a path (the host is never derived from tenant input).
 */
const EGRESS_ALLOWLIST = {
  file: "src/modules/omes-control/application/repository-progress-poller.ts",
  wrapper: "ssrfSafeFetch",
  hostConst: /const GITHUB_API_BASE = "https:\/\/api\.github\.com";/,
  call: /ssrfSafeFetch\(\s*`\$\{GITHUB_API_BASE\}\$\{path\}`/g
};

type Kind = "ts" | "tsx" | "js" | "astro";

function kindOf(file: string): Kind {
  const ext = path.extname(file);
  if (ext === ".astro") return "astro";
  if (ext === ".tsx") return "tsx";
  if (ext === ".ts") return "ts";
  return "js";
}

/** Code parts of a source file plus, for `.astro`, the markup left over. */
function splitParts(
  source: string,
  kind: Kind
): {
  code: Array<{ text: string; loader: "ts" | "tsx" | "js" }>;
  markup: string;
} {
  if (kind !== "astro") {
    return { code: [{ text: source, loader: kind }], markup: "" };
  }
  const code: Array<{ text: string; loader: "ts" | "tsx" | "js" }> = [];
  let rest = source;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rest);
  if (fm) {
    code.push({ text: fm[1]!, loader: "ts" });
    rest = rest.slice(fm[0].length);
  }
  rest = rest.replace(
    /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
    (_all, body: string) => {
      code.push({ text: body, loader: "ts" });
      return " ";
    }
  );
  rest = rest
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return { code, markup: rest };
}

function wordFindings(text: string, out: string[]): void {
  for (const [word, re] of WORD_RES) {
    if (re.test(text)) out.push(`forbidden identifier "${word}"`);
  }
  // `exec` as a method (`RE.exec(x)`) is a RegExp, not a shell; anything else is.
  if (/(?<![.\w$])exec(?![\w$])/.test(text))
    out.push('forbidden identifier "exec"');
  if (/(?<![\w$])new\s+(?:Shared)?Worker(?![\w$])/.test(text)) {
    out.push("new Worker()");
  }
  if (/\.\s*constructor(?![\w$])/.test(text)) {
    out.push('forbidden member ".constructor" (Function constructor)');
  }
  if (/\bprocess\s*(?:\?\.|\.|\[\s*["'])\s*binding\b/.test(text)) {
    out.push("process.binding");
  }
}

/** Findings for one source text; empty means the file is inside the boundary. */
export function scanSource(
  source: string,
  kind: Kind = "ts",
  relFile = "<inline>"
): string[] {
  const findings: string[] = [];
  const { code, markup } = splitParts(source, kind);
  const texts: string[] = [];

  for (const part of code) {
    // A shebang is not valid inside a module body for the transpiler.
    const text = part.text.replace(/^#!.*/, "//");
    const transpiler = new Bun.Transpiler({ loader: part.loader });
    let js: string;
    let imports: Array<{ path: string; kind: string }>;
    try {
      js = transpiler.transformSync(text);
      imports = transpiler.scanImports(text);
    } catch (error) {
      findings.push(`unparseable code part (fail closed): ${String(error)}`);
      continue;
    }
    texts.push(js);

    for (const imp of imports) {
      const bare = imp.path.replace(/^node:/, "");
      if (FORBIDDEN_MODULES.has(bare.split("/")[0]!)) {
        findings.push(`forbidden module "${imp.path}"`);
      }
    }
    const dynamicLiteral = imports.filter(
      (i) => i.kind === "dynamic-import"
    ).length;
    const requireLiteral = imports.filter(
      (i) => i.kind === "require-call"
    ).length;
    const dynamicSeen = (js.match(/(?<![\w$])import\s*\(/g) ?? []).length;
    const requireSeen = (
      js.match(/(?<![\w$-])require(?![\w$])(?!\s+[A-Za-z])/g) ?? []
    ).length;
    if (dynamicSeen > dynamicLiteral) {
      findings.push("import() with a non-literal specifier");
    }
    if (requireSeen > requireLiteral) {
      findings.push('require used other than as require("literal")');
    }
  }
  if (markup.trim()) texts.push(markup);

  const all = texts.join("\n");
  wordFindings(all, findings);

  // fetch: only a call with a literal "/api/..." first argument.
  const fetchWords = (all.match(/(?<![\w$])fetch(?![\w$])/g) ?? []).length;
  const fetchOk = (all.match(/(?<![.\w$])fetch\s*\(\s*["'`]\/api\//g) ?? [])
    .length;
  if (fetchWords > fetchOk) {
    findings.push('fetch other than fetch("/api/...") with a literal path');
  }

  // The sanctioned egress wrapper: one file, one call, one literal host.
  const wrapperRe = new RegExp(
    `(?<![\\w$])${EGRESS_ALLOWLIST.wrapper}(?![\\w$])`,
    "g"
  );
  const wrapperSeen = (all.match(wrapperRe) ?? []).length;
  if (wrapperSeen > 0) {
    const callSeen = (all.match(EGRESS_ALLOWLIST.call) ?? []).length;
    const allowed =
      relFile === EGRESS_ALLOWLIST.file &&
      EGRESS_ALLOWLIST.hostConst.test(all) &&
      callSeen === 1 &&
      wrapperSeen === 2; // the import and that one call
    if (!allowed) {
      findings.push(
        `${EGRESS_ALLOWLIST.wrapper} outside its pinned allowlist entry`
      );
    }
  }
  return findings;
}

function collect(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (CODE_EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function scriptFiles(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter(
      (f) => SCRIPT_NAME_RE.test(f) && CODE_EXTENSIONS.has(path.extname(f))
    )
    .map((f) => path.join(SCRIPTS_DIR, f));
}

describe("omes_control carries no execution capability (#1185)", () => {
  const files = [...SCAN_ROOTS.flatMap((r) => collect(r)), ...scriptFiles()];

  test("the scan really covers the module, its routes, its admin screens and every omes script", () => {
    const rel = files.map((f) => path.relative(ROOT, f));
    expect(files.length).toBeGreaterThan(40);
    expect(
      rel.some((f) => f.startsWith("src/modules/omes-control/domain/"))
    ).toBe(true);
    expect(rel.some((f) => f.startsWith("src/pages/api/v1/omes/worker/"))).toBe(
      true
    );
    expect(rel.some((f) => f.startsWith("src/pages/admin/omes/"))).toBe(true);
    // Job entrypoints named omes-*: found by glob, so a new one is covered by
    // construction; these three prove the glob is wired.
    for (const script of [
      "scripts/omes-contract-preflight.ts",
      "scripts/omes-repository-progress-poll.ts",
      "scripts/sync-omes-contracts.ts"
    ]) {
      expect(rel, script).toContain(script);
    }
    // Nothing under the contracts directory is skipped any more: a `.ts`
    // dropped beside the JSON fixtures is code and is scanned.
    expect(
      collect(MODULE_ROOT).every((f) => CODE_EXTENSIONS.has(path.extname(f)))
    ).toBe(true);
  });

  test("a package.json script that runs an omes-* file is within the scanned set", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    const scanned = new Set(files.map((f) => path.relative(ROOT, f)));
    for (const [name, cmd] of Object.entries<string>(pkg.scripts)) {
      for (const m of cmd.matchAll(/\bscripts\/([\w.-]*omes[\w.-]*\.ts)\b/gi)) {
        expect(scanned.has(`scripts/${m[1]}`), `${name} -> ${m[1]}`).toBe(true);
      }
    }
  });

  test("no non-fixture file spawns, shells out, opens a socket or calls an arbitrary host", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      for (const finding of scanSource(
        readFileSync(file, "utf8"),
        kindOf(file),
        rel
      )) {
        offenders.push(`${rel}: ${finding}`);
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
      "dynamic import template":
        "const m = await import(`node:child_process`);",
      "dynamic import non-literal": `const m = await import(name);`,
      require: `const m = require("child_process");`,
      "require template": "const m = require(`child_process`);",
      "require non-literal": `const m = require(name);`,
      "import.meta.require": `const m = import.meta.require("fs");`,
      "subpath specifier": `import x from "node:dns/promises";`,
      ssh2: `import { Client } from "ssh2";`,
      "import bun namespace": `import * as B from "bun"; B.spawn(["ls"]);`,
      "import bun named": `import { $ } from "bun";`,
      "Bun.spawn": `Bun.spawn(["ls"]);`,
      "Bun.spawn spaced": `Bun . spawnSync(["ls"]);`,
      "Bun optional chain": `Bun?.spawn(["ls"]);`,
      "Bun bracket": `Bun["spawn"](["ls"]);`,
      "Bun destructure alias": `const { spawn: s } = Bun; s(["ls"]);`,
      "Bun destructure $": `const { $: sh } = Bun; await sh\`ls\`;`,
      "Bun.$": "await Bun.$`ls`;",
      "Bun.connect": `await Bun.connect({ hostname: "x", port: 1 });`,
      "Bun.listen": `Bun.listen({ hostname: "0.0.0.0", port: 1, socket: {} });`,
      "bare exec": `execSync("ls");`,
      "bare spawn": `spawn("ls");`,
      "exec aliased": `const run = exec; run("ls");`,
      eval: `eval("1");`,
      "indirect eval": `(0, eval)("1");`,
      "globalThis.eval": `globalThis.eval("1");`,
      "new Function": `new Function("return 1");`,
      "Function without new": `Function("return 1")();`,
      "constructor chain": `(() => 1).constructor("return 1")();`,
      "fetch absolute": `await fetch("https://example.test/x");`,
      "fetch protocol-relative": `await fetch("//example.test/x");`,
      "fetch protocol-relative template": "await fetch(`//example.test/x`);",
      "fetch variable": `await fetch(url);`,
      "fetch alias": `const f = fetch; await f(url);`,
      "globalThis.fetch": `await globalThis.fetch(host);`,
      "window.fetch": `await window.fetch("/api/x");`,
      "fetch template host": "await fetch(`//${host}/x`);",
      sendBeacon: `navigator.sendBeacon("https://example.test", "x");`,
      "ssrfSafeFetch variable": `import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard"; await ssrfSafeFetch(tenantUrl);`,
      WebSocket: `new WebSocket("wss://example.test");`,
      EventSource: `new EventSource("https://example.test");`,
      Worker: `new Worker("w.js");`,
      "process.binding": `process.binding("spawn_sync");`,
      "process bracket binding": `process["binding"]("spawn_sync");`,
      "process.dlopen": `process.dlopen(m, "x.node");`,
      // L3: a quote inside a regex literal must not blind what follows.
      "regex quote then spawn": `const q = /'/;\nBun.spawn(["ls"]);`,
      "regex quote then eval": `const q = /"/;\neval("1");`,
      "regex backtick then exec": 'const q = /`/;\nexecSync("ls");',
      unparseable: `const = ;`
    };
    for (const [name, source] of Object.entries(mutants)) {
      expect(scanSource(source), name).not.toEqual([]);
    }
  });

  test("astro: frontmatter, every <script> body and template expressions are scanned", () => {
    const wrap = (inner: string) => inner;
    const cases: Record<string, string> = {
      frontmatter: wrap(
        `---\nimport cp from "node:child_process";\n---\n<p>x</p>`
      ),
      "script body": wrap(`---\n---\n<script>\nBun.spawn(["ls"]);\n</script>`),
      "second script": wrap(
        `---\n---\n<script>\nconst a = 1;\n</script>\n<script is:inline>\neval("1");\n</script>`
      ),
      "template expression": wrap(`---\n---\n<p>{fetch(url)}</p>`)
    };
    for (const [name, source] of Object.entries(cases)) {
      expect(scanSource(source, "astro"), name).not.toEqual([]);
    }
    expect(
      scanSource(
        `---\nconst a = 1;\n---\n<script>\nawait fetch("/api/v1/omes/x", { method: "POST" });\n</script>`,
        "astro"
      )
    ).toEqual([]);
  });

  test("the pinned egress entry is the only sanctioned ssrfSafeFetch use, and it is pinned exactly", () => {
    const real = readFileSync(path.join(ROOT, EGRESS_ALLOWLIST.file), "utf8");
    expect(scanSource(real, "ts", EGRESS_ALLOWLIST.file)).toEqual([]);
    // Same file content under another name: not allowed.
    expect(scanSource(real, "ts", "src/modules/omes-control/x.ts")).not.toEqual(
      []
    );
    // A second call in the allowed file, or a changed URL, is a finding.
    expect(
      scanSource(
        `${real}\nawait ssrfSafeFetch(tenantUrl, { method: "GET" });\n`,
        "ts",
        EGRESS_ALLOWLIST.file
      )
    ).not.toEqual([]);
    expect(
      scanSource(
        real.replace("`${GITHUB_API_BASE}${path}`", "path"),
        "ts",
        EGRESS_ALLOWLIST.file
      )
    ).not.toEqual([]);
    expect(
      scanSource(
        real.replace("https://api.github.com", "https://evil.test"),
        "ts",
        EGRESS_ALLOWLIST.file
      )
    ).not.toEqual([]);
  });

  test("a mutant injected into a real shipped file turns the scan red", () => {
    const rel = "src/modules/omes-control/domain/worker-identity.ts";
    const real = readFileSync(path.join(ROOT, rel), "utf8");
    expect(scanSource(real, "ts", rel)).toEqual([]);
    for (const mutant of [
      `import { execSync } from "node:child_process";`,
      `const { spawn: s } = Bun;`,
      `await globalThis.fetch(host);`
    ]) {
      expect(scanSource(`${real}\n${mutant}\n`, "ts", rel), mutant).not.toEqual(
        []
      );
    }
  });

  test("benign shapes are not findings: comments, RegExp.exec, same-origin fetch, types", () => {
    const benign = [
      `// import { exec } from "node:child_process"; Bun.spawn(["x"])`,
      `/* execSync("ls"); fetch("https://x") */ const a = 1;`,
      `const m = /a(b)/.exec(value);`,
      `const m = RE.exec(value);`,
      `const q = /'/; const r = "ok";`,
      `await fetch("/api/v1/omes/hermes-orchestration/events", { method: "POST" });`,
      `type Spawned = { pid: number }; const processed = 1;`,
      `const url = "https://example.test/x"; // not fetched`
    ];
    for (const source of benign) expect(scanSource(source), source).toEqual([]);
  });
});
