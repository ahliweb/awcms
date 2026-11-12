/**
 * Ephemeral per-run load-test environment (ADR-0161; owner decision on #1281,
 * option A: a separate app and a throw-away database with synthetic data,
 * destroyed after the run).
 *
 *   bun run loadtest:env:up   [-- --run-id <id>] [--posts 20] [--edge-cache off|auto|on]
 *   bun run loadtest:env:down -- --run-id <id>
 *
 * `up` prints the target URL and writes a 0600 env file with the run's
 * credentials (never printed). It tears the project down itself if any step
 * fails. No permanent environment is created, and nothing in here ever reads
 * DATABASE_URL or another credential from the caller: the database is the one
 * this project starts, and the migration child gets an environment built from
 * scratch.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { seed, tenantCodeFor } from "./seed";

const repoRoot = resolve(import.meta.dir, "../..");
const composeFile = join(import.meta.dir, "docker-compose.yml");
const RUN_ID_PATTERN = /^[a-z0-9-]{4,40}$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

export const markerFor = (runId: string) => `awcms-loadtest-ephemeral:${runId}`;
export const dbNameFor = (runId: string) =>
  `awcms_lt_${runId.replaceAll("-", "_")}`;
const stateDir = (runId: string) =>
  join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `awcms-loadtest-${runId}`);
const secret = () => randomBytes(18).toString("hex");

async function freePort(): Promise<number> {
  return await new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
    s.on("error", rej);
  });
}

type Ctx = { runId: string; env: Record<string, string> };

async function run(
  cmd: string[],
  opts: { env?: Record<string, string>; cwd?: string; quiet?: boolean } = {}
): Promise<string> {
  const p = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: opts.env,
    stdout: "pipe",
    stderr: opts.quiet ? "pipe" : "inherit"
  });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  if (code !== 0)
    throw new Error(`${cmd.slice(0, 4).join(" ")} exited ${code}`);
  return out;
}

const compose = (ctx: Ctx, ...args: string[]) =>
  run(["docker", "compose", "-f", composeFile, ...args], {
    env: { ...process.env, ...ctx.env } as Record<string, string>
  });

/**
 * Connection URL for this run's loopback database. Built through `URL` so the
 * credential is percent-encoded rather than spliced into a string; every value
 * here is generated per run by `secret()` and never leaves the machine.
 */
function loopbackPgUrl(
  user: string,
  credential: string,
  port: number | string,
  db: string | undefined
): string {
  if (!db) throw new Error("LT_DB_NAME is not set for this run");
  const url = new URL(`postgres://127.0.0.1:${port}/${encodeURIComponent(db)}`);
  url.username = user;
  url.password = credential;
  return url.toString();
}

async function psql(ctx: Ctx, sql: string): Promise<string> {
  return run(
    [
      "docker",
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "lt_admin",
      "-d",
      ctx.env.LT_DB_NAME!,
      "-tAc",
      sql
    ],
    {
      env: { ...process.env, ...ctx.env } as Record<string, string>,
      quiet: true
    }
  );
}

/** The guard every write passes: the database must be the marked, run-scoped one. */
async function assertEphemeralDatabase(ctx: Ctx): Promise<void> {
  const name = (await psql(ctx, "select current_database()")).trim();
  const comment = (
    await psql(
      ctx,
      `select shobj_description(oid,'pg_database') from pg_database where datname = current_database()`
    )
  ).trim();
  if (
    name !== dbNameFor(ctx.runId) ||
    !name.startsWith("awcms_lt_") ||
    comment !== markerFor(ctx.runId)
  ) {
    throw new Error(
      "refusing to continue: the database is not this run's marked ephemeral database"
    );
  }
}

