/**
 * Synthetic backup-restore drill (Issue #968, generic half).
 *
 *   DRILL_SOURCE_URL=postgres://<superuser>@127.0.0.1:<port>/postgres \
 *   DRILL_TARGET_URL=postgres://<superuser>@127.0.0.1:<other-port>/postgres \
 *   bun run ops:restore-drill [--reservations N] [--employees N] [--days N] [--report file.json]
 *
 * Creates a disposable database in each of TWO loopback clusters, migrates and
 * seeds the first with synthetic data (booking reservations and allocations,
 * hr_workforce attendance), pins a snapshot, writes MORE data after it, dumps
 * that snapshot with `pg_dump`, provisions the roles in the second cluster,
 * restores, and verifies (scripts/lib/restore-drill.ts): row counts and
 * checksums per table, the point in time, RLS FORCE and the role grants (as the
 * runtime role `awcms_app`, not a superuser), and the booking reconciliation.
 * It reports the measured RTO of the dump + role provisioning + restore +
 * verification for the stated volume, then drops both databases.
 *
 * It only ever runs against loopback hosts and only creates or drops databases
 * named `awcms_drill_*`. It is NOT the production drill: that is the operator's
 * runbook in docs/awcms/restore-drill.md. Bun for everything but the
 * `pg_dump`/`pg_restore` binaries themselves (the same exemption as
 * deploy/backup/*.sh).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import {
  assertDrillDatabaseName,
  assertLocalHost,
  connectionUrl,
  dumpMajorVersion,
  parseConnection,
  quoteIdent,
  setRolePassword,
  summarize,
  type ConnectionParts
} from "./lib/restore-drill";
import { runCycle } from "./lib/restore-drill-run";
import { DEFAULT_VOLUME, seedDrillData } from "./lib/restore-drill-seed";

// Fixture passwords of a throwaway cluster, never a deployment credential.
const APP_PASSWORD = "drill_app_role_password";
const WORKER_PASSWORD = "drill_worker_role_password";

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);

  return at === -1 ? undefined : process.argv[at + 1];
}

function numberArgument(name: string, fallback: number, max: number): number {
  const value = argument(name);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`--${name} must be an integer between 1 and ${max}.`);
  }

  return parsed;
}

async function timed<T>(
  phases: Record<string, number>,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = performance.now();

  try {
    return await fn();
  } finally {
    phases[name] = Math.round(performance.now() - started);
  }
}

async function migrate(url: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: url, SETUP_DATABASE_URL: url },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (code !== 0) {
    throw new Error(
      `db:migrate failed (exit ${code}): ${stdout}\n${stderr}`.slice(0, 1200)
    );
  }
}

// Not spelled `Bun.SQL`: `db:transaction-swallow:check` reads that annotation as an open
// transaction handle, and these helpers deliberately ignore failures of connections that
// are not inside one.
type Connection = InstanceType<typeof Bun.SQL>;

/** Cleanup is best effort: a failure to close or drop must not mask the drill's own verdict. */
async function closeQuietly(connection: Connection): Promise<void> {
  await Promise.allSettled([connection.close()]);
}

async function dropDatabaseQuietly(
  cluster: Connection,
  database: string
): Promise<void> {
  assertDrillDatabaseName(database);
  await Promise.allSettled([
    cluster.unsafe(
      `DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`
    )
  ]);
}

