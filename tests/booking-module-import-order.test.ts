/**
 * Importing `booking/module.ts` FIRST must not trip the module registry (Issue
 * #1278, item 3).
 *
 * `src/modules/index.ts` imports every module descriptor and builds its list at
 * load. If a descriptor's own import graph reaches `index.ts` (here through
 * `booking-port-adapter` -> ... -> `domain-event-runtime/infrastructure/
 * consumer-registry` -> `index.ts`), then entering through that descriptor first
 * makes the registry evaluate while the descriptor is still uninitialised:
 * `ReferenceError: Cannot access 'bookingModule' before initialization`. It
 * passed only when an earlier file had already loaded the registry, so the order
 * of the first import decided it.
 *
 * A fresh process, because the order is a property of a process that has loaded
 * nothing else; an in-process `import()` would find the registry already there.
 * The scrubbed environment also proves the import needs no database.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

async function importInFreshProcess(
  entry: string
): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `await import(${JSON.stringify(path.join(ROOT, entry))}); ` +
        `const { listModules } = await import(${JSON.stringify(path.join(ROOT, "src/modules/index.ts"))}); ` +
        `if (!listModules().some((m) => m.key === "booking")) process.exit(3);`
    ],
    {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp" },
      stdout: "pipe",
      stderr: "pipe"
    }
  );
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited
  ]);

  return { code, stderr };
}

describe("module import order (Issue #1278)", () => {
  test("booking/module.ts imported first still composes into the registry", async () => {
    const outcome = await importInFreshProcess("src/modules/booking/module.ts");

    expect(outcome.stderr).not.toContain("before initialization");
    expect(outcome.code).toBe(0);
  }, 60_000);

  test("the registry imported first still contains booking", async () => {
    const outcome = await importInFreshProcess("src/modules/index.ts");

    expect(outcome.code).toBe(0);
  }, 60_000);
});
