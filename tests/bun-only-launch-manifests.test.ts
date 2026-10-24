/**
 * Every way AWCMS LAUNCHES a job or worker starts Bun and nothing else —
 * Issue #1170, ADR-0002 (Bun-only).
 *
 * ## Why this exists
 *
 * `Repo hygiene` in `.github/workflows/ci.yml` greps `package.json` scripts for
 * `npm`/`node`. That is the only Bun-only gate, and it looks at one file. A job
 * is not launched from `package.json`: it is launched by a crontab line, a
 * `docker run` in `ops/run-job.sh`, a Dockerfile `CMD`, a compose service or (the
 * next realtime / channel gateway) a systemd unit. A `node dist/worker.js` in any
 * of those would pass every existing gate and put a second runtime into
 * production.
 *
 * ## What is enforced
 *
 * 1. Every launch manifest in the repo — discovered, not listed, so a new
 *    compose file or unit is covered the day it is added — invokes no Node.js
 *    launcher (`node`, `npm`, `npx`, `pnpm`, `yarn`, `tsx`, `ts-node`, ...), as a
 *    command, path, container image or shebang.
 * 2. Every `oven/bun` image and every `setup-bun` version is the `packageManager`
 *    pin (read from `package.json`, never hard-coded here) — or, for CI only, the
 *    declared `engines.bun` floor.
 * 3. Every job target a crontab schedules resolves to a `package.json` script
 *    that is Bun end to end, and so does every `command` in the module registry.
 * 4. Process identity: each worker entrypoint, imported in a child process the
 *    way `bun run <target>` runs it, sees `process.versions.bun`, a `Bun`
 *    global, and a `process.execPath` that is the Bun binary.
 *
 * ## What is deliberately allowed (the false-positive guard)
 *
 * `node:*` built-in imports, `node_modules`, `NODE_ENV`, the `@astrojs/node`
 * adapter hosted under Bun, pure npm packages run by Bun, and any prose or comment
 * that merely MENTIONS Node. See `tests/support/bun-only-launch-scan.ts`.
 *
 * ## What cannot be proved here
 *
 * No container is started, so "the process inside the deployed container is
 * Bun" is covered by what produces it — the image tag, the `CMD`, the `docker
 * run ... bun run` — and by the identity probe running the same entrypoints
 * under the Bun that CI installed. A deployed-container smoke test (`docker
 * run <image> bun -e 'process.exit(process.versions.bun ? 0 : 1)'`) needs a
 * Docker daemon and is out of scope for this static gate.
 *
 * ## Extending it (future channel adapters, realtime gateway)
 *
 * A new worker or gateway is covered, with no edit to this file, when it
 * (a) is a module `ModuleDescriptor.jobs` entry or a crontab line — its
 * `package.json` script and entrypoint are then scanned and import-probed — and
 * (b) keeps its launch manifest in a file this test discovers (`Dockerfile*`,
 * `*.crontab`, `docker-compose*.yml`/`compose*.yml`, `*.service`, `*.sh`). A
 * channel worker that must stay import-probed should be added to
 * `CHANNEL_WORKER_TARGETS` below, which turns "it disappeared from the registry"
 * into a failure rather than silence. Adding a manifest KIND this test does not
 * discover (say, a Kubernetes manifest) means adding a classifier to
 * `discoverManifests` and a scanner in `tests/support/bun-only-launch-scan.ts`
 * with positive and negative fixtures here.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { listModules } from "../src/modules";
import {
  crontabVariables,
  expandVariables,
  formatViolations,
  parseCrontabJobs,
  parseDockerfile,
  pinnedBunVersion,
  scanBunImagePins,
  scanComposeServices,
  scanCrontab,
  scanDockerfile,
  scanJobScript,
  scanPackageScripts,
  scanShebang,
  scanShellText,
  scanSystemdUnit,
  scanWorkflow,
  type Violation
} from "./support/bun-only-launch-scan";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  packageManager?: unknown;
  engines?: { bun?: string };
  scripts: Record<string, string>;
};
const PIN = pinnedBunVersion(pkg.packageManager);
const FLOOR = /(\d+\.\d+\.\d+)/.exec(pkg.engines?.bun ?? "")?.[1] ?? "";

/**
 * Channel / delivery workers whose entrypoints must stay discoverable and
 * import-probed. Add the target of every new delivery adapter worker here
 * (StarSender/Meta, Mailketing v2, Telegram customer, social publication, a
 * Bun realtime gateway) so removing it from the registry cannot pass silently.
 */
