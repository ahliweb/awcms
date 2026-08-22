/**
 * Two operational signals that were wrong — findings D9 and D10 of the
 * 17 August 2026 audit round.
 *
 * ## D9 — the log file named at attach time
 *
 * `ops/ship-logs.sh` redirected the tailer with
 * `>> "${DEST}/app-$(date -u +%Y-%m-%d).log"`. A redirect names its file ONCE,
 * when the shell spawns the process, and the descriptor then lives until the
 * container changes — weeks, on a stable deployment. Two consequences that
 * compound: today's lines land in a file dated by the last DEPLOY, and the
 * `-mtime` retention sweep can never reclaim it, because the file it should be
 * deleting is the one still being written.
 *
 * The distinguishing behaviour is **reopen per line**, and it is testable
 * without waiting for midnight: delete the file underneath a running writer.
 * A single long-lived descriptor keeps writing into an unlinked inode and the
 * file never comes back; a per-line `>>` recreates it on the next line. That is
 * what the first suite below actually executes, against the payload extracted
 * from the script itself rather than a copy of it.
 *
 * ## D10 — nothing read the readiness endpoint
 *
 * `/api/v1/database/pool/health` reports `databaseReachable` and
 * `circuitBreakerState`, is unauthenticated, and was consulted by nothing.
 * Coolify, the container `HEALTHCHECK` and the Varnish probe all read the
 * dependency-free liveness endpoint — correctly, because all three restart or
 * reroute and restarting an app does not repair a database. What was missing
 * was a reader on the path that pages a person. Asserted as source, because
 * running it needs a live deployment; what is checked is that the probe exists,
 * reads both fields, and that the three restart/reroute probes were NOT
 * switched over.
 */
import { describe, expect, test } from "bun:test";

/**
 * `scripts/lib/source-text`'s `stripComments` understands `//` and block
 * comments, not `#` — so on a shell file it leaves every comment intact. That
 * matters here more than usual: the comments in both scripts QUOTE the defect
 * they replaced, so a substring check that reads them answers about the
 * documentation and not the code.
 *
 * A line whose first non-space character is `#` is a comment. `#` never opens
 * one mid-line in either file, and the `bash -c` payload contains none at all.
 */
function shellCodeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const SHIP_LOGS = "ops/ship-logs.sh";
const SYNTHETIC = "ops/synthetic-check.sh";
const DOCKERFILE = "Dockerfile.production";
const VCL = "infra/varnish/default.vcl";
const READINESS_PATH = "/api/v1/database/pool/health";

/**
 * The `bash -c '…'` payload the script hands to `setsid nohup`, taken from the
 * file so the test cannot drift from what actually ships.
 */
async function extractWriterPayload(): Promise<string> {
  const source = await Bun.file(SHIP_LOGS).text();
  const match = /setsid nohup bash -c '([\s\S]*?)'\s*_\s/.exec(source);

  if (!match) {
    throw new Error(
      "could not find the `setsid nohup bash -c '…' _` writer in ops/ship-logs.sh"
    );
  }

  return match[1]!;
}

