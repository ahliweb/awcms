/**
 * Static scanner for "does this launch manifest start anything that is not
 * Bun?" (Issue #1170, ADR-0002).
 *
 * Pure functions over text, so `tests/bun-only-launch-manifests.test.ts` can
 * drive them with positive AND negative fixtures as well as over the real
 * manifests. Nothing here touches the network, Docker or a database.
 *
 * ## What is rejected
 *
 * An actual Node.js-ecosystem launcher: `node`, `nodejs`, `npm`, `npx`, `pnpm`,
 * `pnpx`, `yarn`, `tsx`, `ts-node`, `nodemon`, `corepack` — as a command word, a
 * wrapped command word (`exec`, `sudo`, `env`, ...), a path (`/usr/bin/node`), a
 * container image (`node:22-alpine`, `docker.io/library/node`), or a shebang
 * (`#!/usr/bin/env node`). A Node-only Socket.IO / `ws` daemon is "a Node
 * process", so it is rejected by the same rule: it can only be launched by one of
 * the above.
 *
 * ## What is deliberately NOT rejected (the issue's allow-list)
 *
 * - `node:*` built-in imports (`bun -e "import 'node:fs'"`): the token is only
 *   an image reference when its tag looks like a version/variant (`node:22`,
 *   `node:lts-alpine`), never for `node:fs`.
 * - `node_modules`, `NODE_ENV=...`, `--node-...` flags: whole-token matching
 *   only, never substring matching.
 * - Scoped npm packages (`@astrojs/node`): a leading `@` is never a launcher.
 * - Comments and prose log lines: historical text about Node must not fail.
 */

export const FORBIDDEN_RUNTIMES: readonly string[] = [
  "node",
  "nodejs",
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "yarnpkg",
  "tsx",
  "ts-node",
  "ts-node-esm",
  "nodemon",
  "corepack"
];

/** Words that wrap another command: the wrapped word is what actually runs. */
const WRAPPERS = new Set([
  "exec",
  "sudo",
  "env",
  "time",
  "nohup",
  "nice",
  "xargs",
  "command"
]);

export type Violation = {
  file: string;
  line: number;
  rule: string;
  detail: string;
};

const IMAGE_TAG_LOOKS_LIKE_VERSION =
  /^(\d|lts|latest|current|alpine|slim|bookworm|trixie|bullseye|iron|jod|hydrogen|krypton)/;

/** `node`, `/usr/bin/node`, `node:22`, `docker.io/library/node@sha256:...` -> "node". */
function launcherName(token: string): string | null {
  if (token.length === 0 || token.startsWith("@") || token.startsWith("-")) {
    return null;
  }
  const withoutDigest = token.split("@")[0] ?? "";
  const base = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);
  const colon = base.indexOf(":");
  const name = colon === -1 ? base : base.slice(0, colon);
  const tag = colon === -1 ? "" : base.slice(colon + 1);

  if (!FORBIDDEN_RUNTIMES.includes(name)) return null;
  // `node:fs` is a Bun built-in import specifier; `node:22` is an image.
  if (tag !== "" && !IMAGE_TAG_LOOKS_LIKE_VERSION.test(tag)) return null;
  // A bare `node:22` with no registry path is an image; so is `library/node`.
  return name;
}

