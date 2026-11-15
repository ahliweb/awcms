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
 * The `<module>.<activity>.<action>` keys a migration's role-grant statements
 * name. A statement is any `INSERT INTO awcms_role_permissions` up to its
 * terminating `;`. Three spellings are understood, because the repo uses all
 * of them: the column predicate idiom (`p.module_key = 'm' AND
 * p.activity_code = 'a' AND p.action IN ('x', 'y')` or `= 'x'`, as in
 * sql/124), the tuple form (`'m','a','x'`) and the dotted key (`m.a.x`).
 */
function grantedKeys(
  sql: string,
  moduleKey: string,
  activityCode: string
): Set<string> {
  const granted = new Set<string>();
  const prefix = `${moduleKey}.${activityCode}`;

  for (const statement of withoutSqlComments(sql).split(";")) {
    if (!/INSERT\s+INTO\s+awcms_role_permissions/i.test(statement)) continue;
    if (!statement.includes(moduleKey)) continue;

    const predicate = new RegExp(
      `module_key\\s*=\\s*'${moduleKey}'\\s+AND\\s+(?:\\w+\\.)?activity_code\\s*=\\s*'${activityCode}'\\s+AND\\s+(?:\\w+\\.)?action\\s*(?:=\\s*'([^']+)'|IN\\s*\\(([^)]*)\\))`,
      "i"
    ).exec(statement);
    if (predicate) {
      const list = predicate[1] ?? predicate[2] ?? "";
      for (const m of list.matchAll(/'([^']+)'/g))
        granted.add(`${prefix}.${m[1]}`);
      if (predicate[1]) granted.add(`${prefix}.${predicate[1]}`);
    }

    for (const m of statement.matchAll(
      new RegExp(
        `'${moduleKey}'\\s*,\\s*'${activityCode}'\\s*,\\s*'([^']+)'`,
        "g"
      )
    )) {
      granted.add(`${prefix}.${m[1]}`);
    }
    for (const m of statement.matchAll(
      new RegExp(`${moduleKey}\\.${activityCode}\\.(\\w+)`, "g")
    )) {
      granted.add(`${prefix}.${m[1]}`);
    }
  }

  return granted;
}

function grantedMediaActions(sql: string): Set<string> {
  return grantedKeys(sql, "media_library", "media");
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

  test("the detector reads the repo's own grant idiom (column predicates), not just tuples", () => {
    // The real shape every migration uses — taken from sql/124 verbatim, then
    // from a synthetic media variant in both `IN (...)` and `= '...'` spellings.
    const real = readFileSync(
      join(SQL_DIR, "124_awcms_partner_suspension.sql"),
      "utf8"
    );
    expect(
      [...grantedKeys(real, "identity_access", "partner_registry")].sort()
    ).toEqual([
      "identity_access.partner_registry.disable",
      "identity_access.partner_registry.restore"
    ]);

    const predicateCreateOnly = `
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT s.tenant_id, r.id, p.id FROM awcms_setup_state s
      JOIN awcms_permissions p
        ON p.module_key = 'media_library'
       AND p.activity_code = 'media'
       AND p.action IN ('create')
      WHERE s.id = true;`;
    const predicateEquals = predicateCreateOnly.replace(
      "IN ('create')",
      "= 'create'"
    );
    const predicateFull = predicateCreateOnly.replace(
      "IN ('create')",
      "IN ('create', 'verify', 'cancel')"
    );
    expect(
      grantsCreateWithoutCompanions(grantedMediaActions(predicateCreateOnly))
    ).toBe(true);
    expect(
      grantsCreateWithoutCompanions(grantedMediaActions(predicateEquals))
    ).toBe(true);
    expect(
      grantsCreateWithoutCompanions(grantedMediaActions(predicateFull))
    ).toBe(false);
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
