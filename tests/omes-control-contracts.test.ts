/**
 * Issue ahliweb/omes#197 (parent #195, ADR-0122) — pinned OMES v1 contract
 * consumption: every vendored fixture validates the way OMES's own
 * `scripts/check-contracts.py` / `lib/omes/py/jobs/schema.py` says it
 * should, the fail-closed keyword policy rejects anything outside the
 * supported subset, unknown contract versions/names are rejected, the
 * raw-secret scanner runs independently of schema validation, and contract
 * drift is caught.
 *
 * No network access; every fixture read here comes from the vendored
 * snapshot committed at `src/modules/omes-control/contracts/v1/**`.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertOmesContract,
  getOmesStateMachine,
  OMES_CONTRACT_PIN,
  OMES_CONTRACT_VERSION,
  scanForRawSecrets,
  validateOmesContract,
  validateOmesContractText
} from "../src/modules/omes-control/domain/contracts";
import { UnknownOmesContractError, UnsupportedContractVersionError } from "../src/modules/omes-control/domain/contracts/loader";
import { ContractValidationError, SchemaError, validateSchema } from "../src/modules/omes-control/domain/contracts/schema";
import { TransitionError } from "../src/modules/omes-control/domain/contracts/state-machine";
import {
  listEventSchemaNames,
  listFixtureFiles,
  loadFixture,
  loadFixtureReason,
  listTopLevelSchemaNames
} from "../src/modules/omes-control/domain/contracts/loader";
import {
  checkContractsDrift,
  hashVendoredFiles,
  VENDORED_CONTRACTS_DIR
} from "../scripts/sync-omes-contracts";

describe("vendored OMES v1 contract fixtures (fail-closed)", () => {
  test("every schema has at least one valid and one invalid fixture", async () => {
    const topLevel = await listTopLevelSchemaNames();
    const events = await listEventSchemaNames();
    expect(topLevel.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);

    for (const schemaName of [...topLevel, ...events]) {
      const files = await listFixtureFiles(schemaName);
      const valid = files.filter((f) => f.startsWith("valid"));
      const invalid = files.filter((f) => f.startsWith("invalid"));
      expect(valid.length, `${schemaName} has no valid-*.json fixture`).toBeGreaterThan(0);
      expect(invalid.length, `${schemaName} has no invalid-*.json fixture`).toBeGreaterThan(0);
    }
  });

  test("every valid-*.json fixture passes", async () => {
    const topLevel = await listTopLevelSchemaNames();
    const events = await listEventSchemaNames();
    for (const schemaName of [...topLevel, ...events]) {
      const files = (await listFixtureFiles(schemaName)).filter((f) => f.startsWith("valid"));
      for (const file of files) {
        const { value, floatLiteralPaths } = await loadFixture(schemaName, file);
        const errors = await validateOmesContract(schemaName, value, { floatLiteralPaths });
        expect(errors, `${schemaName}/${file} expected VALID, got: ${errors.join("; ")}`).toEqual([]);
      }
    }
  });

  test("every invalid-*.json fixture fails, for its intended reason class when recorded", async () => {
    const topLevel = await listTopLevelSchemaNames();
    const events = await listEventSchemaNames();
    let invalidFixtureCount = 0;

    for (const schemaName of [...topLevel, ...events]) {
      const files = (await listFixtureFiles(schemaName)).filter((f) => f.startsWith("invalid"));
      for (const file of files) {
        invalidFixtureCount++;
        const { value, floatLiteralPaths } = await loadFixture(schemaName, file);
        const errors = await validateOmesContract(schemaName, value, { floatLiteralPaths });
        expect(errors.length, `${schemaName}/${file} expected INVALID, but it validated`).toBeGreaterThan(0);

        const expectedReasonSubstring = await loadFixtureReason(schemaName, file);
        if (expectedReasonSubstring) {
          const joined = errors.join("; ");
          expect(
            joined.includes(expectedReasonSubstring),
            `${schemaName}/${file} failed, but not for the expected reason (expected substring ${JSON.stringify(expectedReasonSubstring)} in: ${joined})`
          ).toBe(true);
        }
      }
    }

    // Sanity: this suite actually walked a meaningful number of fixtures,
    // not zero because listTopLevelSchemaNames()/listEventSchemaNames()
    // silently returned nothing.
    expect(invalidFixtureCount).toBeGreaterThan(50);
  });
});

describe("fail-closed keyword policy", () => {
  test("an unsupported JSON Schema keyword ($ref) makes the schema itself fail to load", () => {
    expect(() =>
      validateSchema({
        type: "object",
        properties: { id: { $ref: "#/definitions/id" } }
      })
    ).toThrow(SchemaError);
  });

  test("format, allOf, not, uniqueItems, if/then are all rejected, not silently ignored", () => {
    for (const keyword of ["format", "allOf", "not", "uniqueItems", "if", "patternProperties"]) {
      expect(() => validateSchema({ type: "string", [keyword]: true })).toThrow(SchemaError);
    }
  });

  test("assertOmesContract throws ContractValidationError (fail closed, not a swallowed boolean) on an invalid payload", async () => {
    await expect(
      assertOmesContract("currency", { code: "usd" } as never)
    ).rejects.toThrow(ContractValidationError);
  });

  test("validateOmesContractText rejects a float-literal number under an integer field, matching OMES's Python validator", async () => {
    // invoice-line.schema.json requires price_snapshot.unit_amount_minor: integer.
    // Once JS's JSON.parse has already run, `19.0` and `19` are indistinguishable
    // (see json-parse.ts) — so this must go through the raw-TEXT entry point to
    // see the decimal point the way OMES's Python `json.load` does.
    const rawText = JSON.stringify({
      line_id: "line-01",
      description: "test",
      quantity: 1,
      price_snapshot: {
        price_id: "price-01",
        catalog_version_id: "version-01",
        currency: "USD",
        unit_amount_minor: 19.5 // not integer-valued either way, but proves the path
      }
    });
    const errors = await validateOmesContractText("invoice-line", rawText);
    expect(errors.some((e) => e.includes("expected type 'integer'"))).toBe(true);

    // The float-vs-integer-looking case (19.0) is only distinguishable with
    // raw text, since 19.0 and 19 parse to the identical JS number 19.
    const rawTextWholeFloat = '{"line_id":"line-02","description":"t","quantity":1,"price_snapshot":{"price_id":"p","catalog_version_id":"v","currency":"USD","unit_amount_minor":19.0}}';
    const wholeFloatErrors = await validateOmesContractText("invoice-line", rawTextWholeFloat);
    expect(wholeFloatErrors.some((e) => e.includes("expected type 'integer'"))).toBe(true);
  });
});

describe("unknown/unsupported contract identity is rejected", () => {
  test("an unknown schema name is rejected", async () => {
    await expect(validateOmesContract("not-a-real-schema", {})).rejects.toThrow(
      UnknownOmesContractError
    );
  });

  test("an unsupported contract version is rejected before any file is loaded", async () => {
    await expect(
      validateOmesContract("currency", {}, { version: "v2" })
    ).rejects.toThrow(UnsupportedContractVersionError);
    await expect(
      getOmesStateMachine("subscription", { version: "v99" })
    ).rejects.toThrow(UnsupportedContractVersionError);
  });

  test("OMES_CONTRACT_PIN resolves to the pinned v1 manifest", async () => {
    const pin = await OMES_CONTRACT_PIN;
    expect(pin.version).toBe(OMES_CONTRACT_VERSION);
    expect(pin.sourceRepo).toBe("ahliweb/omes");
    expect(pin.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(pin.files).length).toBeGreaterThan(50);
  });
});

describe("independent raw-secret scanner", () => {
  test("catches a secret-shaped field value even when no schema is involved", () => {
    // Built at runtime, never as a literal, so gitleaks never sees a
    // secret-shaped token in source: this is a well-known PUBLIC prefix
    // format (Stripe test-mode), not a real credential.
    const fakeStripeKey = ["sk", "test", "4242424242424242424242424242"].join("_");
    const errors = scanForRawSecrets({
      billing: { api_key: fakeStripeKey }
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  test("catches a raw scalar under a secret-like field name even if the field is nested deep and not secret-shaped text", () => {
    const errors = scanForRawSecrets({
      worker: { enrollment: { credential: "just-some-plain-string-value" } }
    });
    expect(errors.some((e) => e.includes("secret pattern"))).toBe(true);
  });

  test("allows a well-formed secret_ref object and null under a secret-like key", () => {
    const errors = scanForRawSecrets({
      token: { store: "vault", key: "omes/worker/1" },
      password: null
    });
    expect(errors).toEqual([]);
  });

  test("allows a list of secret NAMES under a secret-like key (reference, not value)", () => {
    const errors = scanForRawSecrets({ secrets: ["provider-primary", "provider-backup"] });
    expect(errors).toEqual([]);
  });

  test("still catches secrets even when the schema would otherwise accept the payload (independent of schema result)", async () => {
    // currency.schema.json has additionalProperties:false and no secret-like
    // property name — a hand-built payload that matches the schema shape
    // but smuggles a bearer token in a field name the schema doesn't even
    // declare would be caught by additionalProperties, but the secret
    // scanner is the second, INDEPENDENT gate: prove it also fires on its
    // own by calling it directly on a payload shaped for a permissive
    // (additionalProperties: true, implicit) schema.
    const fakeBearer = ["Bearer", "abcdefghijklmnopqrstuvwxyz0123456789"].join(" ");
    const payload = { notes: `see ${fakeBearer} in the logs` };
    const scannerErrors = scanForRawSecrets(payload);
    expect(scannerErrors.length).toBeGreaterThan(0);
  });
});

describe("state machines loaded as data from the pinned contract", () => {
  test("subscription state machine matches the vendored subscription.states.json transition table", async () => {
    const machine = await getOmesStateMachine("subscription");
    expect(machine.states.has("active")).toBe(true);
    expect(machine.isValidTransition("trialing", "active")).toBe(true);
    expect(machine.isValidTransition("cancelled", "active")).toBe(false);
    expect(machine.isValidTransition("active", "active")).toBe(true); // no-op replay is always allowed
    expect(machine.isTerminal("expired")).toBe(true);
    expect(() => machine.assertTransition("expired", "active")).toThrow(TransitionError);
  });

  test("invoice state machine loads from the vendored invoice.states.json", async () => {
    const machine = await getOmesStateMachine("invoice");
    expect(machine.states.size).toBeGreaterThan(0);
  });

  test("an unknown state machine name is rejected", async () => {
    await expect(getOmesStateMachine("not-a-real-state-machine")).rejects.toThrow(
      UnknownOmesContractError
    );
  });
});

describe("contracts:omes:sync drift/pin gate", () => {
  test("checkContractsDrift passes on the committed vendored snapshot", () => {
    const failures = checkContractsDrift(process.cwd());
    expect(failures).toEqual([]);
  });

  test("detects a tampered vendored file against the PIN manifest (uses a disposable temp copy, never the real vendored dir)", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "omes-contracts-drift-"));
    try {
      const realVendoredDir = path.join(process.cwd(), VENDORED_CONTRACTS_DIR);
      const tmpTargetDir = path.join(tmpDir, "contracts-copy");
      cpSync(realVendoredDir, tmpTargetDir, { recursive: true });

      // Clean baseline: no drift.
      const clean = checkContractsDrift(tmpDir, tmpTargetDir);
      expect(clean).toEqual([]);

      // Tamper one vendored file's bytes.
      const tamperedFile = path.join(tmpTargetDir, "currency.schema.json");
      writeFileSync(tamperedFile, '{"tampered": true}');

      const dirty = checkContractsDrift(tmpDir, tmpTargetDir);
      expect(dirty.length).toBeGreaterThan(0);
      expect(
        dirty.some((f) => f.includes("currency.schema.json") && f.includes("SHA-256"))
      ).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("detects a pin/version mismatch", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "omes-contracts-pin-mismatch-"));
    try {
      const realVendoredDir = path.join(process.cwd(), VENDORED_CONTRACTS_DIR);
      const tmpTargetDir = path.join(tmpDir, "contracts-copy");
      cpSync(realVendoredDir, tmpTargetDir, { recursive: true });

      const pinPath = path.join(tmpTargetDir, "PIN.json");
      const pin = JSON.parse(readFileSync(pinPath, "utf8"));
      pin.version = "v2";
      writeFileSync(pinPath, JSON.stringify(pin, null, 2));

      const failures = checkContractsDrift(tmpDir, tmpTargetDir);
      expect(failures.some((f) => f.includes("only supports v1"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("hashVendoredFiles is deterministic (same directory hashes the same twice)", () => {
    const realVendoredDir = path.join(process.cwd(), VENDORED_CONTRACTS_DIR);
    const a = hashVendoredFiles(realVendoredDir);
    const b = hashVendoredFiles(realVendoredDir);
    expect(a).toEqual(b);
  });
});
