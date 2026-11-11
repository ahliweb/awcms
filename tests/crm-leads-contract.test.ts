/**
 * Pure contract tests for `crm_leads` (Issue #1166, ADR-0153). No database.
 *
 *   T-L1  no product vocabulary (program, cohort, re-registration) in the
 *         module's schema, seeds, code or fixtures;
 *         every permission the descriptor declares is seeded by sql/343 and
 *         nothing more;
 *         every event type is registered, declared in AsyncAPI and in the
 *         descriptor, with identical literals;
 *         validation is closed and never echoes a value; guard evaluation and
 *         the definition hash are deterministic.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";
import { crmLeadsModule } from "../src/modules/crm-leads/module";
import {
  CRM_LEADS_EVENT_TYPES,
  CRM_LEADS_EVENT_VERSION
} from "../src/modules/crm-leads/domain/crm-leads-constants";
import {
  decodeLeadCursor,
  encodeLeadCursor,
  parseIfMatchVersion,
  validateConversion,
  validateCreateLead,
  validateCreatePipeline,
  validateListLeadsQuery,
  validatePublishRevision
} from "../src/modules/crm-leads/domain/crm-leads-validation";
import {
  definitionHash,
  unmetGuards
} from "../src/modules/crm-leads/domain/pipeline-rules";

const ROOT = join(import.meta.dir, "..");

function filesUnder(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }

  return out;
}

const DEFINITION = {
  initialStageKey: "new",
  stages: [
    { key: "new", name: "New", category: "new" },
    { key: "won", name: "Won", category: "converted" }
  ],
  transitions: [{ from: "new", to: "won", guards: ["owner_assigned"] }]
};

describe("crm_leads contract (Issue #1166)", () => {
  test("T-L1: no product vocabulary in schema, seeds, code or fixtures", () => {
    const sources = [
      ...["342", "343", "344"]
        .map((n) =>
          readdirSync(join(ROOT, "sql"))
            .filter((f) => f.startsWith(`${n}_`))
            .map((f) => join(ROOT, "sql", f))
        )
        .flat(),
      ...filesUnder(join(ROOT, "src/modules/crm-leads")).filter(
        (f) => !f.endsWith(".md")
      ),
      ...filesUnder(join(ROOT, "src/pages/api/v1/crm-leads")),
      join(ROOT, "tests/integration/crm-leads-api.integration.test.ts")
    ];

    expect(sources.length).toBeGreaterThan(10);

    for (const file of sources) {
      const text = readFileSync(file, "utf8").toLowerCase();
      // Allowed only inside the comments that STATE the rule.
      const code = text
        .split("\n")
        .filter((line) => !/^\s*(--|\*|\/\/|\/\*\*)/.test(line))
        .join("\n");

      for (const word of [
        "angkatan",
        "daftar_ulang",
        "daftar ulang",
        "re_registration",
        "reregistration",
        "cohort",
        "program_id",
        "program_code"
      ]) {
        expect({ file, word, found: code.includes(word) }).toEqual({
          file,
          word,
          found: false
        });
      }
    }
  });

  test("every declared permission is seeded by sql/343, and nothing else is", () => {
    const seed = readFileSync(
      join(ROOT, "sql/343_awcms_crm_leads_permissions.sql"),
      "utf8"
    );
    const seeded = [
      ...seed.matchAll(/\('crm_leads', '([a-z_]+)', '([a-z_]+)',/g)
    ].map((m) => `${m[1]}.${m[2]}`);
    const declared = (crmLeadsModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );

    expect(seeded.sort()).toEqual(declared.sort());
  });

  test("event types: registered, declared by the descriptor and in AsyncAPI", () => {
    const asyncapi = readFileSync(
      join(ROOT, "asyncapi/awcms-domain-events.asyncapi.yaml"),
      "utf8"
    );

    expect([...(crmLeadsModule.events?.publishes ?? [])].sort()).toEqual(
      [...CRM_LEADS_EVENT_TYPES].sort()
    );

    for (const eventType of CRM_LEADS_EVENT_TYPES) {
      expect(
        DOMAIN_EVENT_TYPE_REGISTRY.some(
          (entry) =>
            entry.eventType === eventType &&
            entry.eventVersion === CRM_LEADS_EVENT_VERSION
        )
      ).toBe(true);
      expect(asyncapi).toContain(`  ${eventType}:\n    address: ${eventType}`);
    }
  });

  test("pipeline validation is closed and refuses a converted initial stage", () => {
    expect(
      validateCreatePipeline({
        code: "sales",
        name: "S",
        definition: DEFINITION
      }).valid
    ).toBe(true);
    expect(
      validateCreatePipeline({
        code: "sales",
        name: "S",
        definition: DEFINITION,
        extra: 1
      }).valid
    ).toBe(false);
    expect(
      validateCreatePipeline({
        code: "sales",
        name: "S",
        definition: { ...DEFINITION, initialStageKey: "won" }
      }).valid
    ).toBe(false);
    expect(
      validateCreatePipeline({
        code: "sales",
        name: "S",
        definition: {
          ...DEFINITION,
          transitions: [{ from: "new", to: "won", guards: ["run_script"] }]
        }
      }).valid
    ).toBe(false);
    expect(
      validateCreatePipeline({
        code: "sales",
        name: "S",
        timeZone: "Mars/Olympus",
        definition: DEFINITION
      }).valid
    ).toBe(false);
    expect(
      validatePublishRevision({
        expectedVersion: 1,
        definition: DEFINITION,
        stageMigrations: { old: "won" }
      }).valid
    ).toBe(false);
  });

  test("lead validation never echoes a value and requires a source key for import/api", () => {
    const secret = "not-an-email-secret-value";
    const bad = validateCreateLead({
      pipelineId: crypto.randomUUID(),
      contactPoints: [{ kind: "email", value: secret }],
      source: { kind: "manual" }
    });

    expect(bad.valid).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(secret);
    expect(
      validateCreateLead({
        pipelineId: crypto.randomUUID(),
        source: { kind: "api" }
      }).valid
    ).toBe(false);
    expect(
      validateCreateLead({
        pipelineId: crypto.randomUUID(),
        source: { kind: "website_form", externalEventId: "x1" }
      }).valid
    ).toBe(false);
    expect(
      validateConversion({
        mode: "authority_unconfirmed",
        expectedVersion: 1,
        evidenceRef: "e1"
      }).valid
    ).toBe(false);
  });

  test("guards and definition hash are deterministic", () => {
    expect(
      unmetGuards(["owner_assigned", "reason_required"], {
        ownerAssigned: false,
        liveContactPoints: 0,
        reasonGiven: true
      })
    ).toEqual(["owner_assigned"]);

    const parsed = validateCreatePipeline({
      code: "sales",
      name: "S",
      definition: DEFINITION
    });
    if (!parsed.valid) throw new Error("fixture");
    expect(definitionHash(parsed.value.definition)).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionHash(parsed.value.definition)).toBe(
      definitionHash(structuredClone(parsed.value.definition))
    );
  });

  test("cursor, If-Match and list query parsing", () => {
    const cursor = {
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID()
    };
    expect(decodeLeadCursor(encodeLeadCursor(cursor))).toEqual(cursor);
    expect(decodeLeadCursor("garbage")).toBeNull();
    expect(parseIfMatchVersion('"3"')).toBe(3);
    expect(parseIfMatchVersion("abc")).toBeNull();
    expect(validateListLeadsQuery(new URLSearchParams("limit=0")).valid).toBe(
      false
    );
    expect(validateListLeadsQuery(new URLSearchParams("evil=1")).valid).toBe(
      false
    );
  });
});
