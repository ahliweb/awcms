/**
 * The realtime topic registry and the runtime boundary of ADR-0154 (Issue
 * #1171), checked structurally. Pure: repository files only.
 *
 * - Every admitted topic's permission is declared by its module AND seeded by a
 *   migration (a permission nothing seeds denies even `owner`), its two routes
 *   exist, and both paths are in the OpenAPI contract.
 * - R10: no WebSocket server, no Socket.IO, no `ws`, no `server.upgrade` seam,
 *   and no Node launch command enters the repository. WebSocket is not admitted
 *   (ADR-0154 section 1.2); admitting it needs a new ADR, which would also
 *   change this test.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { listModules } from "../src/modules";
import { REALTIME_TOPICS } from "../src/modules/_shared/realtime-topics";

const ROOT = join(import.meta.dir, "..");

function routeFile(path: string): string {
  return join(ROOT, "src/pages", `${path}.ts`);
}

function allSql(): string {
  return readdirSync(join(ROOT, "sql"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(ROOT, "sql", name), "utf8"))
    .join("\n");
}

function walk(directory: string, into: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) walk(path, into);
    else if (/\.(ts|mjs|astro|js)$/.test(path)) into.push(path);
  }

  return into;
}

describe("admitted realtime topics", () => {
  const sql = allSql();
  const openapi = readFileSync(
    join(ROOT, "openapi/awcms-public-api.openapi.yaml"),
    "utf8"
  );

  for (const topic of REALTIME_TOPICS) {
    test(`${topic.topic}: permission declared, seeded, enforced by real routes, in OpenAPI`, () => {
      const module = listModules().find((m) => m.key === topic.moduleKey);

      expect(module).toBeDefined();
      expect(
        module!.permissions?.some(
          (p) =>
            p.activityCode === topic.permission.activityCode &&
            p.action === topic.permission.action
        )
      ).toBe(true);

      expect(sql).toContain(
        `('${topic.moduleKey}', '${topic.permission.activityCode}', '${topic.permission.action}',`
      );

      for (const path of [topic.streamPath, topic.snapshotPath]) {
        expect(existsSync(routeFile(path))).toBe(true);
        expect(openapi).toContain(`  ${path.replace("[id]", "{id}")}:`);
      }

      expect(readFileSync(routeFile(topic.streamPath), "utf8")).toContain(
        "defineProgressSseRoute("
      );
    });
  }

  test("topic names are unique", () => {
    const names = REALTIME_TOPICS.map((t) => t.topic);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("ADR-0154 R10: no second realtime authority", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  test("no WebSocket or Socket.IO dependency", () => {
    const names = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies
    });

    for (const forbidden of [
      "ws",
      "socket.io",
      "socket.io-client",
      "uWebSockets.js",
      "sockjs",
      "engine.io"
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  test("no script launches Node", () => {
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      expect(
        /(^|[\s;&|(])(node|npx|npm|pnpm|yarn)\s/.test(command),
        `script ${name} launches a non-Bun runtime: ${command}`
      ).toBe(false);
    }
  });

  test("no WebSocket server or upgrade seam in src/", () => {
    const offenders: string[] = [];

    for (const file of walk(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");

      if (
        /from\s+["'](ws|socket\.io)["']/.test(text) ||
        /new\s+WebSocketServer\s*\(/.test(text) ||
        /\.upgrade\s*\(\s*req/.test(text) ||
        /websocket\s*:\s*\{/.test(text)
      ) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});
