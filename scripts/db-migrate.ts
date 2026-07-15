import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { redactSecretsInText } from "../src/modules/_shared/redaction";

export type MigrationFile = {
  name: string;
  path: string;
  sql: string;
  checksum: string;
};

export type AppliedMigration = {
  migration_name: string;
  checksum: string | null;
};

type MigrationResult = {
  applied: string[];
  skipped: string[];
};

const MIGRATION_FILE_PATTERN = /^\d{3}_awcms_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_KEY = 8_402_017_551;
const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS awcms_schema_migrations (
  id bigserial PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  checksum text,
  executed_at timestamptz NOT NULL DEFAULT now()
)`;

export function computeMigrationChecksum(sql: string): string {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

/** A migration file may optionally wrap itself in `BEGIN;`/`COMMIT;` for readability — the runner manages the real transaction boundary itself. */
export function stripOptionalTransactionWrapper(sql: string): string {
  return sql
    .trim()
    .replace(/^(BEGIN|START\s+TRANSACTION)\s*;\s*/i, "")
    .replace(/\s*(COMMIT|ROLLBACK)\s*;\s*$/i, "")
    .trim();
}

export async function discoverMigrationFiles(
  migrationsDir = path.resolve(process.cwd(), "sql")
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  const invalidFile = fileNames.find(
    (fileName) => !MIGRATION_FILE_PATTERN.test(fileName)
  );

  if (invalidFile) {
    throw new Error(
      `Invalid migration file name: ${invalidFile}. Use NNN_awcms_<area>_<description>.sql.`
    );
  }

  return Promise.all(
    fileNames.map(async (name) => {
      const migrationPath = path.join(migrationsDir, name);
      const sql = stripOptionalTransactionWrapper(
        await readFile(migrationPath, "utf8")
      );

      return {
        name,
        path: migrationPath,
        sql,
        checksum: computeMigrationChecksum(sql)
      };
    })
  );
}

export function validateAppliedChecksums(
  migrations: MigrationFile[],
  appliedMigrations: AppliedMigration[]
) {
  const appliedByName = new Map(
    appliedMigrations.map((m) => [m.migration_name, m.checksum])
  );

  for (const migration of migrations) {
    const appliedChecksum = appliedByName.get(migration.name);

    if (appliedChecksum && appliedChecksum !== migration.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${migration.name}. Create a new migration instead of editing an applied one.`
      );
    }
  }
}

async function runMigrations(
  sql: Bun.SQL,
  migrations: MigrationFile[]
): Promise<MigrationResult> {
  await sql.unsafe(MIGRATION_TABLE_SQL);
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

  try {
    const appliedRows = await sql<AppliedMigration[]>`
      SELECT migration_name, checksum FROM awcms_schema_migrations ORDER BY migration_name ASC
    `;

    validateAppliedChecksums(migrations, appliedRows);

    const appliedByName = new Set(appliedRows.map((m) => m.migration_name));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      if (appliedByName.has(migration.name)) {
        skipped.push(migration.name);
        continue;
      }

      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO awcms_schema_migrations (migration_name, checksum)
          VALUES (${migration.name}, ${migration.checksum})
        `;
      });

      applied.push(migration.name);
    }

    return { applied, skipped };
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}

function maskUrlPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);

    if (url.password) url.password = "****";

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function redactDatabaseUrl(input: string, databaseUrl: string): string {
  if (!databaseUrl) return input;

  return input
    .split(databaseUrl)
    .join("[redacted DATABASE_URL]")
    .split(maskUrlPassword(databaseUrl))
    .join("[redacted DATABASE_URL]");
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  if (!databaseUrl.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must use the postgres:// protocol.");
  }

  return databaseUrl;
}

function safeErrorMessage(error: unknown, databaseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);

  return redactSecretsInText(redactDatabaseUrl(message, databaseUrl));
}

async function main() {
  let databaseUrl = "";
  let sql: Bun.SQL | undefined;

  try {
    databaseUrl = getDatabaseUrl();
    sql = new Bun.SQL(databaseUrl, { max: 1 });

    const migrations = await discoverMigrationFiles();
    const result = await runMigrations(sql, migrations);

    for (const name of result.skipped) console.log(`skip ${name}`);
    for (const name of result.applied) console.log(`apply ${name}`);

    console.log(
      `db:migrate complete — ${result.applied.length} applied, ${result.skipped.length} skipped`
    );
  } catch (error) {
    console.error(
      `db:migrate failed — ${safeErrorMessage(error, databaseUrl)}`
    );
    process.exitCode = 1;
  } finally {
    await sql?.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
