/**
 * Issue #1185 - code-vs-contract drift gates for the vendored OMES worker
 * contract (`src/modules/omes-control/contracts/v1`, the pinned source of
 * truth; nothing here reads the network or the OMES repository).
 *
 * Two controls, each proven by a sibling mutation test:
 *
 *   1. `OMES_OPERATION_CODES` is byte-for-byte (and order-for-order) the
 *      vendored `operation-request` / `worker-poll.response` operation enum,
 *      and a subset of every broader operation enum. Enforced at deploy time
 *      by `bun run omes:contract:preflight` (part of `bun run check`).
 *   2. Every body the REAL worker route handlers answer with HTTP 200 on the
 *      unauthenticated path validates against the pinned `*.response` schema.
 *      The handlers are called directly (no database), so a handler that
 *      renames/drops a response field fails here, not in a worker.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SUPPORTED_WORKER_CAPABILITIES,
  evaluateWorkerCompatibility
} from "../src/modules/omes-control/domain/contracts/compatibility";
import { validateOmesContractText } from "../src/modules/omes-control/domain/contracts";
import {
  DESTRUCTIVE_OMES_OPERATIONS,
  OMES_OPERATION_CODES,
  OMES_OPERATION_GUARD
} from "../src/modules/omes-control/domain/operations";
import {
  checkOperationCodesAgainstContract,
  runOmesContractPreflight
} from "../scripts/omes-contract-preflight";
import { VENDORED_CONTRACTS_DIR } from "../scripts/sync-omes-contracts";
import { VENDORED_PRODUCER_COMPAT_DIR } from "../scripts/omes-contract-preflight";
import * as enrollRoute from "../src/pages/api/v1/omes/worker/enroll";
import * as heartbeatRoute from "../src/pages/api/v1/omes/worker/heartbeat";
import * as pollRoute from "../src/pages/api/v1/omes/worker/poll";
import * as resultRoute from "../src/pages/api/v1/omes/worker/result";

const ROOT = path.join(import.meta.dir, "..");

function schemaEnum(file: string, keys: string[]): string[] {
  let node = JSON.parse(
    readFileSync(path.join(ROOT, VENDORED_CONTRACTS_DIR, file), "utf8")
  ) as { properties?: Record<string, unknown>; enum?: string[] };
  for (const k of keys) node = node.properties?.[k] as typeof node;
  return node.enum as string[];
}

describe("OMES_OPERATION_CODES vs the vendored contract", () => {
  test("equals the operation-request and worker-poll job enums exactly, in order", () => {
    expect<string[]>([...OMES_OPERATION_CODES]).toEqual(
      schemaEnum("operation-request.schema.json", ["operation"])
    );
    expect<string[]>([...OMES_OPERATION_CODES]).toEqual(
      schemaEnum("worker-poll.response.schema.json", ["job", "operation"])
    );
  });

  test("is a subset of deployment.request, job-status and worker-result operation enums", () => {
    for (const file of [
      "deployment.request.schema.json",
      "job-status.response.schema.json",
      "worker-result.request.schema.json"
    ]) {
      const wide = schemaEnum(file, ["operation"]);
      for (const code of OMES_OPERATION_CODES) expect(wide).toContain(code);
    }
  });

  test("capabilities, guards and destructive set derive from the same closed list", () => {
    expect([...SUPPORTED_WORKER_CAPABILITIES].sort()).toEqual(
      [...OMES_OPERATION_CODES].sort()
    );
    expect(Object.keys(OMES_OPERATION_GUARD).sort()).toEqual(
      [...OMES_OPERATION_CODES].sort()
    );
    for (const op of DESTRUCTIVE_OMES_OPERATIONS) {
      expect(OMES_OPERATION_CODES).toContain(op);
    }
    // Operations the contract allows only for the direct job runner are
    // never a capability this consumer acts on.
    for (const op of ["install", "configure", "restore"]) {
      const verdict = evaluateWorkerCompatibility({
        contract_version: "v1",
        omes_version: "0.6.1",
        capabilities: [op]
      });
      expect(verdict.status).toBe("unsupported_capability");
    }
  });

  test("the real checkout has no drift", () => {
    expect(checkOperationCodesAgainstContract(ROOT)).toEqual([]);
  });

  test("MUTATION: one code changed, added or removed in code is refused", () => {
    const swapped = OMES_OPERATION_CODES.map((c) =>
      c === "rollback" ? "restore" : c
    );
    expect(checkOperationCodesAgainstContract(ROOT, swapped)).not.toEqual([]);
    expect(
      checkOperationCodesAgainstContract(ROOT, [
        ...OMES_OPERATION_CODES,
        "install"
      ])
    ).not.toEqual([]);
    expect(
      checkOperationCodesAgainstContract(ROOT, OMES_OPERATION_CODES.slice(1))
    ).not.toEqual([]);
    // Order is part of the byte-for-byte rule.
    expect(
      checkOperationCodesAgainstContract(
        ROOT,
        [...OMES_OPERATION_CODES].reverse()
      )
    ).not.toEqual([]);
  });

  test("MUTATION: one operation changed in the vendored schema is refused by the preflight", () => {
    const root = mkdtempSync(path.join(tmpdir(), "omes-opdrift-"));
    cpSync(
      path.join(ROOT, VENDORED_CONTRACTS_DIR),
      path.join(root, VENDORED_CONTRACTS_DIR),
      { recursive: true }
    );
    cpSync(
      path.join(ROOT, VENDORED_PRODUCER_COMPAT_DIR),
      path.join(root, VENDORED_PRODUCER_COMPAT_DIR),
      { recursive: true }
    );
    const file = path.join(
      root,
      VENDORED_CONTRACTS_DIR,
      "operation-request.schema.json"
    );
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"rollback"');
    writeFileSync(file, text.replace('"rollback"', '"rollbak"'));
    const r = runOmesContractPreflight(root, {
      openApiText: [
        "/api/v1/omes/worker/enroll",
        "/api/v1/omes/worker/poll",
        "/api/v1/omes/worker/result",
        "/api/v1/omes/worker/heartbeat"
      ]
        .map((p) => `  ${p}:\n`)
        .join("")
    });
    expect(r.failures.some((f) => f.includes("OMES_OPERATION_CODES"))).toBe(
      true
    );
  });
});

describe("worker route responses conform to the pinned *.response schemas", () => {
  type Handler = (ctx: never) => Promise<Response>;
  const call = async (
    route: { POST: unknown },
    name: string,
    body: string,
    n: number
  ) => {
    const res = await (route.POST as Handler)({
      request: new Request(`https://omes.example/api/v1/omes/worker/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      }),
      clientAddress: `198.51.100.${n}`
    } as never);
    return { status: res.status, text: await res.text() };
  };

  const cases: Array<[string, { POST: unknown }, string]> = [
    ["poll", pollRoute, "worker-poll.response"],
    ["heartbeat", heartbeatRoute, "worker-heartbeat.response"],
    ["result", resultRoute, "worker-result.response"],
    ["enroll", enrollRoute, "worker-enrollment.response"]
  ];
  // Unauthenticated inputs: none reaches the database, all must still answer
  // with a contract-shaped neutral body rather than an ad hoc shape.
  const bodies = [
    "not json at all",
    "{}",
    JSON.stringify({
      tenant_id: "11111111-1111-4111-8111-111111111111",
      server_id: "srv-1",
      worker_id: "worker_1"
    })
  ];

  for (const [name, route, schema] of cases) {
    test(`${name}: every HTTP 200 body validates against ${schema}`, async () => {
      let validated = 0;
      let n = 10;
      for (const body of bodies) {
        const { status, text } = await call(route, name, body, n++);
        if (status !== 200) continue;
        expect(
          await validateOmesContractText(schema, text),
          `${name} answered ${text}`
        ).toEqual([]);
        validated++;
      }
      // Non-vacuous: at least one input produced a validated 200 body.
      expect(validated).toBeGreaterThan(0);
    });
  }

  test("MUTATION: a response with a renamed field is caught by the same validator", async () => {
    const { text } = await call(heartbeatRoute, "heartbeat", "{}", 99);
    const renamed = text.replace("received_at", "receivedAt");
    expect(renamed).not.toBe(text);
    expect(
      (await validateOmesContractText("worker-heartbeat.response", renamed))
        .length
    ).toBeGreaterThan(0);
  });
});