async function main(): Promise<void> {
  const sourceUrl = process.env.DRILL_SOURCE_URL ?? "";
  const targetUrl = process.env.DRILL_TARGET_URL ?? "";

  if (!sourceUrl || !targetUrl) {
    throw new Error(
      "DRILL_SOURCE_URL and DRILL_TARGET_URL are required (two loopback clusters)."
    );
  }

  const sourceBase = parseConnection(sourceUrl, "postgres");
  const targetBase = parseConnection(targetUrl, "postgres");

  assertLocalHost(sourceBase.host);
  assertLocalHost(targetBase.host);

  if (
    `${sourceBase.host}:${sourceBase.port}` ===
    `${targetBase.host}:${targetBase.port}`
  ) {
    throw new Error(
      "source and target must be two DIFFERENT clusters: roles are cluster-scoped, and a restore into the cluster that already has them would prove nothing about them."
    );
  }

  const volume = {
    reservationsPerTenant: numberArgument(
      "reservations",
      DEFAULT_VOLUME.reservationsPerTenant,
      2000
    ),
    employeesPerTenant: numberArgument(
      "employees",
      DEFAULT_VOLUME.employeesPerTenant,
      200
    ),
    attendanceDays: numberArgument("days", DEFAULT_VOLUME.attendanceDays, 6)
  };

  const suffix = `${process.pid}_${Date.now().toString(36)}`;
  const sourceDb = `awcms_drill_src_${suffix}`;
  const targetDb = `awcms_drill_dst_${suffix}`;

  assertDrillDatabaseName(sourceDb);
  assertDrillDatabaseName(targetDb);

  const source: ConnectionParts = { ...sourceBase, database: sourceDb };
  const target: ConnectionParts = { ...targetBase, database: targetDb };
  const sourceRoot = new Bun.SQL(connectionUrl(sourceBase), { max: 1 });
  const targetRoot = new Bun.SQL(connectionUrl(targetBase), { max: 1 });
  const phases: Record<string, number> = {};
  const workDir = await mkdtemp(path.join(tmpdir(), "awcms-restore-drill-"));
  const dumpFile = path.join(workDir, "drill.dump");

  const handles: Bun.SQL[] = [];
  const open = (
    parts: ConnectionParts,
    user?: string,
    password?: string,
    max = 2
  ) => {
    const sql = new Bun.SQL(
      connectionUrl({
        ...parts,
        user: user ?? parts.user,
        password: password ?? parts.password
      }),
      { max }
    );

    handles.push(sql);

    return sql;
  };

  try {
    const dumpMajor = await dumpMajorVersion();
    const serverVersion = (await sourceRoot.unsafe(
      "SHOW server_version_num"
    )) as {
      server_version_num: string;
    }[];
    const serverMajor = Math.floor(
      Number(serverVersion[0]!.server_version_num) / 10000
    );

    if (dumpMajor < serverMajor) {
      throw new Error(
        `pg_dump ${dumpMajor} is older than the server ${serverMajor}: an older pg_dump refuses or mis-dumps a newer server.`
      );
    }

    await sourceRoot.unsafe(`CREATE DATABASE ${quoteIdent(sourceDb)}`);
    await targetRoot.unsafe(`CREATE DATABASE ${quoteIdent(targetDb)}`);

    const sourceUrlDb = connectionUrl(source);

    console.error(`[drill] migrating ${sourceDb} ...`);
    await timed(phases, "setupMigrateMs", () => migrate(sourceUrlDb));

    await setRolePassword(sourceRoot, "awcms_app", APP_PASSWORD);
    await setRolePassword(sourceRoot, "awcms_worker", WORKER_PASSWORD);

    const sourceAdmin = open(source, undefined, undefined, 1);
    const sourceApp = open(source, "awcms_app", APP_PASSWORD, 4);

    console.error("[drill] seeding synthetic data ...");

    const seeded = await timed(phases, "setupSeedMs", () =>
      seedDrillData(sourceAdmin, sourceApp, volume)
    );
    const cycle = await runCycle({
      source,
      sourceRoot,
      sourceAdmin,
      sourceApp,
      snapshotConnection: open(source, undefined, undefined, 1),
      seeded,
      target,
      targetRoot,
      activateTargetRoles: async () => {
        await setRolePassword(targetRoot, "awcms_app", APP_PASSWORD);
        await setRolePassword(targetRoot, "awcms_worker", WORKER_PASSWORD);
      },
      openTargetAdmin: () => open(target, undefined, undefined, 1),
      openTargetApp: () => open(target, "awcms_app", APP_PASSWORD, 2),
      dumpFile: dumpFile
    });
    const { witness, dumpBytes, checks } = cycle;

    Object.assign(phases, cycle.phasesMs);

    // The worker role must at least log in on the restored cluster.
    const workerRows = (await open(
      target,
      "awcms_worker",
      WORKER_PASSWORD,
      1
    ).unsafe("SELECT current_user AS user")) as { user: string }[];

    checks.push({
      id: "worker_role_login",
      ok: workerRows[0]!.user === "awcms_worker",
      detail: `logged in as ${workerRows[0]!.user}`
    });

    const report = summarize(checks);
    const rtoMs =
      (phases.dumpMs ?? 0) +
      (phases.provisionRolesMs ?? 0) +
      (phases.restoreMs ?? 0) +
      (phases.verifyMs ?? 0);
    const tableCount = Object.keys(witness.digests).length;
    const rows = Object.values(witness.digests).reduce(
      (sum, d) => sum + Number(d.count),
      0
    );
    const output = {
      scope:
        "LOCAL synthetic drill (loopback clusters); not a production measurement",
      ok: report.ok,
      volume: {
        ...volume,
        tenants: seeded.tenants.length,
        reservationRowsSeeded: seeded.reservations,
        attendanceEventsSeeded: seeded.attendanceEvents,
        tables: tableCount,
        totalRows: rows,
        dumpBytes
      },
      server: `postgres ${serverMajor}`,
      phasesMs: phases,
      measuredRtoMs: rtoMs,
      rpo: "Not measured here: RPO is a property of the backup policy (the interval between dumps plus any WAL archive), stated in docs/awcms/restore-drill.md; a drill restores a given dump, it does not choose one.",
      missingRequiredChecks: report.missingRequired,
      checks: report.checks,
      deferred: report.deferred
    };

    const file = argument("report");

    if (file) {
      await Bun.write(file, `${JSON.stringify(output, null, 2)}\n`);
    }

    console.log(JSON.stringify(output, null, 2));

    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    for (const handle of handles) {
      await closeQuietly(handle);
    }

    // Both names were validated as `awcms_drill_*` above: nothing else is ever dropped.
    await dropDatabaseQuietly(sourceRoot, sourceDb);
    await dropDatabaseQuietly(targetRoot, targetDb);
    await closeQuietly(sourceRoot);
    await closeQuietly(targetRoot);
    await rm(workDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`[drill] FAILED: ${safeErrorDetail(error)}`);
  process.exitCode = 1;
}
