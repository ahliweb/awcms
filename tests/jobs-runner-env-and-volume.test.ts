/**
 * `ops/run-job.sh` gives a scheduled job its whole environment and a filesystem
 * that outlives it — finding D1 of the 17 August 2026 audit round.
 *
 * ## The two halves, and why neither reported itself
 *
 * **No volume.** `docker run --rm` with no `-v` gave
 * `data-lifecycle:archive-purge` and `reporting:exports:dispatch` a filesystem
 * deleted seconds later, while `awcms_data_lifecycle_archive_manifests` and
 * `awcms_report_export_runs` recorded the artefacts as PRESENT. The README's
 * restore procedure could not be executed and a scheduled export 404'd on
 * download. Nothing failed: writing the file really did succeed.
 *
 * **A hand-maintained prefix pattern.** It dropped **81 of the 171** variables
 * this codebase reads — including both artefact-root paths, every
 * `TENANT_DOMAIN_CLOUDFLARE_*` (because `^CLOUDFLARE_` is anchored and those do
 * not start with it), and every `VISITOR_ANALYTICS_*` retention window that
 * `analytics:purge` exists to enforce. A job missing a variable takes the code's
 * default, does the inert thing, and exits 0.
 *
 * ## What is actually executed here
 *
 * The selection is not merely read as source: the same `awk` expression the
 * runner uses is driven over a fixture environment, against the REAL generated
 * allow-list. That is what proves exact-NAME matching — a prefix pattern would
 * also copy `DATABASE_URL_LOOKALIKE`, and no source assertion can tell the two
 * apart.
 *
 * The docker invocation itself cannot run here (no daemon, no image, no app
 * container), so the mount is asserted as source. Its absence is the finding.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RUNNER = "ops/run-job.sh";
const GLOBAL_FILE = "ops/awcms-jobs.env-global";

async function runnerSource(): Promise<string> {
  return Bun.file(RUNNER).text();
}

const SCOPED = "ops/awcms-jobs.env-scoped";

/**
 * The runner's OWN selection block, lifted out of `ops/run-job.sh` by its
 * markers and executed: from reading the allow-list and the job-scoped file
 * through to the `> "$ENVFILE"` redirect. Only `docker exec "$APP" printenv` is
 * replaced by a fixture, so what is tested is the shipped shell, not a copy of
 * it (a copy is how a test and the script drift apart).
 */
async function runSelection(
  fixture: string,
  job: string,
  files: { globalFile?: string; scoped?: string } = {}
): Promise<{ lines: string[]; exitCode: number; stderr: string }> {
  const source = await runnerSource();
  const start = source.indexOf('if [ ! -r "$GLOBAL" ]');
  const end = source.indexOf('> "$ENVFILE"', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const block = source
    .slice(start, end)
    .replace('docker exec "$APP" printenv', "printf '%s\\n' \"$FIXTURE_ENV\"");

  const script = `
set -euo pipefail
log() { echo "$*" >&2; }
GLOBAL="$TEST_GLOBAL"
SCOPED="$TEST_SCOPED"
${block}
`;

  const proc = Bun.spawn(["bash", "-c", script], {
    env: {
      ...process.env,
      JOB: job,
      FIXTURE_ENV: fixture,
      TEST_GLOBAL: files.globalFile ?? GLOBAL_FILE,
      TEST_SCOPED: files.scoped ?? SCOPED
    },
    stdout: "pipe",
    stderr: "pipe"
  });

  const out = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    lines: out.split("\n").filter((line) => line.length > 0),
    exitCode,
    stderr
  };
}

/** The selection for a job that has no scoped grants. */
async function selectEnv(
  fixture: string,
  job = "logs:audit:purge"
): Promise<string[]> {
  return (await runSelection(fixture, job)).lines;
}

