/**
 * The jobs image carries the runner and its two generated env files, and the
 * runner refuses to start a job when its host copies differ from them
 * (Issue #1131, L5).
 *
 * ## The defect
 *
 * `ops/run-job.sh`, `ops/awcms-jobs.env-global` and `ops/awcms-jobs.env-scoped`
 * are copied to the host by hand. The jobs image is pulled on its own schedule
 * (`:latest` by default) and `Dockerfile.production` did not ship `ops/`. A newer
 * image could therefore add a reader of a scoped secret to a job that the host's
 * older scoped file does not grant: the job ran WITHOUT the secret, and the push
 * and telegram resolvers answered a non-retryable "misconfigured" provider.
 *
 * ## What is held here
 *
 * 1. `Dockerfile.production`, stage `jobs`, copies exactly those three files to
 *    `./ops/` of the working directory the runner looks in.
 * 2. Those files hold NAMES only (a variable name, or `<job> <VAR>`), never a
 *    value, so shipping them in an image bakes in no secret.
 * 3. `ops/run-job.sh` is executed for real against a stub `docker`: identical
 *    host and image copies run the job; a difference in ANY of the three files, a
 *    missing host file, an image without the files, or an image answering with
 *    garbage refuses the run - before the job container starts.
 *
 * The stub stands in for the daemon only. The checksum comparison, the refusal
 * and its ordering are the shipped shell.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseDockerfile } from "./support/bun-only-launch-scan";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILES = [
  "run-job.sh",
  "awcms-jobs.env-global",
  "awcms-jobs.env-scoped"
] as const;
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("Dockerfile.production ships the runner files in the jobs image", () => {
  const instructions = parseDockerfile(read("Dockerfile.production"));
  const jobsCopies = instructions.filter(
    (i) => i.stage === "jobs" && i.keyword === "COPY"
  );

  test("the jobs stage copies run-job.sh and both env files to ./ops/", () => {
    const opsCopy = jobsCopies.find((i) => /\bops\//.test(i.args));
    expect(opsCopy).toBeDefined();
    const tokens = (opsCopy?.args ?? "")
      .split(/\s+/)
      .filter((t) => !t.startsWith("--"));
    expect(tokens.at(-1)).toBe("./ops/");
    for (const file of FILES) expect(tokens).toContain(`ops/${file}`);
  });

  test("only those three files of ops/ are shipped (backup and log tooling stay on the host)", () => {
    const shipped = jobsCopies
      .flatMap((i) => i.args.split(/\s+/))
      .filter((t) => t.startsWith("ops/"));
    expect(shipped.sort()).toEqual(FILES.map((f) => `ops/${f}`).sort());
  });

  test("the runtime stage does not carry them (they are job tooling)", () => {
    const runtime = instructions.filter(
      (i) => i.stage === "runtime" && i.keyword === "COPY"
    );
    expect(runtime.some((i) => /\bops\//.test(i.args))).toBe(false);
  });

  test("the jobs stage still has no CMD or ENTRYPOINT", () => {
    expect(
      instructions.filter(
        (i) =>
          i.stage === "jobs" &&
          (i.keyword === "CMD" || i.keyword === "ENTRYPOINT")
      )
    ).toEqual([]);
  });

  test("the build context does not exclude them", () => {
    const ignore = read(".dockerignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(ignore.some((l) => /^\/?ops\/?/.test(l))).toBe(false);
  });
});

describe("what the image carries is names, never values", () => {
  const meaningful = (file: string) =>
    read(`ops/${file}`)
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));

  test("every line of the global file is a bare variable name", () => {
    const lines = meaningful("awcms-jobs.env-global");
    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) expect(line).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  test("every line of the scoped file is `<job-target> <VARIABLE_NAME>`", () => {
    const lines = meaningful("awcms-jobs.env-scoped");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^[a-z][a-z0-9:_-]* [A-Z][A-Z0-9_]*$/);
    }
  });

  test("the run-job.sh in the image assigns no secret-looking literal", () => {
    const source = read("ops/run-job.sh");
    expect(source).not.toMatch(
      /(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?\w{8,}/
    );
    expect(source).not.toMatch(/postgres(ql)?:\/\/\S+:\S+@/);
  });
});

describe("ops/run-job.sh compares its host files with the image's", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "run-job-image-ops-"));
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  const stubDir = path.join(sandbox, "bin");
  mkdirSync(stubDir);
  const runLog = path.join(sandbox, "job-container-started");

  // `ps` finds an app container, `exec` prints its environment, the checksum
  // `run` answers from $STUB_IMAGE_OPS (the directory standing in for the
  // image's /home/bun/app/ops) and the final `run` records that the job
  // container would have started.
  writeFileSync(
    path.join(stubDir, "docker"),
    `#!/bin/bash
case "$1" in
  ps) echo awcms-app-stub ;;
  exec) printf 'DATABASE_URL=postgres://stub\\n' ;;
  run)
    if [[ " $* " == *" --entrypoint sha256sum "* ]]; then
      [ -n "\${STUB_IMAGE_FAIL:-}" ] && exit 125
      [ -n "\${STUB_IMAGE_GARBAGE:-}" ] && { echo "not a checksum"; exit 0; }
      for a in "$@"; do
        case "$a" in
          /home/bun/app/ops/*)
            f="$STUB_IMAGE_OPS/\${a##*/}"
            [ -f "$f" ] && sha256sum "$f" | awk -v p="$a" '{ print $1 "  " p }'
            ;;
        esac
      done
      # the comparison container must have no network
      [[ " $* " == *" --network none "* ]] || exit 99
    else
      echo "$@" >> "${runLog}"
    fi
    ;;