async function waitFor(url: string, tries = 90): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${url} never became ready`);
}

async function down(runId: string): Promise<void> {
  const env = { LT_RUN_ID: runId };
  // Project-scoped by name: only the containers, network, volumes and image
  // of this run are touched. Placeholders satisfy compose's required vars.
  const filler = Object.fromEntries(
    [
      "LT_DB_ADMIN_PASSWORD",
      "LT_DB_NAME",
      "LT_DB_PORT",
      "LT_APP_PORT",
      "LT_DB_APP_PASSWORD",
      "LT_DB_SETUP_PASSWORD",
      "LT_APP_SECRET",
      "LT_IDEMPOTENCY_SECRET"
    ].map((k) => [k, k.endsWith("_PORT") ? "1" : "x"])
  );
  await run(
    [
      "docker",
      "compose",
      "-p",
      `awcms-lt-${runId}`,
      "-f",
      composeFile,
      "down",
      "--volumes",
      "--remove-orphans",
      "--rmi",
      "local"
    ],
    { env: { ...process.env, ...filler, ...env } as Record<string, string> }
  );
  rmSync(stateDir(runId), { recursive: true, force: true });
  console.log(`ephemeral environment ${runId} destroyed`);
}

async function up(): Promise<void> {
  const runId =
    arg("run-id") ??
    `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("--run-id must be a-z, 0-9, hyphen, 4-40 chars");
  }
  const posts = Number(arg("posts") ?? "20");
  const dbPort = await freePort();
  const appPort = await freePort();
  const adminPassword = secret();
  const appDbPassword = secret();
  const setupDbPassword = secret();
  const ownerPassword = `Lt-${secret()}`;
  const ctx: Ctx = {
    runId,
    env: {
      LT_RUN_ID: runId,
      LT_DB_NAME: dbNameFor(runId),
      LT_DB_PORT: String(dbPort),
      LT_APP_PORT: String(appPort),
      LT_DB_ADMIN_PASSWORD: adminPassword,
      LT_DB_APP_PASSWORD: appDbPassword,
      LT_DB_SETUP_PASSWORD: setupDbPassword,
      LT_APP_SECRET: secret(),
      LT_IDEMPOTENCY_SECRET: secret() + secret(),
      LT_EDGE_CACHE_MODE: arg("edge-cache") ?? "off"
    }
  };
  const baseUrl = `http://127.0.0.1:${appPort}`;

  try {
    await compose(ctx, "up", "-d", "--wait", "db");
    // The marker is written by this tool, to the database this project just
    // created, before anything else touches it.
    await psql(
      ctx,
      `comment on database "${ctx.env.LT_DB_NAME}" is '${markerFor(runId)}'`
    );
    await assertEphemeralDatabase(ctx);

    // Migrations run on the host against this run's database. The child gets
    // an environment built from scratch: no inherited DATABASE_URL.
    await run(["bun", "scripts/db-migrate.ts"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATABASE_URL: loopbackPgUrl(
          "lt_admin",
          adminPassword,
          dbPort,
          ctx.env.LT_DB_NAME
        )
      }
    });

    // Activate the least-privilege roles so the run exercises RLS as the
    // real runtime does, not a superuser that bypasses it (ADR-0003).
    await assertEphemeralDatabase(ctx);
    await psql(
      ctx,
      `alter role awcms_app login password '${appDbPassword}'; alter role awcms_setup login password '${setupDbPassword}'`
    );

    await compose(ctx, "up", "-d", "--build", "--wait", "app");
    await waitFor(`${baseUrl}/api/v1/health`);

    await assertEphemeralDatabase(ctx);
    const seeded = await seed({
      baseUrl,
      runId,
      password: ownerPassword,
      postCount: posts
    });

    const dir = stateDir(runId);
    mkdirSync(dir, { recursive: true });
    const envFile = join(dir, "loadtest.env");
    writeFileSync(
      envFile,
      [
        `LOADTEST_RUN_ID=${runId}`,
        `LOADTEST_BASE_URL=${baseUrl}`,
        `LOADTEST_TENANT_CODE=${seeded.tenantCode}`,
        `LOADTEST_TENANT_ID=${seeded.tenantId}`,
        `LOADTEST_LOGIN_IDENTIFIER=${seeded.loginIdentifier}`,
        `LOADTEST_LOGIN_PASSWORD=${ownerPassword}`,
        `LOADTEST_POST_COUNT=${posts}`,
        `LOADTEST_TARGET_APPROVED=${runId}`,
        ""
      ].join("\n")
    );
    chmodSync(envFile, 0o600);

    console.log(`ephemeral environment ready`);
    console.log(`  run id      ${runId}`);
    console.log(`  target URL  ${baseUrl}  (loopback only)`);
    console.log(`  tenant code ${tenantCodeFor(runId)}  posts ${posts}`);
    console.log(
      `  credentials ${envFile}  (mode 0600; source it, do not print it)`
    );
    console.log(`  destroy     bun run loadtest:env:down -- --run-id ${runId}`);
  } catch (error) {
    console.error(
      `up failed: ${(error as Error).message}; destroying the environment`
    );
    await down(runId).catch((e) => console.error(`teardown failed: ${e}`));
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === "up") {
  await up();
} else if (command === "down") {
  const runId = arg("run-id");
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    console.error("--run-id is required");
    process.exit(64);
  }
  await down(runId);
} else {
  console.error("usage: ephemeral.ts up|down [--run-id <id>]");
  process.exit(64);
}