/** Remove a trailing ` # comment` when the text before it has balanced quotes. */
function stripTrailingComment(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      const before = line.slice(0, i);
      const singles = (before.match(/'/g) ?? []).length;
      const doubles = (before.match(/"/g) ?? []).length;
      if (singles % 2 === 0 && doubles % 2 === 0) return before;
    }
  }
  return line;
}

function tokens(line: string): string[] {
  return line
    .replace(/\$\(|\$\{|[;&|(){}`<>=]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^["']+|["']+$/g, ""))
    .filter((token) => token.length > 0);
}

export type ShellScanOptions = {
  /**
   * Skip lines that are only user-facing prose (`log "..."`, `echo ...`).
   * Right for `.sh` files; wrong for crontabs.
   */
  skipProseLines?: boolean;
};

/** Scan shell-ish text (shell script, crontab, systemd Exec*=, Procfile). */
export function scanShellText(
  file: string,
  text: string,
  options: ShellScanOptions = {}
): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split("\n");

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (
      options.skipProseLines &&
      /^(log|echo|printf)\b/.test(trimmed.replace(/^\S+\s*&&\s*/, ""))
    ) {
      return;
    }
    const line = stripTrailingComment(raw);

    for (const token of tokens(line)) {
      const name = launcherName(token);
      if (name !== null) {
        violations.push({
          file,
          line: index + 1,
          rule: "no-node-launcher",
          detail: `"${token}" launches ${name}, not Bun (ADR-0002)`
        });
      }
    }
  });

  return violations;
}

/** The first token of a `#!` line, if any, must not be a Node launcher. */
export function scanShebang(file: string, text: string): Violation[] {
  if (!text.startsWith("#!")) return [];
  const firstLine = text.split("\n", 1)[0] ?? "";
  const bad = tokens(firstLine.slice(2)).find(
    (token) => launcherName(token) !== null
  );
  return bad === undefined
    ? []
    : [
        {
          file,
          line: 1,
          rule: "no-node-shebang",
          detail: `shebang "${firstLine}" selects ${bad}, not Bun`
        }
      ];
}

// ---------------------------------------------------------------------------
// Bun version pin
// ---------------------------------------------------------------------------

/** `bun@1.4.4` (optionally `+sha...`) -> `1.4.4`; "" when not a Bun pin. */
export function pinnedBunVersion(packageManager: unknown): string {
  if (typeof packageManager !== "string") return "";
  const match = /^bun@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(packageManager);
  return match?.[1] ?? "";
}

const BUN_IMAGE =
  /(?:^|[\s"'=])((?:[\w.-]+(?::\d+)?\/)*oven\/bun)(?::([\w.-]+))?/g;

/**
 * Every `oven/bun[:tag]` reference must be exactly the pinned version, with an
 * optional variant suffix (`-alpine`, `-slim`, `-debian`, `-distroless`).
 * A missing tag or `latest` floats, which is how the pin silently stops being one.
 */
export function scanBunImagePins(
  file: string,
  text: string,
  pin: string
): Violation[] {
  const violations: Violation[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.trim().startsWith("#")) return;
    const line = stripTrailingComment(raw);
    for (const match of line.matchAll(BUN_IMAGE)) {
      const tag = match[2];
      const ok =
        tag !== undefined &&
        (tag === pin || tag.startsWith(`${pin}-`)) &&
        tag !== "latest";
      if (!ok) {
        violations.push({
          file,
          line: index + 1,
          rule: "bun-image-pin",
          detail: `${match[1]}${tag === undefined ? "" : `:${tag}`} is not the repo pin bun@${pin}`
        });
      }
    }
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------

export type DockerInstruction = {
  line: number;
  keyword: string;
  args: string;
  stage: string;
};

/** Join `\` continuations, drop comments, and tag each instruction with its stage. */
export function parseDockerfile(text: string): DockerInstruction[] {
  const out: DockerInstruction[] = [];
  const physical = text.split("\n");
  let stage = "";
  let buffer = "";
  let startLine = 0;

  physical.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (buffer === "" && (trimmed === "" || trimmed.startsWith("#"))) return;
    if (buffer !== "" && trimmed.startsWith("#")) return; // comment inside a continuation
    if (buffer === "") startLine = index + 1;
    if (trimmed.endsWith("\\")) {
      buffer += `${trimmed.slice(0, -1)} `;
      return;
    }
    const full = (buffer + trimmed).trim();
    buffer = "";
    const space = full.search(/\s/);
    const keyword = (space === -1 ? full : full.slice(0, space)).toUpperCase();
    const args = space === -1 ? "" : full.slice(space + 1).trim();
    if (keyword === "FROM") {
      const alias = /\sAS\s+(\S+)\s*$/i.exec(args);
      stage = alias?.[1] ?? `stage-${out.length}`;
    }
    out.push({ line: startLine, keyword, args, stage });
  });

  return out;
}

/** `["bun", "./dist/x.mjs"]` -> `["bun", "./dist/x.mjs"]`; shell form -> tokens. */
export function execWords(args: string): string[] {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through to the shell-form reading
    }
  }
  return tokens(trimmed);
}

export function scanDockerfile(
  file: string,
  text: string,
  pin: string
): Violation[] {
  const violations: Violation[] = [];
  const instructions = parseDockerfile(text);
  const stages = new Set<string>();

  for (const ins of instructions) {
    if (ins.keyword === "FROM") {
      const ref =
        ins.args.replace(/^--platform=\S+\s+/, "").split(/\s+/)[0] ?? "";
      const isStageRef = stages.has(ref);
      const bunBase = /^oven\/bun(:|$)/.test(ref);
      if (!isStageRef && !bunBase && ref !== "scratch") {
        violations.push({
          file,
          line: ins.line,
          rule: "from-must-be-bun",
          detail: `FROM ${ref}: every stage must start from oven/bun:${pin} (or a prior stage)`
        });
      }
      if (ins.stage !== "") stages.add(ins.stage);
    }

    if (ins.keyword === "RUN") {
      violations.push(
        ...scanShellText(file, ins.args).map((v) => ({ ...v, line: ins.line }))
      );
    }

    if (ins.keyword === "CMD" || ins.keyword === "ENTRYPOINT") {
      const words = execWords(ins.args);
      // `ENTRYPOINT ["sh","-c",...]` style shells are not a Bun launch, but
      // here nothing needs one; the first word must be bun so the process IS Bun.
      if (words[0] !== "bun") {
        violations.push({
          file,
          line: ins.line,
          rule: "launch-must-be-bun",
          detail: `${ins.keyword} starts "${words[0] ?? ""}", it must start "bun"`
        });
      }
      violations.push(
        ...scanShellText(file, words.join(" ")).map((v) => ({
          ...v,
          line: ins.line
        }))
      );
    }

    if (ins.keyword === "HEALTHCHECK") {
      const cmd = /\bCMD\s+(.*)$/s.exec(ins.args)?.[1] ?? "";
      if (cmd !== "" && execWords(cmd)[0] !== "bun") {
        violations.push({
          file,
          line: ins.line,
          rule: "launch-must-be-bun",
          detail: `HEALTHCHECK CMD starts "${execWords(cmd)[0] ?? ""}", it must start "bun"`
        });
      }
      violations.push(
        ...scanShellText(file, cmd).map((v) => ({ ...v, line: ins.line }))
      );
    }
  }

  violations.push(...scanBunImagePins(file, text, pin));
  return violations;
}

// ---------------------------------------------------------------------------
// systemd
// ---------------------------------------------------------------------------

export function scanSystemdUnit(file: string, text: string): Violation[] {
  const violations: Violation[] = [];
  text.split("\n").forEach((raw, index) => {
    const match = /^\s*(Exec\w*)\s*=\s*(.*)$/.exec(raw);
    if (match === null) return;
    // Strip systemd's command prefixes: -, @, +, !, !!, :
    const command = (match[2] ?? "").replace(/^[-@+!:]+/, "").trim();
    if (match[1] === "ExecStart" || match[1] === "ExecStartPre") {
      const first = tokens(command)[0] ?? "";
      const base = first.slice(first.lastIndexOf("/") + 1);
      if (base !== "bun" && base !== "docker" && base !== "flock") {
        violations.push({
          file,
          line: index + 1,
          rule: "launch-must-be-bun",
          detail: `${match[1]}= starts "${first}", it must start bun (or docker running a bun image)`
        });
      }
    }
    violations.push(
      ...scanShellText(file, command).map((v) => ({ ...v, line: index + 1 }))
    );
  });
  return violations;
}

// ---------------------------------------------------------------------------
// crontab
// ---------------------------------------------------------------------------

const CRON_SCHEDULE = /^(\S+\s+){5}/;

/** `NAME=value` lines of a crontab. */
export function crontabVariables(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (match?.[1] !== undefined) vars.set(match[1], (match[2] ?? "").trim());
  }
  return vars;
}

export function expandVariables(
  line: string,
  vars: ReadonlyMap<string, string>
): string {
  let current = line;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = current.replace(
      /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g,
      (whole, braced: string | undefined, bare: string | undefined) =>
        vars.get(braced ?? bare ?? "") ?? whole
    );
    if (next === current) break;
    current = next;
  }
  return current;
}

export type CronJob = { line: number; command: string; target: string | null };

/**
 * Active (uncommented) job lines with `$VAR`s expanded, and the `bun run`
 * target each one invokes: either directly (`... bun run <target>`) or through
 * the versioned runner (`.../run-job.sh <target>`).
 */
export function parseCrontabJobs(text: string): CronJob[] {
  const vars = crontabVariables(text);
  const jobs: CronJob[] = [];
  text.split("\n").forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) return;
    if (!CRON_SCHEDULE.test(trimmed)) return;
    const command = expandVariables(trimmed.replace(CRON_SCHEDULE, ""), vars);
    const direct = /\bbun run (\S+)/.exec(command);
    const runner = /run-job\.sh\s+(\S+)/.exec(command);
    jobs.push({
      line: index + 1,
      command,
      target: direct?.[1] ?? runner?.[1] ?? null
    });
  });
  return jobs;
}

export function scanCrontab(
  file: string,
  text: string,
  pin: string
): Violation[] {
  const vars = crontabVariables(text);
  const violations: Violation[] = [];
  // The variables carry the launcher (`AWCMS_RUN=docker run ... bun run`).
  const expanded = text
    .split("\n")
    .map((line) =>
      line.trim().startsWith("#") ? line : expandVariables(line, vars)
    )
    .join("\n");
  violations.push(...scanShellText(file, expanded));
  violations.push(...scanBunImagePins(file, expanded, pin));
  return violations;
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

type ComposeService = {
  image?: unknown;
  command?: unknown;
  entrypoint?: unknown;
  healthcheck?: { test?: unknown };
};

function composeWords(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" ");
  return typeof value === "string" ? value : "";
}

export function scanComposeServices(
  file: string,
  services: Record<string, ComposeService>,
  pin: string
): Violation[] {
  const violations: Violation[] = [];
  for (const [name, service] of Object.entries(services)) {
    const image = typeof service.image === "string" ? service.image : "";
    for (const v of scanShellText(file, image)) {
      violations.push({ ...v, detail: `service ${name}: image ${v.detail}` });
    }
    violations.push(...scanBunImagePins(file, image, pin));
    for (const field of ["command", "entrypoint"] as const) {
      const text = composeWords(service[field]);
      for (const v of scanShellText(file, text)) {
        violations.push({
          ...v,
          detail: `service ${name}.${field}: ${v.detail}`
        });
      }
    }
    const test = composeWords(service.healthcheck?.test);
    for (const v of scanShellText(file, test)) {
      violations.push({
        ...v,
        detail: `service ${name}.healthcheck: ${v.detail}`
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// package.json scripts
// ---------------------------------------------------------------------------

function* commandSegments(script: string): Generator<string> {
  for (const segment of script.split(/&&|\|\||;|\|/)) {
    const trimmed = segment.trim();
    if (trimmed !== "") yield trimmed;
  }
}

function firstCommandWord(segment: string): string {
  const words = segment.split(/\s+/);
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || WRAPPERS.has(word)) {
      index += 1;
      continue;
    }
    return word;
  }
  return "";
}

export function scanPackageScripts(
  scripts: Record<string, string>
): Violation[] {
  const violations: Violation[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    for (const v of scanShellText(`package.json#scripts.${name}`, script)) {
      violations.push(v);
    }
  }
  return violations;
}

/**
 * A script a scheduler launches must itself be Bun end to end: every segment of
 * the command starts with `bun`, so no bare bin (`tsc`, `prettier`) whose
 * `#!/usr/bin/env node` shebang would start a Node process is in the job path.
 */
export function scanJobScript(
  target: string,
  scripts: Record<string, string>
): Violation[] {
  const file = `package.json#scripts.${target}`;
  const script = scripts[target];
  if (script === undefined) {
    return [
      {
        file,
        line: 0,
        rule: "job-target-resolves",
        detail: `no script "${target}"`
      }
    ];
  }
  const violations: Violation[] = [];
  for (const segment of commandSegments(script)) {
    if (firstCommandWord(segment) !== "bun") {
      violations.push({
        file,
        line: 0,
        rule: "job-script-is-bun",
        detail: `segment "${segment}" does not start with bun`
      });
    }
    const run = /^bun run (\S+)/.exec(segment);
    if (run?.[1] !== undefined && run[1] !== target) {
      violations.push(...scanJobScript(run[1], scripts));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// workflows
// ---------------------------------------------------------------------------

/**
 * No `actions/setup-node`, and every `bun-version` is the repo pin or the
 * declared `engines.bun` floor (the deliberate minimum-supported cell, ADR-0032).
 */
export function scanWorkflow(
  file: string,
  text: string,
  pin: string,
  floor: string
): Violation[] {
  const violations: Violation[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.trim().startsWith("#")) return;
    if (/uses:\s*actions\/setup-node\b/.test(raw)) {
      violations.push({
        file,
        line: index + 1,
        rule: "no-setup-node",
        detail: "actions/setup-node installs Node.js; the toolchain is Bun-only"
      });
    }
    const version = /bun-version:\s*["']?([^"'\s#]+)/.exec(raw)?.[1];
    if (version !== undefined && version !== pin && version !== floor) {
      violations.push({
        file,
        line: index + 1,
        rule: "bun-version-pin",
        detail: `bun-version ${version} is neither the pin ${pin} nor the floor ${floor}`
      });
    }
  });
  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.detail}`)
    .join("\n");
}
