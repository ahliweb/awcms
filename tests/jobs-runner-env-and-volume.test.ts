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

const RUNNER = "ops/run-job.sh";
const ALLOWLIST = "ops/awcms-jobs.env-allowlist";

async function runnerSource(): Promise<string> {
  return Bun.file(RUNNER).text();
}

/** The runner's own selection expression, driven over a fixture environment. */
async function selectEnv(fixture: string): Promise<string[]> {
  const script = `
set -euo pipefail
NAMES=$(grep -vE '^\\s*(#|$)' "${ALLOWLIST}")
awk -F= 'NR==FNR { want[$0]=1; next } ($1 in want)' <(printf '%s\\n' "$NAMES") -
`;

  const proc = Bun.spawn(["bash", "-c", script], {
    stdin: new TextEncoder().encode(fixture),
    stdout: "pipe",
    stderr: "pipe"
  });

  const out = await new Response(proc.stdout).text();
  await proc.exited;

  return out.split("\n").filter((line) => line.length > 0);
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
      ].join("\n")
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
    expect(source).toContain("awcms-jobs.env-allowlist");
  });

  test("an unreadable allow-list REFUSES the run", async () => {
    const source = await runnerSource();

    // Falling back to "copy everything" or "copy nothing" both produce a job
    // that runs and reports success, which is the failure this whole finding is
    // about. The only safe answer is to not run.
    const guard = source.indexOf('if [ ! -r "$ALLOWLIST" ]');
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
    const list = await Bun.file(ALLOWLIST).text();

    expect(list).toContain(
      "GENERATED by `bun run jobs:env-allowlist:generate`"
    );
  });

  test("names the variables both artefact-writing jobs read", async () => {
    const list = await Bun.file(ALLOWLIST).text();
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
