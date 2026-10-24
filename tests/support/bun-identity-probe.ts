/**
 * Child-process probe for `tests/bun-only-launch-manifests.test.ts` (Issue #1170).
 *
 * Run as `bun tests/support/bun-identity-probe.ts <worker.ts> ...` with a
 * scrubbed environment (no DATABASE_URL, no provider secrets). For each worker
 * entrypoint it imports the module — workers guard their `main()` behind
 * `import.meta.main`, so importing one connects to nothing and sends nothing —
 * and prints, as one JSON line, who was running when it did so.
 *
 * It is a separate process on purpose: the identity being asserted is the one a
 * scheduler's `bun run <target>` produces, not the test runner's own.
 */
import path from "node:path";

type Probe = {
  bunVersion: string | undefined;
  bunGlobal: string;
  execPath: string;
  argv0: string | undefined;
  imported: string[];
  failed: { file: string; error: string }[];
};

const probe: Probe = {
  bunVersion: process.versions.bun,
  bunGlobal: typeof Bun,
  execPath: process.execPath,
  argv0: process.argv[0],
  imported: [],
  failed: []
};

for (const file of process.argv.slice(2)) {
  try {
    await import(path.resolve(file));
    probe.imported.push(file);
  } catch (error) {
    probe.failed.push({
      file,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

console.log(JSON.stringify(probe));