const CHANNEL_WORKER_TARGETS = [
  "email:dispatch",
  "whatsapp:dispatch",
  "push:dispatch",
  "telegram:dispatch",
  "domain-events:dispatch"
] as const;

// ---------------------------------------------------------------------------
// Manifest discovery
// ---------------------------------------------------------------------------

type ManifestKind =
  "dockerfile" | "crontab" | "compose" | "systemd" | "shell" | "procfile";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "graphify-out",
  ".astro",
  "var",
  "coverage",
  "docs",
  "tests",
  "data",
  "knowledge",
  "public",
  "locales",
  "sql",
  "openapi",
  "asyncapi",
  "fixtures"
]);

function classify(file: string): ManifestKind | null {
  const base = path.basename(file);
  if (/^Dockerfile(\..+)?$/.test(base) || /\.Dockerfile$/.test(base)) {
    return "dockerfile";
  }
  if (/\.crontab$/.test(base)) return "crontab";
  if (/^(docker-)?compose([.-].+)?\.ya?ml$/.test(base)) return "compose";
  if (/\.service$/.test(base)) return "systemd";
  if (/\.sh$/.test(base)) return "shell";
  if (base === "Procfile") return "procfile";
  return null;
}

function discoverManifests(
  dir = ROOT,
  found: { file: string; kind: ManifestKind }[] = []
): { file: string; kind: ManifestKind }[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP_DIRS.has(name)) continue;
    if (statSync(full).isDirectory()) {
      discoverManifests(full, found);
      continue;
    }
    const kind = classify(full);
    if (kind !== null) {
      found.push({ file: path.relative(ROOT, full), kind });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

function scanManifest(file: string, kind: ManifestKind): Violation[] {
  const text = read(file);
  switch (kind) {
    case "dockerfile":
      return scanDockerfile(file, text, PIN);
    case "crontab":
      return scanCrontab(file, text, PIN);
    case "compose": {
      const doc = parseYaml(text) as {
        services?: Record<string, Record<string, unknown>>;
      } | null;
      return scanComposeServices(file, doc?.services ?? {}, PIN);
    }
    case "systemd":
      return scanSystemdUnit(file, text);
    case "shell":
      return [
        ...scanShebang(file, text),
        ...scanShellText(file, text, { skipProseLines: true }),
        ...scanBunImagePins(file, text, PIN)
      ];
    case "procfile":
      return scanShellText(file, text);
  }
}

const manifests = discoverManifests();

// ---------------------------------------------------------------------------
// Job targets, from every place a job is declared
// ---------------------------------------------------------------------------

const crontabFiles = manifests.filter((m) => m.kind === "crontab");

function crontabTargets(): { file: string; target: string }[] {
  return crontabFiles.flatMap(({ file }) =>
    parseCrontabJobs(read(file)).flatMap((job) =>
      job.target === null ? [] : [{ file, target: job.target }]
    )
  );
}

function registryTargets(): string[] {
  return listModules().flatMap((module) =>
    (module.jobs ?? []).map((job) => job.command.replace(/^bun run /, ""))
  );
}

/** `bun scripts/foo.ts [args]` -> `scripts/foo.ts`, otherwise null. */
function entrypointOf(script: string | undefined): string | null {
  return /^bun (scripts\/[\w./-]+\.ts)\b/.exec(script ?? "")?.[1] ?? null;
}

// ---------------------------------------------------------------------------

describe("the Bun pin is read from package.json, not hard-coded", () => {
  test("packageManager is bun@x.y.z and engines.bun has a floor", () => {
    expect(PIN).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FLOOR).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Bun.semver.order(PIN, FLOOR)).toBeGreaterThanOrEqual(0);
  });
});

