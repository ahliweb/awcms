/**
 * PROJECT_STATE §4 **C6** — `/admin/roles` awaited `listRolePermissions` once
 * per role.
 *
 * Sequential, because concurrent queries on one transaction connection leak
 * it: a tenant with 40 roles paid 40 round trips, summed rather than
 * overlapped, to render one screen. `listRolePermissionsForRoles` answers the
 * whole set in one.
 *
 * These are unit-level proofs against a fake `tx` — the point is the SHAPE of
 * the access (one query, every id answered, list bound as an array), which is
 * exactly what a real-database test cannot show you without counting round
 * trips. The rows themselves are covered by the screen's own integration
 * coverage.
 */
import { describe, expect, test } from "bun:test";

import { listRolePermissionsForRoles } from "../src/modules/identity-access/application/role-admin";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ROLE_A = "22222222-2222-4222-8222-222222222222";
const ROLE_B = "33333333-3333-4333-8333-333333333333";
const ROLE_C = "44444444-4444-4444-8444-444444444444";

type Capture = { text: string; values: unknown[] };

type PermissionRow = {
  role_id: string;
  id: string;
  module_key: string;
  activity_code: string;
  action: string;
  description: string | null;
};

function permissionRow(roleId: string, id: string): PermissionRow {
  return {
    role_id: roleId,
    id,
    module_key: "identity_access",
    activity_code: "access_control",
    action: "read",
    description: null
  };
}

/**
 * A `tx` that records each tagged-template call and answers with `rows`.
 * `array` returns a marker rather than the bare list so a test can tell the
 * two bindings apart: a bare `${ids}` reaches PostgreSQL as comma-joined TEXT
 * and fails with 22P02, which is a defect this repo has hit before.
 */
function recordingTx(rows: PermissionRow[], captured: Capture[]): Bun.SQL {
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  (
    tx as unknown as { array: (value: unknown[], type: string) => unknown }
  ).array = (value: unknown[], type: string) => ({ boundArray: value, type });

  return tx;
}

/** A `tx` that throws the moment it is used — proves no query was issued. */
const THROWING_TX = ((..._args: unknown[]) => {
  throw new Error("the database must not be queried for an empty role list");
}) as unknown as Bun.SQL;

describe("listRolePermissionsForRoles", () => {
  test("issues ONE query for the whole set of roles", async () => {
    const captured: Capture[] = [];
    const tx = recordingTx(
      [permissionRow(ROLE_A, "perm-1"), permissionRow(ROLE_B, "perm-2")],
      captured
    );

    await listRolePermissionsForRoles(tx, TENANT_ID, [ROLE_A, ROLE_B, ROLE_C]);

    expect(captured).toHaveLength(1);
  });

  test("answers every requested role, including the ones with no grants", async () => {
    const captured: Capture[] = [];
    const tx = recordingTx([permissionRow(ROLE_A, "perm-1")], captured);

    const result = await listRolePermissionsForRoles(tx, TENANT_ID, [
      ROLE_A,
      ROLE_B,
      ROLE_C
    ]);

    // A caller that had to tell "no grants" from "not in the result" would be
    // back to asking per role.
    expect([...result.keys()].sort()).toEqual([ROLE_A, ROLE_B, ROLE_C].sort());
    expect(result.get(ROLE_B)).toEqual([]);
    expect(result.get(ROLE_C)).toEqual([]);
  });

  test("groups rows under the role that holds them", async () => {
    const captured: Capture[] = [];
    const tx = recordingTx(
      [
        permissionRow(ROLE_A, "perm-1"),
        permissionRow(ROLE_A, "perm-2"),
        permissionRow(ROLE_B, "perm-3")
      ],
      captured
    );

    const result = await listRolePermissionsForRoles(tx, TENANT_ID, [
      ROLE_A,
      ROLE_B
    ]);

    expect(result.get(ROLE_A)?.map((p) => p.id)).toEqual(["perm-1", "perm-2"]);
    expect(result.get(ROLE_B)?.map((p) => p.id)).toEqual(["perm-3"]);
  });

  test("binds the ids as a uuid array, and scopes the read to the tenant", async () => {
    const captured: Capture[] = [];
    const tx = recordingTx([], captured);

    await listRolePermissionsForRoles(tx, TENANT_ID, [ROLE_A, ROLE_B]);

    const query = captured[0]!;
    expect(query.text).toContain("= ANY(");
    expect(query.values).toContainEqual({
      boundArray: [ROLE_A, ROLE_B],
      type: "uuid"
    });
    expect(query.values).toContain(TENANT_ID);
  });

  test("does not query at all when there are no roles", async () => {
    const result = await listRolePermissionsForRoles(
      THROWING_TX,
      TENANT_ID,
      []
    );

    expect(result.size).toBe(0);
  });

  test("a repeated id is asked for once", async () => {
    const captured: Capture[] = [];
    const tx = recordingTx([], captured);

    await listRolePermissionsForRoles(tx, TENANT_ID, [ROLE_A, ROLE_A, ROLE_B]);

    expect(captured[0]!.values).toContainEqual({
      boundArray: [ROLE_A, ROLE_B],
      type: "uuid"
    });
  });
});
