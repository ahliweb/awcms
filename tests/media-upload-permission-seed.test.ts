/**
 * Whoever may START a media upload must also be able to FINISH and CANCEL it.
 *
 * The uploader is three endpoints behind three separate keys —
 * `media_library.media.create` (open the session), `.verify` (finalize) and
 * `.cancel` (clean up after a failure). A role holding `create` alone starts
 * uploads that 403 at finalize, 403 again at cancel, and leave a
 * `pending_upload` row behind (`/admin/media` gates its uploader on all three
 * for that reason).
 *
 * This pins the SEEDED side: no migration grants `create` to a role without the
 * other two, and the owner's blanket grant cannot exclude them unevenly.
 * Custom roles are an administrator's choice and are covered by the screen's
 * partial-grant notice, not by this test.
 *
 * Pure — reads `sql/` and a source constant; no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { OWNER_GRANT_EXCLUDED_PERMISSION_KEYS } from "../src/modules/_shared/owner-grant-exclusions";

const SQL_DIR = "sql";
const CREATE = "media_library.media.create";
const COMPANIONS = ["media_library.media.verify", "media_library.media.cancel"];

/** Strip `--` line comments so prose that names a key cannot count as a grant. */
function withoutSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * The `media_library.media.{create,verify,cancel}` keys a migration's
 * role-grant statements name. A statement is any
 * `INSERT INTO awcms_role_permissions` up to its terminating `;`.
 */
function grantedMediaActions(sql: string): Set<string> {
  const granted = new Set<string>();

  for (const statement of withoutSqlComments(sql).split(";")) {
    if (!/INSERT\s+INTO\s+awcms_role_permissions/i.test(statement)) continue;
    if (!/media_library/.test(statement)) continue;

    for (const action of ["create", "verify", "cancel"]) {
      const named = new RegExp(
        `'media_library'\\s*,\\s*'media'\\s*,\\s*'${action}'|media_library\\.media\\.${action}`
      );
      if (named.test(statement)) granted.add(`media_library.media.${action}`);
    }
  }

  return granted;
}

/** True when `create` is granted without both companions. */
function grantsCreateWithoutCompanions(granted: Set<string>): boolean {
  return granted.has(CREATE) && !COMPANIONS.every((key) => granted.has(key));
}

describe("media upload permissions are seeded as a set", () => {
  test("no migration grants media.create to a role without verify and cancel", () => {
    const offenders: string[] = [];

    for (const file of readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"))) {
      const granted = grantedMediaActions(
        readFileSync(join(SQL_DIR, file), "utf8")
      );
      if (grantsCreateWithoutCompanions(granted)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  test("the detector is not blind: a create-only grant is flagged, a full set is not", () => {
    const createOnly = `
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT t, r, p.id FROM awcms_permissions p
      WHERE (p.module_key, p.activity_code, p.action) IN (('media_library','media','create'));`;
    const fullSet = `
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT t, r, p.id FROM awcms_permissions p
      WHERE (p.module_key, p.activity_code, p.action) IN
        (('media_library','media','create'),('media_library','media','verify'),('media_library','media','cancel'));`;
    const commentOnly = `-- INSERT INTO awcms_role_permissions media_library.media.create\nSELECT 1;`;

    expect(grantsCreateWithoutCompanions(grantedMediaActions(createOnly))).toBe(
      true
    );
    expect(grantsCreateWithoutCompanions(grantedMediaActions(fullSet))).toBe(
      false
    );
    expect(grantedMediaActions(commentOnly).size).toBe(0);
  });

  test("the owner's blanket grant never excludes one of the three alone", () => {
    const excluded = new Set(OWNER_GRANT_EXCLUDED_PERMISSION_KEYS);
    const excludedCount = [CREATE, ...COMPANIONS].filter((key) =>
      excluded.has(key)
    ).length;

    // All three or none: excluding `verify`/`cancel` while `create` stays
    // granted reproduces the stranded-session defect for the owner role.
    expect([0, 3]).toContain(excludedCount);
  });
});
