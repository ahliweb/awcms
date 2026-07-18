/**
 * Response-vs-schema contract test (Issue #182, epic #177) for a directory
 * endpoint most prone to drift: the office directory (`GET /api/v1/offices`,
 * `listOffices`). Seeds real rows in a throwaway PostgreSQL tenant, then
 * validates the JSON-serialized response payload (exactly what the route's
 * `ok({ items, nextCursor })` emits) against the `Office` schema in the BUNDLED
 * OpenAPI contract. If the DTO and the published schema drift apart — a field
 * renamed/dropped, or a type changed on either side — this test fails.
 *
 * Gated on `DATABASE_URL` (skips cleanly where there is no database), same
 * convention as `office-directory-postgres.test.ts`. `OFFICE_TEST_DATABASE_URL`
 * overrides for a local scratch run. Never hard-codes a connection string.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { listOffices } from "../src/modules/tenant-admin/application/office-directory";

const DATABASE_URL =
  process.env.OFFICE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

type JsonSchema = {
  type?: string;
  format?: string;
  nullable?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
};

function loadOfficeSchema(): JsonSchema {
  const raw = readFileSync(
    path.join(process.cwd(), "openapi/awcms-public-api.openapi.yaml"),
    "utf8"
  );
  const doc = parseYaml(raw) as {
    components: { schemas: Record<string, JsonSchema> };
  };
  return doc.components.schemas.Office!;
}

/** Minimal structural validation: every declared property is present and the
 * right primitive type (nullable respected). Returns a list of violations. */
function validateAgainst(
  value: unknown,
  schema: JsonSchema,
  pathLabel: string
): string[] {
  const problems: string[] = [];
  const props = schema.properties ?? {};
  const record = value as Record<string, unknown>;

  for (const [key, propSchema] of Object.entries(props)) {
    const at = `${pathLabel}.${key}`;
    if (!(key in record)) {
      problems.push(`${at}: missing property declared in the Office schema.`);
      continue;
    }
    const v = record[key];
    if (v === null) {
      if (!propSchema.nullable) {
        problems.push(`${at}: null but schema is not nullable.`);
      }
      continue;
    }
    const expected = propSchema.type;
    const actual = typeof v;
    if (expected === "string" && actual !== "string") {
      problems.push(`${at}: expected string, got ${actual}.`);
    } else if (
      (expected === "integer" || expected === "number") &&
      actual !== "number"
    ) {
      problems.push(`${at}: expected number, got ${actual}.`);
    } else if (expected === "boolean" && actual !== "boolean") {
      problems.push(`${at}: expected boolean, got ${actual}.`);
    }
    if (propSchema.format === "date-time" && typeof v === "string") {
      if (Number.isNaN(Date.parse(v))) {
        problems.push(`${at}: not a parseable date-time string.`);
      }
    }
  }

  return problems;
}

describeOrSkip(
  "office directory response matches the bundled Office schema",
  () => {
    let sql: Bun.SQL;
    const createdTenantIds: string[] = [];
    const officeSchema = loadOfficeSchema();

    beforeAll(() => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 5 });
    });

    afterAll(async () => {
      for (const tenantId of createdTenantIds) {
        await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
        await sql`DELETE FROM awcms_offices WHERE tenant_id = ${tenantId}`;
        await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
      }
      await sql.close({ timeout: 5 });
    });

    async function createTenant(): Promise<string> {
      const suffix = Math.random().toString(36).slice(2, 10);
      const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`resp-schema-${suffix}`}, ${"Response schema test"})
      RETURNING id
    `) as { id: string }[];
      const tenantId = rows[0]!.id;
      createdTenantIds.push(tenantId);
      return tenantId;
    }

    test("every serialized office item conforms to the Office schema", async () => {
      const tenantId = await createTenant();

      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`
      INSERT INTO awcms_offices (tenant_id, office_code, office_name, office_type)
      VALUES
        (${tenantId}, ${"HQ"}, ${"Head Office"}, ${"head_office"}),
        (${tenantId}, ${"BR-1"}, ${"Branch 1"}, ${"branch"})
    `;

      const page = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return listOffices(tx as unknown as Bun.SQL, tenantId);
      });

      // Round-trip through JSON exactly as the route's `ok({ items, nextCursor })`
      // does — Date fields become ISO strings, matching the schema's
      // `format: date-time` string type.
      const serialized = JSON.parse(JSON.stringify(page)) as {
        items: unknown[];
        nextCursor: string | null;
      };

      expect(serialized.items.length).toBe(2);

      const violations: string[] = [];
      serialized.items.forEach((item, index) => {
        violations.push(
          ...validateAgainst(item, officeSchema, `items[${index}]`)
        );
      });

      if (violations.length > 0) {
        throw new Error(
          `Office response drifted from the bundled schema:\n${violations.join("\n")}`
        );
      }
    });
  }
);
