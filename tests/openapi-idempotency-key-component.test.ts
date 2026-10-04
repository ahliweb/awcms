/**
 * ADR-0129 (Issue #896): `Idempotency-Key` is declared ONCE, as the shared
 * `components.parameters.IdempotencyKey`, and agrees with the bound the
 * middleware enforces (`src/lib/security/idempotency-key-bound.ts`, PR #893).
 *
 * - the OpenAPI `minLength`/`maxLength`/`pattern` accept and reject exactly what
 *   the runtime constants do;
 * - no source fragment re-declares the parameter inline (the GATE: a new module
 *   that pastes `name: Idempotency-Key` fails here), and every operation that
 *   takes the header does so through the `$ref`.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_PATTERN
} from "../src/lib/security/idempotency-key-bound";

const ROOT = path.resolve(import.meta.dir, "..");
const REF = "#/components/parameters/IdempotencyKey";

type AnyRecord = Record<string, unknown>;

function sourceFiles(): string[] {
  const modules = readdirSync(path.join(ROOT, "openapi/modules"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => path.join("openapi/modules", f));
  return ["openapi/awcms-public-api.src.yaml", ...modules];
}

function rootComponent(): AnyRecord {
  const root = parseYaml(
    readFileSync(path.join(ROOT, "openapi/awcms-public-api.src.yaml"), "utf8")
  ) as AnyRecord;
  const found = (
    (root.components as AnyRecord).parameters as Record<string, AnyRecord>
  ).IdempotencyKey;
  if (!found) throw new Error("components.parameters.IdempotencyKey missing");
  return found;
}

describe("IdempotencyKey parameter component agrees with the runtime bound", () => {
  const component = rootComponent();
  const schema = component.schema as AnyRecord;

  test("shape: required header named Idempotency-Key, documenting the 400", () => {
    expect(component.in).toBe("header");
    expect(component.name).toBe("Idempotency-Key");
    expect(component.required).toBe(true);
    expect(schema.type).toBe("string");
    expect(String(component.description)).toContain("IDEMPOTENCY_KEY_INVALID");
  });

  test("maxLength equals IDEMPOTENCY_KEY_MAX_LENGTH, minLength is 1", () => {
    expect(schema.maxLength).toBe(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(schema.minLength).toBe(1);
  });

  test("pattern accepts and rejects exactly what the runtime pattern does", () => {
    const openApiPattern = new RegExp(String(schema.pattern));
    const samples: string[] = ["", "a", "a".repeat(255), "a".repeat(256)];
    for (let c = 0; c < 256; c += 1) {
      const ch = String.fromCharCode(c);
      samples.push(ch, `k${ch}k`);
    }
    samples.push("é", "key with space", "key\n", "\u{1F600}");
    for (const sample of samples) {
      expect(openApiPattern.test(sample)).toBe(
        IDEMPOTENCY_KEY_PATTERN.test(sample)
      );
    }
  });
});

describe("no source fragment declares Idempotency-Key inline", () => {
  test("zero inline `- name: Idempotency-Key` list entries in openapi sources (the root component is the one `name:` and is not a list entry)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*-\s+name:\s*["']?Idempotency-Key["']?\s*$/i.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("the only definition of the header is the root component (parsed, not text-matched)", () => {
    const inline: string[] = [];
    const walk = (node: unknown, where: string, inComponents: boolean) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${where}[${i}]`, inComponents));
      } else if (node && typeof node === "object") {
        const rec = node as AnyRecord;
        if (
          !inComponents &&
          rec.in === "header" &&
          typeof rec.name === "string" &&
          rec.name.toLowerCase() === "idempotency-key"
        ) {
          inline.push(where);
        }
        for (const [k, v] of Object.entries(rec))
          walk(v, `${where}.${k}`, false);
      }
    };
    for (const file of sourceFiles()) {
      const doc = parseYaml(
        readFileSync(path.join(ROOT, file), "utf8")
      ) as AnyRecord;
      walk(doc.paths, `${file}#paths`, false);
    }
    expect(inline).toEqual([]);
  });

  test("operations that take the header reference the component", () => {
    let refs = 0;
    for (const file of sourceFiles()) {
      refs += (
        readFileSync(path.join(ROOT, file), "utf8").match(
          new RegExp(`\\$ref: "${REF}"`, "g")
        ) ?? []
      ).length;
    }
    expect(refs).toBeGreaterThan(0);
  });
});
