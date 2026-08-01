/**
 * The selection rule behind `identity-access:permissions:backfill`.
 *
 * The dangerous direction is not "misses a permission" — that is the status quo
 * and an operator sees the 403. It is "grants one that was removed on purpose",
 * because nobody sees that at all. Every case below exists to pin that edge.
 */
import { describe, expect, test } from "bun:test";

import {
  selectBackfillablePermissions,
  type CatalogPermissionRecord
} from "../src/modules/identity-access/domain/owner-permission-backfill";

const ROLE_CREATED = new Date("2026-06-01T00:00:00.000Z");
const role = { roleId: "role-1", createdAt: ROLE_CREATED };

function permission(
  id: string,
  key: string,
  createdAt: string
): CatalogPermissionRecord {
  return { id, key, createdAt: new Date(createdAt) };
}

const OLDER = permission(
  "p-old",
  "blog_content.posts.read",
  "2026-05-01T00:00:00.000Z"
);
const NEWER = permission(
  "p-new",
  "identity_access.machine_credentials.create",
  "2026-08-01T00:00:00.000Z"
);
const SAME_INSTANT = permission(
  "p-same",
  "theming.themes.read",
  ROLE_CREATED.toISOString()
);

describe("selectBackfillablePermissions", () => {
  test("grants a permission created after the role", () => {
    const result = selectBackfillablePermissions(role, [NEWER], new Set());

    expect(result.grant.map((p) => p.key)).toEqual([NEWER.key]);
    expect(result.skippedAsDeliberate).toEqual([]);
  });

  // The whole point. An admin who removed `blog_content.posts.read` from owner
  // must not get it back from a maintenance command.
  test("NEVER grants a missing permission older than the role", () => {
    const result = selectBackfillablePermissions(role, [OLDER], new Set());

    expect(result.grant).toEqual([]);
    expect(result.skippedAsDeliberate.map((p) => p.key)).toEqual([OLDER.key]);
  });

  // Bootstrap seeds role and permissions in ONE transaction, so a permission
  // stamped at the role's own instant WAS part of the original seed. `>=` would
  // re-grant a deliberate removal on exactly the tenant created by that
  // migration — the tenant most likely to have been curated by hand.
  test("a permission created in the same instant as the role is treated as original", () => {
    const result = selectBackfillablePermissions(
      role,
      [SAME_INSTANT],
      new Set()
    );

    expect(result.grant).toEqual([]);
    expect(result.skippedAsDeliberate.map((p) => p.key)).toEqual([
      SAME_INSTANT.key
    ]);
  });

  test("already-granted permissions are neither granted nor reported", () => {
    const result = selectBackfillablePermissions(
      role,
      [OLDER, NEWER],
      new Set([OLDER.id, NEWER.id])
    );

    expect(result.grant).toEqual([]);
    expect(result.skippedAsDeliberate).toEqual([]);
  });

  test("mixed catalog splits into the two buckets", () => {
    const result = selectBackfillablePermissions(
      role,
      [OLDER, SAME_INSTANT, NEWER],
      new Set()
    );

    expect(result.grant.map((p) => p.key)).toEqual([NEWER.key]);
    expect(result.skippedAsDeliberate.map((p) => p.key)).toEqual([
      OLDER.key,
      SAME_INSTANT.key
    ]);
  });

  test("an empty catalog is a complete, valid state", () => {
    const result = selectBackfillablePermissions(role, [], new Set());

    expect(result.grant).toEqual([]);
    expect(result.skippedAsDeliberate).toEqual([]);
  });
});