describe("launch manifest discovery", () => {
  test("finds the manifests that launch jobs today (the glob has not rotted)", () => {
    const files = manifests.map((m) => m.file);
    for (const expected of [
      "Dockerfile.production",
      "deploy/cron/awcms.crontab",
      "ops/awcms-jobs.crontab",
      "ops/run-job.sh",
      "deploy/redis/docker-compose.yml",
      "infra/varnish/docker-compose.varnish.yml"
    ]) {
      expect(files).toContain(expected);
    }
  });
});

describe("every launch manifest starts Bun and nothing else", () => {
  for (const { file, kind } of manifests) {
    test(`${file} (${kind})`, () => {
      const violations = scanManifest(file, kind);
      expect(formatViolations(violations)).toBe("");
    });
  }

  test("every workflow installs Bun at the pin (or the engines floor) and never Node", () => {
    const dir = path.join(ROOT, ".github/workflows");
    const violations = readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        scanWorkflow(
          `.github/workflows/${name}`,
          read(`.github/workflows/${name}`),
          PIN,
          FLOOR
        )
      );
    expect(formatViolations(violations)).toBe("");
  });

  test("scripts/ and ops/ entrypoints carry no Node shebang", () => {
    const violations: Violation[] = [];
    for (const dir of ["scripts", "ops", "deploy"]) {
      const walk = (current: string) => {
        for (const name of readdirSync(path.join(ROOT, current))) {
          const rel = path.join(current, name);
          if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
          else if (/\.(ts|mjs|js|sh)$/.test(name)) {
            violations.push(...scanShebang(rel, read(rel)));
          }
        }
      };
      walk(dir);
    }
    expect(formatViolations(violations)).toBe("");
  });
});