/** Runs the payload with `docker` stubbed to emit `lines`, one per interval. */
async function runWriter(
  destination: string,
  lines: readonly string[],
  perLineDelayMs: number
): Promise<{ stop: () => void; exited: Promise<number> }> {
  const emitter = lines
    .map(
      (line) =>
        `printf '%s\\n' ${JSON.stringify(line)}; sleep ${perLineDelayMs / 1000}`
    )
    .join("; ");

  // The payload calls `docker logs -f --timestamps "$2"`. Shadowing `docker`
  // with a shell function keeps the payload byte-identical to the shipped one.
  const script = `
docker() { ${emitter}; }
export -f docker 2>/dev/null || true
${await extractWriterPayload()}
`;

  const proc = Bun.spawn(["bash", "-c", script, "_", destination, "stub"], {
    stdout: "pipe",
    stderr: "pipe"
  });

  return { stop: () => proc.kill(), exited: proc.exited };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await Bun.sleep(25);
  }

  return false;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("D9 — ship-logs writes through a per-line reopen, not one descriptor", () => {
  test("the tailer's output is no longer a redirect naming the file once", async () => {
    const source = shellCodeOnly(await Bun.file(SHIP_LOGS).text());

    // The exact shape of the defect: a `$(date …)` evaluated by the SPAWNING
    // shell, inside a redirect target.
    expect(source).not.toMatch(/>>\s*"\$\{DEST\}\/app-\$\(date/);
    expect(source).toContain('printf -v day "%(%Y-%m-%d)T" -1');
  });

  test("lines land in a file named for today, in UTC", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/awcms-shiplogs-${crypto.randomUUID()}`;
    await Bun.$`mkdir -p ${dir}`.quiet();

    const writer = await runWriter(dir, ["alpha", "beta"], 50);
    const target = `${dir}/app-${todayUtc()}.log`;

    const appeared = await waitFor(async () =>
      (
        await Bun.file(target)
          .text()
          .catch(() => "")
      ).includes("beta")
    );

    writer.stop();
    await writer.exited;

    expect(appeared).toBe(true);
    expect(await Bun.file(target).text()).toContain("alpha");

    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("deleting the file underneath the writer does not lose the next line", async () => {
    // This is the property a single long-lived descriptor cannot have: it would
    // keep writing into the unlinked inode and the path would stay gone. It is
    // also the same property that makes the `-mtime` retention sweep safe to
    // run against a live tailer.
    const dir = `${process.env.TMPDIR ?? "/tmp"}/awcms-shiplogs-${crypto.randomUUID()}`;
    await Bun.$`mkdir -p ${dir}`.quiet();

    const writer = await runWriter(dir, ["first", "second", "third"], 250);
    const target = `${dir}/app-${todayUtc()}.log`;

    const started = await waitFor(async () =>
      (
        await Bun.file(target)
          .text()
          .catch(() => "")
      ).includes("first")
    );
    expect(started).toBe(true);

    await Bun.$`rm -f ${target}`.quiet();

    const recreated = await waitFor(async () =>
      (
        await Bun.file(target)
          .text()
          .catch(() => "")
      ).includes("third")
    );

    writer.stop();
    await writer.exited;

    const finalText = await Bun.file(target)
      .text()
      .catch(() => "");

    expect(recreated).toBe(true);
    // Proof it is a NEW file rather than the original one still open: the line
    // written before the delete is gone.
    expect(finalText).not.toContain("first");

    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("CONTROL: the redirect form this replaced loses the file", async () => {
    // Without this, the test above only proves the new writer works — not that
    // it differs from the old one. Same procedure, the shape that shipped: one
    // `>>` evaluated by the spawning shell. The descriptor survives the delete;
    // the path does not come back, and every line after it is written into an
    // inode nothing can open.
    const dir = `${process.env.TMPDIR ?? "/tmp"}/awcms-shiplogs-${crypto.randomUUID()}`;
    await Bun.$`mkdir -p ${dir}`.quiet();

    const target = `${dir}/app-${todayUtc()}.log`;

    // The redirect is applied ONCE, to the whole group — the shape that
    // shipped. `first` lands, the file is deleted, `third` is written into the
    // descriptor that is still open on the unlinked inode.
    const writer = Bun.spawn(
      [
        "bash",
        "-c",
        `{ printf '%s\\n' first; sleep 0.4; printf '%s\\n' third; } >> "$1"`,
        "_",
        target
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    const started = await waitFor(async () =>
      (
        await Bun.file(target)
          .text()
          .catch(() => "")
      ).includes("first")
    );
    expect(started).toBe(true);

    await Bun.$`rm -f ${target}`.quiet();
    await writer.exited;

    // `third` was written after the delete, into the unlinked inode.
    expect(await Bun.file(target).exists()).toBe(false);

    await Bun.$`rm -rf ${dir}`.quiet();
  });
});

describe("D10 — the readiness endpoint has a reader", () => {
  test("the synthetic check reads it, and checks BOTH fields", async () => {
    const source = shellCodeOnly(await Bun.file(SYNTHETIC).text());

    expect(source).toContain(READINESS_PATH);
    // A probe that fetched it and only asserted a 200 would be the liveness
    // check again under a different URL: this endpoint answers 200 while
    // reporting the database is gone.
    expect(source).toContain('"databaseReachable":true');
    expect(source).toContain('"circuitBreakerState":"open"');
  });

  test("the three restart/reroute probes still use LIVENESS", async () => {
    // Deliberate, and the reason is written at each site: they restart or
    // reroute, and restarting an app does not repair a database. A future
    // "fix" that points these at readiness turns a database outage into a
    // container restart loop.
    // Comment-stripped: both files now EXPLAIN the split, naming the readiness
    // path in prose. Reading that prose as configuration is the mistake this
    // assertion exists to avoid making itself.
    const dockerfile = shellCodeOnly(await Bun.file(DOCKERFILE).text());
    const vcl = await Bun.file(VCL).text();

    expect(dockerfile).toContain("/api/v1/health");
    expect(dockerfile).not.toContain(READINESS_PATH);
    expect(vcl).toContain('.url = "/api/v1/health"');
  });

  test("the deploy runbook states which endpoint answers which question", async () => {
    const runbook = await Bun.file("docs/awcms/deploy-coolify.md").text();

    expect(runbook).toContain(READINESS_PATH);
    expect(runbook).toContain("LIVENESS");
    expect(runbook).toContain("Do NOT point Coolify's Health Check Path");
  });
});