describe("the environment a job receives", () => {
  test("carries the variables the old prefix pattern dropped", async () => {
    const selected = await selectEnv(
      [
        "DATABASE_URL=postgres://a:b@db/awcms",
        // Every one of these was invisible to `^(…|CLOUDFLARE_|EDGE_CACHE_)`.
        "TENANT_DOMAIN_CLOUDFLARE_API_TOKEN=cf-token",
        "TENANT_DOMAIN_CLOUDFLARE_ZONE_ID=zone-1",
        "VISITOR_ANALYTICS_EVENT_RETENTION_DAYS=90",
        "DATA_LIFECYCLE_ARCHIVE_ROOT_PATH=./var/data-lifecycle-archive",
        "REPORTING_EXPORT_ROOT_PATH=./var/reporting-exports",
        "SYNC_HMAC_ALLOW_LEGACY=false",
        "SITE_SEARCH_RATE_LIMIT_MAX=30"
      ].join("\n"),
      // The API token is job-scoped since Issue #1120; the zone id stays global.
      "tenant-domain:dns:sync"
    );

    for (const expected of [
      "DATABASE_URL=postgres://a:b@db/awcms",
      "TENANT_DOMAIN_CLOUDFLARE_API_TOKEN=cf-token",
      "TENANT_DOMAIN_CLOUDFLARE_ZONE_ID=zone-1",
      "VISITOR_ANALYTICS_EVENT_RETENTION_DAYS=90",
      "DATA_LIFECYCLE_ARCHIVE_ROOT_PATH=./var/data-lifecycle-archive",
      "REPORTING_EXPORT_ROOT_PATH=./var/reporting-exports",
      "SYNC_HMAC_ALLOW_LEGACY=false",
      "SITE_SEARCH_RATE_LIMIT_MAX=30"
    ]) {
      expect(selected).toContain(expected);
    }
  });

  test("selects by exact NAME, so a lookalike is not copied", async () => {
    // The property a prefix pattern cannot have, and the reason the allow-list
    // is a list of names rather than a list of prefixes.
    const selected = await selectEnv(
      [
        "DATABASE_URL=real",
        "DATABASE_URL_LOOKALIKE=nope",
        "XDATABASE_URL=nope"
      ].join("\n")
    );

    expect(selected).toEqual(["DATABASE_URL=real"]);
  });

  test("leaves the host's and the orchestrator's own variables behind", async () => {
    const selected = await selectEnv(
      [
        "PATH=/usr/local/bin:/usr/bin",
        "HOSTNAME=abc123",
        "HOME=/root",
        "COOLIFY_INTERNAL_SECRET=should-not-leak",
        "DATABASE_URL=real"
      ].join("\n")
    );

    expect(selected).toEqual(["DATABASE_URL=real"]);
  });
});