describe("Dockerfile.production launches Bun in every stage that launches anything", () => {
  const instructions = parseDockerfile(read("Dockerfile.production"));

  test("the last stage (what a bare `docker build` produces) is the app, started by bun", () => {
    const froms = instructions.filter((i) => i.keyword === "FROM");
    const last = froms.at(-1)?.stage;
    expect(last).toBe("runtime");
    const cmd = instructions.filter(
      (i) => i.stage === last && i.keyword === "CMD"
    );
    expect(cmd).toHaveLength(1);
    expect(cmd[0]?.args).toMatch(/^\[\s*"bun"\s*,/);
  });

  test("the jobs stage sets no default launcher — it is only ever `docker run ... bun run <target>`", () => {
    const launchers = instructions.filter(
      (i) =>
        i.stage === "jobs" &&
        (i.keyword === "CMD" || i.keyword === "ENTRYPOINT")
    );
    expect(launchers).toEqual([]);
  });

  test("every stage descends from the pinned oven/bun image", () => {
    const bases = instructions
      .filter((i) => i.keyword === "FROM" && /^oven\/bun/.test(i.args))
      .map((i) => i.args.split(/\s+/)[0]);
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toBe(`oven/bun:${PIN}`);
  });
});

describe("the job runner launches the target through bun run", () => {
  test("ops/run-job.sh ends in `docker run ... <image> bun run <target>`", () => {
    const source = read("ops/run-job.sh");
    expect(source).toMatch(/"\$IMAGE" bun run "\$JOB" "\$@"\s*$/);
  });

  test("the runner only accepts a package script NAME, so a path can never reach `bun`'s file mode", () => {
    expect(read("ops/run-job.sh")).toContain("*[!A-Za-z0-9:_-]*");
  });
});

describe("job targets resolve to package.json scripts that are Bun end to end", () => {
  test("package.json scripts name no Node launcher (superset of the Repo hygiene grep)", () => {
    expect(formatViolations(scanPackageScripts(pkg.scripts))).toBe("");
  });

  test("the crontabs schedule at least one job each, and every target is a Bun script", () => {
    const targets = crontabTargets();
    expect(targets.length).toBeGreaterThan(20);
    const violations = targets.flatMap(({ file, target }) =>
      scanJobScript(target, pkg.scripts).map((v) => ({
        ...v,
        detail: `${file}: ${v.detail}`
      }))
    );
    expect(formatViolations(violations)).toBe("");
  });

  test("every module-registry job command is `bun run <script>` with a Bun script", () => {
    const jobs = listModules().flatMap((module) =>
      (module.jobs ?? []).map((job) => ({
        key: module.key,
        command: job.command
      }))
    );
    expect(jobs.length).toBeGreaterThan(20);
    const violations = jobs.flatMap(({ key, command }) => {
      if (!command.startsWith("bun run ")) {
        return [
          {
            file: `module:${key}`,
            line: 0,
            rule: "job-command-is-bun-run",
            detail: `"${command}" must start with "bun run "`
          }
        ];
      }
      return scanJobScript(command.replace(/^bun run /, ""), pkg.scripts);
    });
    expect(formatViolations(violations)).toBe("");
  });

  test("scheduled delivery is bounded: every active ops crontab line is flock -n wrapped", () => {
    const jobs = parseCrontabJobs(read("ops/awcms-jobs.crontab"));
    expect(jobs.length).toBeGreaterThan(0);
    const unbounded = jobs.filter((job) => !/\bflock -n \S+/.test(job.command));
    expect(unbounded.map((job) => job.command)).toEqual([]);
  });
});

describe("process identity: a worker entrypoint runs under the Bun binary", () => {
  const targets = [
    ...new Set([...registryTargets(), ...crontabTargets().map((t) => t.target)])
  ];
  const entrypoints = targets.flatMap((target) => {
    const entry = entrypointOf(pkg.scripts[target]);
    // A worker that does not guard `main()` behind `import.meta.main` would
    // run on import (and want a database). Those are not import-probed.
    return entry !== null && /import\.meta\.main/.test(read(entry))
      ? [{ target, entry }]
      : [];
  });

  test("the representative channel workers are importable without a database", () => {
    const probed = new Set(entrypoints.map((e) => e.target));
    for (const target of CHANNEL_WORKER_TARGETS) {
      expect(probed.has(target)).toBe(true);
    }
  });

  test("importing every guarded worker under a scrubbed env reports Bun, the Bun binary, and the repo version", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(ROOT, "tests/support/bun-identity-probe.ts"),
        ...entrypoints.map((e) => e.entry)
      ],
      {
        cwd: ROOT,
        // Scrubbed on purpose: no DATABASE_URL, no provider secret. A worker
        // that needs either to be IMPORTED is a worker that connects on import.
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp" },
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });

    const probe = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
      bunVersion?: string;
      bunGlobal: string;
      execPath: string;
      argv0?: string;
      imported: string[];
      failed: { file: string; error: string }[];
    };

    expect(probe.failed).toEqual([]);
    expect(probe.imported.sort()).toEqual(
      entrypoints.map((e) => e.entry).sort()
    );

    // Exact runtime assertion, not a filename check.
    expect(probe.bunGlobal).toBe("object");
    expect(typeof probe.bunVersion).toBe("string");
    expect(path.basename(probe.execPath)).toMatch(/^bun(-[\w.]+)?(\.exe)?$/);
    expect(path.basename(probe.argv0 ?? "")).toMatch(/^bun(-[\w.]+)?(\.exe)?$/);
    expect(probe.execPath).toBe(process.execPath);

    // CI installs exactly the pin; a developer's machine may be newer, but is
    // never older than the declared floor.
    expect(
      Bun.semver.order(probe.bunVersion ?? "0.0.0", FLOOR)
    ).toBeGreaterThanOrEqual(0);
    if (process.env.CI) expect(probe.bunVersion).toBe(PIN);
  });

  test("the test process itself is Bun (nothing re-hosts this suite under Node)", () => {
    expect(process.versions.bun).toBeDefined();
    expect(typeof Bun).toBe("object");
    expect(path.basename(process.execPath)).toMatch(/^bun/);
  });
});

// ---------------------------------------------------------------------------
// Fixtures: the scanner itself, positive and negative.
// ---------------------------------------------------------------------------

