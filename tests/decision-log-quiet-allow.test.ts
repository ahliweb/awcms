/**
 * Who may pass `recordDecision: false` to `authorizeInTransaction` (#1363
 * audit, Low). It skips a repeated ALLOW row, so only the progress-SSE scope
 * probes may use it. A new file that needs it must be added here on purpose,
 * with a reason, rather than by accident.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "src/modules/omnichannel-inbox/application/inbox-status-progress.ts",
  "src/modules/channel-accounts/application/channel-accounts-route-support.ts"
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|astro)$/.test(name)) out.push(path);
  }
  return out;
}

describe("recordDecision: false allow-list", () => {
  test("only the scope-probe files pass the quiet option", () => {
    const offenders = walk("src")
      .filter((file) =>
        /recordDecision:\s*false/.test(
          readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
        )
      )
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  test("the chokepoint only skips an ALLOW", () => {
    const source = readFileSync(
      "src/modules/identity-access/application/access-guard.ts",
      "utf8"
    );
    expect(source).toContain("quietAllow && outcome.allowed");
  });
});