describe("the runner reads the generated list, and cannot fall back to a partial one", () => {
  test("no inline prefix pattern survives", async () => {
    const source = await runnerSource();

    // The exact shape of the defect: a prefix alternation selecting env.
    expect(source).not.toMatch(/grep -E '\^\(DATABASE_URL\|/);
    expect(source).toContain("awcms-jobs.env-global");
  });

  test("an unreadable allow-list REFUSES the run", async () => {
    const source = await runnerSource();

    // Falling back to "copy everything" or "copy nothing" both produce a job
    // that runs and reports success, which is the failure this whole finding is
    // about. The only safe answer is to not run.
    const guard = source.indexOf('if [ ! -r "$GLOBAL" ]');
    expect(guard).toBeGreaterThan(-1);
    expect(source.slice(guard, guard + 400)).toContain("exit 1");
  });

  test("copying zero variables REFUSES the run", async () => {
    const source = await runnerSource();

    const guard = source.indexOf('if [ "$COPIED" -eq 0 ]');
    expect(guard).toBeGreaterThan(-1);
    expect(source.slice(guard, guard + 300)).toContain("exit 1");
  });
});

describe("the filesystem a job writes to outlives the container", () => {
  test("the run mounts a host directory over the container's `var/`", async () => {
    const source = await runnerSource();

    expect(source).toContain('-v "$DATA_DIR:$CONTAINER_WORKDIR/var"');
    expect(source).toContain('mkdir -p "$DATA_DIR"');
  });

  test("the container path matches the image's WORKDIR", async () => {
    // One mount covers both artefact roots ONLY because both default to
    // `./var/...` relative to the working directory. If the Dockerfile's
    // WORKDIR moves and this default does not, the mount lands beside the files
    // instead of under them — and the symptom is again indistinguishable from
    // success.
    const dockerfile = await Bun.file("Dockerfile.production").text();
    const workdir = dockerfile.match(/^WORKDIR\s+(\S+)/m)?.[1];
    const source = await runnerSource();

    expect(workdir).toBeTruthy();
    expect(source).toContain(`AWCMS_JOBS_WORKDIR:-${workdir}`);
  });

  test("a root path pointed OUTSIDE the mount is named, not tolerated", async () => {
    const source = await runnerSource();

    expect(source).toContain(
      "DATA_LIFECYCLE_ARCHIVE_ROOT_PATH | REPORTING_EXPORT_ROOT_PATH"
    );
    expect(source).toContain("is outside the mounted");
  });
});

describe("the allow-list itself", () => {
  test("is generated, and says so", async () => {
    const list = await Bun.file(GLOBAL_FILE).text();

    expect(list).toContain(
      "GENERATED by `bun run jobs:env-allowlist:generate`"
    );
  });

  test("names the variables both artefact-writing jobs read", async () => {
    const list = await Bun.file(GLOBAL_FILE).text();
    const names = new Set(
      list
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
    );

    for (const name of [
      "DATA_LIFECYCLE_ARCHIVE_ROOT_PATH",
      "REPORTING_EXPORT_ROOT_PATH",
      "REPORTING_EXPORT_RETENTION_DAYS"
    ]) {
      expect(names.has(name)).toBe(true);
    }

    // Bounded, not "everything the host happens to hold".
    expect(names.size).toBeGreaterThan(100);
    expect(names.has("PATH")).toBe(false);
    expect(names.has("HOME")).toBe(false);
  });
});

// Issue #1119. `ops/run-job.sh` passes ONLY the names on the allow-list, and the
// list is generated from what the scanner sees. A read the scanner could not see
// meant a host running `push:dispatch` through run-job.sh started it with push
// enabled and no VAPID material.
describe("the allow-list carries what the scanner used to miss", () => {
  const readNames = async () =>
    new Set(
      (await Bun.file(GLOBAL_FILE).text())
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
    );

  // Since Issue #1120 the secrets among these are job-SCOPED: they are no longer
  // on the global list, and `awcms-jobs.env-scoped` grants them to the jobs that
  // read them. What #1119 guaranteed - that they reach `push:dispatch` and
  // friends - is asserted against the shipped selection below.
  test("the two non-secret PUSH_VAPID_* variables stay global; the private key is scoped", async () => {
    const names = await readNames();

    for (const name of ["PUSH_VAPID_PUBLIC_KEY", "PUSH_VAPID_SUBJECT"]) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has("PUSH_VAPID_PRIVATE_KEY")).toBe(false);
  });

  test("push:dispatch still receives all three PUSH_VAPID_* variables", async () => {
    const { lines } = await runSelection(
      [
        "PUSH_VAPID_PUBLIC_KEY=pub",
        "PUSH_VAPID_PRIVATE_KEY=priv",
        "PUSH_VAPID_SUBJECT=mailto:a@b.c"
      ].join("\n"),
      "push:dispatch"
    );

    expect(lines.sort()).toEqual([
      "PUSH_VAPID_PRIVATE_KEY=priv",
      "PUSH_VAPID_PUBLIC_KEY=pub",
      "PUSH_VAPID_SUBJECT=mailto:a@b.c"
    ]);
  });

  test("the push auth-secret ring reaches push:dispatch and push:auth-secret:rekey", async () => {
    for (const job of ["push:dispatch", "push:auth-secret:rekey"]) {
      const { lines } = await runSelection(
        "PUSH_AUTH_SECRET_ENCRYPTION_KEYS=ring",
        job
      );
      expect(lines).toEqual(["PUSH_AUTH_SECRET_ENCRYPTION_KEYS=ring"]);
    }
  });

  test("TELEGRAM_CHAT_HASH_KEYS reaches the jobs whose encryption-ring resolver checks distinctness against it", async () => {
    // Without it a job sees the hash ring as unconfigured and the distinctness
    // guard (Issue #1008 L11) passes vacuously where chat ids are decrypted.
    for (const job of ["telegram:dispatch", "telegram:chat:rekey"]) {
      const { lines } = await runSelection("TELEGRAM_CHAT_HASH_KEYS=h", job);
      expect(lines).toEqual(["TELEGRAM_CHAT_HASH_KEYS=h"]);
    }
  });

  test("WORKER_DATABASE_URL, read only as process.env[name], so every job does not silently fall back to awcms_app", async () => {
    expect((await readNames()).has("WORKER_DATABASE_URL")).toBe(true);
  });

  test("the secrets that are genuinely web-only stay out of every job container", async () => {
    const names = await readNames();

    for (const name of [
      "TELEGRAM_WEBHOOK_SECRET",
      "SETUP_DATABASE_URL",
      "DATABASE_POOL_MAX_SETUP",
      "AUTH_IP_HASH_SECRET"
    ]) {
      expect(names.has(name)).toBe(false);
    }
  });

  test("generic: nothing web-only, setup-scoped or webhook-secret-shaped is handed to a job", async () => {
    const { WEB_ONLY } = await import("../scripts/jobs-env-allowlist");
    const webOnly = new Set(WEB_ONLY.map((entry) => entry.name));
    const offenders = [...(await readNames())].filter(
      (name) =>
        name.startsWith("SETUP_") ||
        name.includes("WEBHOOK_SECRET") ||
        webOnly.has(name)
    );

    expect(offenders).toEqual([]);
    // A reason is the only thing that stops this list becoming a dumping ground.
    for (const entry of WEB_ONLY) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  test("every variable the code reads is on the list unless it is excused", async () => {
    const { collectJobEnvNames } =
      await import("../scripts/jobs-env-allowlist");
    const names = await readNames();

    expect(
      [...(await collectJobEnvNames())].filter((n) => !names.has(n))
    ).toEqual([]);
  }, 60000);
});

// Issue #1120. One global list reached ~40 job containers, so a secret only a few
// jobs read was handed to all of them. `ops/awcms-jobs.env-scoped` names, per
// job, the secrets that job alone may receive.
describe("job-scoped secrets reach only the jobs that read them", () => {
  const SCOPED_FIXTURE = [
    "PUSH_VAPID_PRIVATE_KEY=vapid-priv",
    "PUSH_AUTH_SECRET_ENCRYPTION_KEYS=auth-ring",
    "PUSH_FCM_CREDENTIALS_BASE64=fcm",
    "TELEGRAM_CHAT_HASH_KEYS=hash-ring",
    "TELEGRAM_CHAT_ENCRYPTION_KEYS=enc-ring",
    "TELEGRAM_BOT_TOKEN=bot",
    "DATABASE_URL=postgres://a:b@db/awcms"
  ].join("\n");

  const SCOPED_NAMES = [
    "PUSH_VAPID_PRIVATE_KEY",
    "PUSH_AUTH_SECRET_ENCRYPTION_KEYS",
    "PUSH_FCM_CREDENTIALS_BASE64",
    "TELEGRAM_CHAT_HASH_KEYS",
    "TELEGRAM_CHAT_ENCRYPTION_KEYS",
    "TELEGRAM_BOT_TOKEN"
  ];

  const namesOf = (lines: string[]) =>
    lines.map((line) => line.split("=")[0]).sort();

  test("the scoped file is generated, and says so", async () => {
    const file = await Bun.file(SCOPED).text();

    expect(file).toContain(
      "GENERATED by `bun run jobs:env-allowlist:generate`"
    );
    for (const line of file.split("\n")) {
      if (line.length === 0 || line.startsWith("#")) continue;
      expect(line.split(" ")).toHaveLength(2);
    }
  });

  test("a scoped secret is NOT on the global list", async () => {
    const list = await Bun.file(GLOBAL_FILE).text();
    const names = new Set(
      list
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
    );

    for (const name of SCOPED_NAMES) expect(names.has(name)).toBe(false);
  });

  test("an unrelated job receives none of the scoped secrets", async () => {
    const { lines, exitCode } = await runSelection(
      SCOPED_FIXTURE,
      "logs:audit:purge"
    );

    expect(exitCode).toBe(0);
    expect(namesOf(lines)).toEqual(["DATABASE_URL"]);
  });

  test("push:dispatch receives its three push secrets and no Telegram one", async () => {
    const { lines } = await runSelection(SCOPED_FIXTURE, "push:dispatch");

    expect(namesOf(lines)).toEqual([
      "DATABASE_URL",
      "PUSH_AUTH_SECRET_ENCRYPTION_KEYS",
      "PUSH_FCM_CREDENTIALS_BASE64",
      "PUSH_VAPID_PRIVATE_KEY"
    ]);
  });

  test("telegram:dispatch receives the bot token and both rings, no push secret", async () => {
    const { lines } = await runSelection(SCOPED_FIXTURE, "telegram:dispatch");

    expect(namesOf(lines)).toEqual([
      "DATABASE_URL",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ENCRYPTION_KEYS",
      "TELEGRAM_CHAT_HASH_KEYS"
    ]);
  });

  test("telegram:queue:purge shares a module with the rings but is not granted them", async () => {
    const { lines } = await runSelection(
      SCOPED_FIXTURE,
      "telegram:queue:purge"
    );

    expect(namesOf(lines)).toEqual(["DATABASE_URL"]);
  });

  test("the job is matched EXACTLY - a prefix, suffix or substring of a target gets nothing", async () => {
    for (const job of [
      "push:dispatch:dry",
      "xpush:dispatch",
      "push:",
      "push",
      "push:dispatc.",
      "push:dispatch ",
      ""
    ]) {
      const { lines } = await runSelection(SCOPED_FIXTURE, job);
      expect(namesOf(lines), `job ${JSON.stringify(job)}`).toEqual([
        "DATABASE_URL"
      ]);
    }
  });

  test("a malformed scoped file REFUSES the run, never skips the bad line", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scoped-"));
    const bad = path.join(dir, "bad");
    await Bun.write(
      bad,
      "# header\npush:dispatch PUSH_VAPID_PRIVATE_KEY\ntelegram:dispatch\n"
    );

    const result = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      scoped: bad
    });
    rmSync(dir, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("malformed");
  });

  /** A scratch directory holding the given files, removed by the caller. */
  function scratch(files: Record<string, string>): {
    dir: string;
    file: (name: string) => string;
  } {
    const dir = mkdtempSync(path.join(tmpdir(), "run-job-"));
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), body);
    }
    return { dir, file: (name) => path.join(dir, name) };
  }

  const FINGERPRINT_LINE = /^# awcms-jobs-env-fingerprint: [0-9a-f]{64}$/m;
  const FP_A = `# awcms-jobs-env-fingerprint: ${"ab".repeat(32)}`;
  const FP_B = `# awcms-jobs-env-fingerprint: ${"cd".repeat(32)}`;

  /** The real generated file with its fingerprint line replaced (or removed with ""). */
  async function retag(file: string, line: string): Promise<string> {
    const text = await Bun.file(file).text();
    expect(text).toMatch(FINGERPRINT_LINE);
    return text.replace(FINGERPRINT_LINE, line);
  }

  test("both generated files carry the SAME fingerprint, and it is the digest of their content", async () => {
    const { collectJobEnvNames, envFingerprint, scopedPairs } =
      await import("../scripts/jobs-env-allowlist");
    const global = await Bun.file(GLOBAL_FILE).text();
    const scoped = await Bun.file(SCOPED).text();
    const fpOf = (text: string) => text.match(FINGERPRINT_LINE)?.[0];

    expect(fpOf(global)).toBeTruthy();
    expect(fpOf(global)).toBe(fpOf(scoped));
    expect(fpOf(global)).toBe(
      `# awcms-jobs-env-fingerprint: ${envFingerprint(await collectJobEnvNames(), scopedPairs())}`
    );
  }, 60000);

  test("a matching pair runs", async () => {
    const dir = scratch({
      global: `${FP_A}\nDATABASE_URL\n`,
      scoped: `${FP_A}\nemail:dispatch EMAIL_MAILKETING_API_TOKEN\n`
    });
    const result = await runSelection(
      "DATABASE_URL=d\nEMAIL_MAILKETING_API_TOKEN=t",
      "email:dispatch",
      { globalFile: dir.file("global"), scoped: dir.file("scoped") }
    );
    rmSync(dir.dir, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(namesOf(result.lines)).toEqual([
      "DATABASE_URL",
      "EMAIL_MAILKETING_API_TOKEN"
    ]);
  });

  test("a scoped file from another release beside this global file is REFUSED, naming both files", async () => {
    const dir = scratch({
      scoped: await retag(SCOPED, FP_B),
      global: await retag(GLOBAL_FILE, FP_A)
    });
    const result = await runSelection(SCOPED_FIXTURE, "whatsapp:dispatch", {
      globalFile: dir.file("global"),
      scoped: dir.file("scoped")
    });
    rmSync(dir.dir, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.stderr).toContain("fingerprint mismatch");
    expect(result.stderr).toContain(dir.file("global"));
    expect(result.stderr).toContain(dir.file("scoped"));
  });

  test("a file with NO fingerprint is REFUSED - the previous release's scoped file beside the new global file", async () => {
    // The pre-fingerprint scoped file: valid grants, no digest. Before this
    // check `whatsapp:dispatch`, `email:dispatch` and friends ran with rc=0 and
    // no provider secrets.
    for (const missing of ["scoped", "global"] as const) {
      const dir = scratch({
        scoped:
          missing === "scoped"
            ? "# old\nemail:dispatch EMAIL_MAILKETING_API_TOKEN\n"
            : await retag(SCOPED, FP_A),
        global:
          missing === "global"
            ? "# old\nDATABASE_URL\n"
            : await retag(GLOBAL_FILE, FP_A)
      });
      const result = await runSelection(SCOPED_FIXTURE, "email:dispatch", {
        globalFile: dir.file("global"),
        scoped: dir.file("scoped")
      });
      rmSync(dir.dir, { recursive: true, force: true });

      expect(result.exitCode, missing).not.toBe(0);
      expect(result.lines, missing).toEqual([]);
      expect(result.stderr, missing).toContain("fingerprint mismatch");
      expect(result.stderr, missing).toContain("=none");
    }
  });

  test("a duplicated or malformed fingerprint line is REFUSED", async () => {
    for (const bad of [
      `${FP_A}\n${FP_A}`,
      "# awcms-jobs-env-fingerprint: not-hex",
      `${FP_A} extra`
    ]) {
      const dir = scratch({
        global: `${bad}\nDATABASE_URL\n`,
        scoped: `${FP_A}\nemail:dispatch EMAIL_MAILKETING_API_TOKEN\n`
      });
      const result = await runSelection("DATABASE_URL=d", "email:dispatch", {
        globalFile: dir.file("global"),
        scoped: dir.file("scoped")
      });
      rmSync(dir.dir, { recursive: true, force: true });

      expect(result.exitCode, bad).not.toBe(0);
    }
  });

  test("a global file that is only comments REFUSES the run with a message, not a silent exit", async () => {
    const dir = scratch({
      global: `${FP_A}\n# nothing here\n\n`,
      scoped: `${FP_A}\nemail:dispatch EMAIL_MAILKETING_API_TOKEN\n`
    });
    const result = await runSelection(SCOPED_FIXTURE, "email:dispatch", {
      globalFile: dir.file("global"),
      scoped: dir.file("scoped")
    });
    rmSync(dir.dir, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lists no variables");
  });

  test("a missing scoped file REFUSES the run - the real block, executed", async () => {
    const result = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      scoped: "/nonexistent/awcms-jobs.env-scoped"
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.stderr).toContain("job-scoped env file not readable");
    expect(result.stderr).toContain("refusing to run push:dispatch");
  });

  test("a missing global file REFUSES the run - the real block, executed", async () => {
    const result = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      globalFile: "/nonexistent/awcms-jobs.env-global"
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.stderr).toContain("global env file not readable");
  });

  test("version skew: a global file that still lists a scoped secret REFUSES the run (an old, complete list beside the new scoped file)", async () => {
    // The old runner's `awcms-jobs.env-allowlist` held EVERY variable. Beside the
    // new scoped file that would hand `email:dispatch` all six secrets.
    const oldComplete = `${(await Bun.file(GLOBAL_FILE).text()).trimEnd()}\nPUSH_VAPID_PRIVATE_KEY\nTELEGRAM_BOT_TOKEN\n`;
    const dir = scratch({ global: oldComplete });

    const result = await runSelection(SCOPED_FIXTURE, "email:dispatch", {
      globalFile: dir.file("global")
    });
    rmSync(dir.dir, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.stderr).toContain("PUSH_VAPID_PRIVATE_KEY is in BOTH");
    expect(result.stderr).toContain("TELEGRAM_BOT_TOKEN is in BOTH");
  });

  test("the overlap is refused for EVERY job, not only the one that holds the grant", async () => {
    // Same fingerprint in both, so only the overlap can refuse.
    const dir = scratch({
      global: `${FP_A}\nDATABASE_URL\nPUSH_VAPID_PRIVATE_KEY\n`,
      scoped: await retag(SCOPED, FP_A)
    });

    for (const job of ["email:dispatch", "push:dispatch", "logs:audit:purge"]) {
      const result = await runSelection(SCOPED_FIXTURE, job, {
        globalFile: dir.file("global"),
        scoped: dir.file("scoped")
      });
      expect(result.exitCode, job).not.toBe(0);
      expect(result.stderr, job).toContain("PUSH_VAPID_PRIVATE_KEY is in BOTH");
    }
    rmSync(dir.dir, { recursive: true, force: true });
  });

  test("a CRLF scoped or global file REFUSES the run, since a name ending in CR matches nothing", async () => {
    const crlfScoped = scratch({
      scoped: "# header\r\npush:dispatch PUSH_VAPID_PRIVATE_KEY\r\n"
    });
    const a = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      scoped: crlfScoped.file("scoped")
    });
    rmSync(crlfScoped.dir, { recursive: true, force: true });
    expect(a.exitCode).not.toBe(0);
    expect(a.stderr).toContain("carriage return");

    const crlfGlobal = scratch({
      global: "DATABASE_URL\r\nWORKER_DATABASE_URL\r\n"
    });
    const b = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      globalFile: crlfGlobal.file("global")
    });
    rmSync(crlfGlobal.dir, { recursive: true, force: true });
    expect(b.exitCode).not.toBe(0);
    expect(b.stderr).toContain("carriage return");
  });

  test("a scoped file with no grant lines REFUSES the run, since it would scope nothing", async () => {
    const empty = scratch({ scoped: "# only a header\n\n" });
    const result = await runSelection(SCOPED_FIXTURE, "push:dispatch", {
      scoped: empty.file("scoped")
    });
    rmSync(empty.dir, { recursive: true, force: true });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no grant lines");
  });

  test("the job is compared as a STRING, so a numeric-looking target does not match its numeric twin", async () => {
    const numeric = scratch({
      scoped: `${FP_A}\n1e3 SECRET_ONE\n`,
      global: `${FP_A}\nDATABASE_URL\n`
    });
    const twin = await runSelection("SECRET_ONE=x\nDATABASE_URL=d", "1000", {
      scoped: numeric.file("scoped"),
      globalFile: numeric.file("global")
    });
    const same = await runSelection("SECRET_ONE=x\nDATABASE_URL=d", "1e3", {
      scoped: numeric.file("scoped"),
      globalFile: numeric.file("global")
    });
    rmSync(numeric.dir, { recursive: true, force: true });

    expect(namesOf(twin.lines)).toEqual(["DATABASE_URL"]);
    expect(namesOf(same.lines)).toEqual(["DATABASE_URL", "SECRET_ONE"]);
  });

  test("the scoped file is overridable the way the allow-list is, and defaults beside the script", async () => {
    const source = await runnerSource();

    expect(source).toContain("AWCMS_JOBS_ENV_GLOBAL");
    expect(source).toContain("AWCMS_JOBS_ENV_SCOPED");
    expect(source).toContain("awcms-jobs.env-scoped");
  });
});