describe("scanner fixtures: what must be rejected", () => {
  const rules = (violations: Violation[]) => violations.map((v) => v.rule);

  test("shell: node, npm, npx, pnpm, yarn, tsx, ts-node, wrapped and pathed", () => {
    for (const bad of [
      "node dist/worker.js",
      "exec node server.js",
      "/usr/bin/node worker.mjs",
      "npm run dispatch",
      "npx tsx scripts/x.ts",
      "pnpm dlx foo",
      "yarn start",
      "tsx watch x.ts",
      "ts-node x.ts",
      "sudo -u app env FOO=1 node x.js",
      "bun run a && node b.js",
      "bun run a | npm test",
      "docker run --rm node:22-alpine node x.js",
      "docker run --rm docker.io/library/node:lts bun run x"
    ]) {
      expect(rules(scanShellText("fx.sh", bad)), bad).toContain(
        "no-node-launcher"
      );
    }
  });

  test("crontab: a node job line, with the launcher hidden in a variable", () => {
    const text = [
      "AWCMS_RUN=docker run --rm -v /opt/awcms:/app node:22 node",
      "* * * * * $AWCMS_RUN scripts/email-dispatch.js >> /var/log/x 2>&1"
    ].join("\n");
    expect(rules(scanCrontab("fx.crontab", text, "1.4.4"))).toContain(
      "no-node-launcher"
    );
  });

  test("Dockerfile: node base image, node CMD, shell-form CMD, npm RUN", () => {
    const bad = [
      "FROM node:22-alpine AS base",
      "RUN npm ci",
      'CMD ["node", "dist/server.mjs"]'
    ].join("\n");
    const found = rules(scanDockerfile("Dockerfile.fx", bad, "1.4.4"));
    expect(found).toContain("from-must-be-bun");
    expect(found).toContain("no-node-launcher");
    expect(found).toContain("launch-must-be-bun");

    const shell = scanDockerfile(
      "Dockerfile.fx",
      "FROM oven/bun:1.4.4\nCMD npm start\n",
      "1.4.4"
    );
    expect(rules(shell)).toContain("launch-must-be-bun");
  });

  test("Dockerfile: a floating or stale oven/bun tag is not the pin", () => {
    for (const tag of ["", ":latest", ":1.4.3", ":1", ":1.4"]) {
      const text = `FROM oven/bun${tag}\nCMD ["bun", "x.ts"]\n`;
      expect(
        rules(scanDockerfile("Dockerfile.fx", text, "1.4.4")),
        tag
      ).toContain("bun-image-pin");
    }
  });

  test("compose: a node service image, command and healthcheck", () => {
    const services = {
      realtime: {
        image: "node:22",
        command: ["node", "gateway.js"],
        healthcheck: { test: ["CMD", "npx", "wait-on", "x"] }
      },
      ok: { image: "redis:8", command: ["redis-server"] }
    };
    const found = scanComposeServices("compose.fx.yml", services, "1.4.4");
    expect(
      found.filter((v) => v.detail.includes("service realtime")).length
    ).toBe(3);
    expect(found.some((v) => v.detail.includes("service ok"))).toBe(false);
  });

  test("systemd: ExecStart that is not bun, and a node ExecStartPre", () => {
    const unit = [
      "[Service]",
      "ExecStartPre=/usr/bin/npm ci",
      "ExecStart=/usr/bin/node /opt/awcms/gateway.js"
    ].join("\n");
    const found = rules(scanSystemdUnit("gw.service", unit));
    expect(found).toContain("launch-must-be-bun");
    expect(found).toContain("no-node-launcher");
  });

  test("shebang: node, env node, env -S tsx", () => {
    for (const line of [
      "#!/usr/bin/env node",
      "#!/usr/bin/node",
      "#!/usr/bin/env -S tsx"
    ]) {
      expect(
        rules(scanShebang("x.ts", `${line}\nconsole.log(1)`)),
        line
      ).toEqual(["no-node-shebang"]);
    }
  });

  test("job scripts: a bare bin or a node hop inside a job's script chain", () => {
    const scripts = {
      "good:job": "bun scripts/good.ts",
      "bare:job": "tsc --noEmit",
      "hop:job": "bun run good:job && node post.js",
      "chain:job": "bun run bare:job"
    };
    expect(scanJobScript("good:job", scripts)).toEqual([]);
    expect(rules(scanJobScript("bare:job", scripts))).toContain(
      "job-script-is-bun"
    );
    expect(rules(scanJobScript("hop:job", scripts))).toContain(
      "job-script-is-bun"
    );
    expect(rules(scanJobScript("chain:job", scripts))).toContain(
      "job-script-is-bun"
    );
    expect(rules(scanJobScript("missing:job", scripts))).toEqual([
      "job-target-resolves"
    ]);
  });

  test("workflows: setup-node and an unpinned setup-bun version", () => {
    const text = [
      "      - uses: actions/setup-node@v4",
      "      - uses: oven-sh/setup-bun@v2",
      "        with:",
      '          bun-version: "1.2.0"'
    ].join("\n");
    expect(
      rules(scanWorkflow("wf.yml", text, "1.4.4", "1.3.0")).sort()
    ).toEqual(["bun-version-pin", "no-setup-node"]);
  });
});