esac
`
  );
  chmodSync(path.join(stubDir, "docker"), 0o755);

  /** A fresh "image" and a fresh "host" directory, both copies of the repo files. */
  let counter = 0;
  function layout() {
    const id = `case-${++counter}`;
    const host = path.join(sandbox, id, "host");
    const image = path.join(sandbox, id, "image");
    mkdirSync(host, { recursive: true });
    mkdirSync(image, { recursive: true });
    for (const file of FILES) {
      copyFileSync(path.join(ROOT, "ops", file), path.join(host, file));
      copyFileSync(path.join(ROOT, "ops", file), path.join(image, file));
    }
    return { host, image };
  }

  function run(
    dirs: { host: string; image: string },
    extra: Record<string, string> = {}
  ) {
    rmSync(runLog, { force: true });
    const proc = Bun.spawnSync(
      ["bash", path.join(dirs.host, "run-job.sh"), "email:dispatch"],
      {
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH ?? ""}`,
          AWCMS_JOBS_IMAGE: "stub/awcms-jobs:test",
          AWCMS_JOBS_DATA_DIR: path.join(sandbox, "data"),
          STUB_IMAGE_OPS: dirs.image,
          ...extra
        }
      }
    );
    return {
      exitCode: proc.exitCode ?? -1,
      stderr: proc.stderr.toString(),
      started: existsSync(runLog)
    };
  }

  test("identical host and image copies run the job", () => {
    const result = run(layout());
    expect(result.stderr).not.toContain("refusing");
    expect(result.exitCode).toBe(0);
    expect(result.started).toBe(true);
  });

  for (const file of FILES) {
    test(`a ${file} on the host that differs from the image's refuses the run`, () => {
      const dirs = layout();
      // Same length, one byte different: a hash, not a size check.
      const original = readFileSync(path.join(dirs.host, file), "utf8");
      writeFileSync(path.join(dirs.host, file), `${original}# drift\n`);
      const result = run(dirs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`host ${file} differs`);
      expect(result.started).toBe(false);
    });

    test(`a ${file} in the image that differs from the host's refuses the run`, () => {
      const dirs = layout();
      const original = readFileSync(path.join(dirs.image, file), "utf8");
      writeFileSync(path.join(dirs.image, file), `${original}# newer\n`);
      const result = run(dirs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`host ${file} differs`);
      expect(result.stderr).toContain("Install the image's");
      expect(result.started).toBe(false);
    });

    test(`an image that lacks ${file} refuses the run`, () => {
      const dirs = layout();
      rmSync(path.join(dirs.image, file));
      const result = run(dirs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no usable checksum");
      expect(result.started).toBe(false);
    });
  }

  test("an image that cannot be read at all (built before L5, or a legacy local build) refuses", () => {
    const result = run(layout(), { STUB_IMAGE_FAIL: "1" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot read run-job.sh and the env files");
    expect(result.started).toBe(false);
  });

  test("an image that answers with something other than checksums refuses", () => {
    const result = run(layout(), { STUB_IMAGE_GARBAGE: "1" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no usable checksum");
    expect(result.started).toBe(false);
  });

  test("a pointed-to env file is compared too (AWCMS_JOBS_ENV_SCOPED override)", () => {
    const dirs = layout();
    const elsewhere = path.join(sandbox, "elsewhere-scoped");
    copyFileSync(path.join(dirs.host, "awcms-jobs.env-scoped"), elsewhere);
    writeFileSync(elsewhere, `${readFileSync(elsewhere, "utf8")}# drift\n`);
    const result = run(dirs, { AWCMS_JOBS_ENV_SCOPED: elsewhere });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("host awcms-jobs.env-scoped differs");
    expect(result.started).toBe(false);
  });

  test("an unreadable host env file refuses (it is not silently skipped)", () => {
    const dirs = layout();
    const result = run(dirs, {
      AWCMS_JOBS_ENV_GLOBAL: path.join(dirs.host, "does-not-exist")
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not readable");
    expect(result.started).toBe(false);
  });

  test("there is no environment switch that skips the comparison", () => {
    const source = read("ops/run-job.sh");
    const start = source.indexOf("verify_image_ops() {");
    const end = source.indexOf("\n}\n", start);
    const body = source.slice(start, end);
    // Every variable the function body consults must be one it set itself or
    // one of the documented path/image overrides; none may be a skip flag.
    expect(body).not.toMatch(/\bAWCMS_JOBS_(SKIP|ALLOW|IGNORE|FORCE)\w*/);
    expect(source).not.toMatch(/\bAWCMS_JOBS_(SKIP|ALLOW|IGNORE|FORCE)\w*/);
  });

  test("the comparison runs before the job container is started and after the app check", () => {
    const source = read("ops/run-job.sh");
    const call = source.indexOf("\nverify_image_ops\n");
    expect(call).toBeGreaterThan(source.indexOf("app container not running"));
    expect(call).toBeLessThan(
      source.indexOf('docker run --rm --network "$NETWORK"')
    );
  });
});