describe("scanner fixtures: what must be allowed (no false positives)", () => {
  test("Bun node:* built-ins, node_modules, NODE_ENV, @astrojs/node, prose", () => {
    for (const ok of [
      `bun -e "import { readFileSync } from 'node:fs'"`,
      "bun --bun astro build",
      "NODE_ENV=production bun run x",
      "rm -rf node_modules",
      "bun add @astrojs/node",
      "bun run build # astro build uses the node adapter standalone",
      "docker run --rm oven/bun:1.4.4-alpine bun run email:dispatch",
      "exec bun ./dist/standalone-entry.mjs"
    ]) {
      expect(scanShellText("fx.sh", ok), ok).toEqual([]);
    }
    expect(
      scanShellText("fx.sh", "# node npm yarn in a comment\nbun x.ts")
    ).toEqual([]);
    expect(
      scanShellText("fx.sh", 'log "no node here" >&2\necho npm is gone', {
        skipProseLines: true
      })
    ).toEqual([]);
  });

  test("a Bun-only Dockerfile, compose service, systemd unit and shebang pass", () => {
    const dockerfile = [
      "FROM oven/bun:1.4.4 AS base",
      "FROM base AS build",
      "RUN bun install --frozen-lockfile && bun run build",
      'CMD ["bun", "./dist/standalone-entry.mjs"]'
    ].join("\n");
    expect(scanDockerfile("Dockerfile.fx", dockerfile, "1.4.4")).toEqual([]);
    expect(
      scanComposeServices(
        "c.yml",
        {
          gw: { image: "oven/bun:1.4.4-alpine", command: ["bun", "gateway.ts"] }
        },
        "1.4.4"
      )
    ).toEqual([]);
    expect(
      scanSystemdUnit(
        "gw.service",
        "[Service]\nExecStart=/usr/local/bin/bun run gateway"
      )
    ).toEqual([]);
    expect(scanShebang("x.ts", "#!/usr/bin/env bun\n")).toEqual([]);
    expect(scanShebang("x.sh", "#!/usr/bin/env bash\n")).toEqual([]);
  });

  test("a crontab that runs the pinned Bun image through a variable passes", () => {
    const text = [
      "AWCMS_RUN=docker run --rm -w /app oven/bun:1.4.4-alpine bun run",
      "* * * * * $AWCMS_RUN email:dispatch >> /var/log/e.log 2>&1"
    ].join("\n");
    expect(scanCrontab("fx.crontab", text, "1.4.4")).toEqual([]);
    expect(parseCrontabJobs(text).map((j) => j.target)).toEqual([
      "email:dispatch"
    ]);
    expect(
      expandVariables(
        "$A/${B}",
        new Map([
          ["A", "x"],
          ["B", "y"]
        ])
      )
    ).toBe("x/y");
    expect(crontabVariables(text).has("AWCMS_RUN")).toBe(true);
  });

  test("the run-job.sh form resolves the target", () => {
    const text = [
      "AWCMS_RUN_JOB=/home/admin1/awcms-jobs/run-job.sh",
      "*/5 * * * * /usr/bin/flock -n /l/x.lock $AWCMS_RUN_JOB blog:publish:scheduled >> /l/x.log 2>&1"
    ].join("\n");
    expect(parseCrontabJobs(text).map((j) => j.target)).toEqual([
      "blog:publish:scheduled"
    ]);
  });

  test("pinnedBunVersion rejects anything that is not a bun@x.y.z pin", () => {
    expect(pinnedBunVersion("bun@1.4.4")).toBe("1.4.4");
    for (const bad of ["npm@10.0.0", "pnpm@9.1.0", "bun", undefined, 4]) {
      expect(pinnedBunVersion(bad)).toBe("");
    }
  });
});
