import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { mediaLibraryModule } from "../src/modules/media-library/module";
import {
  MEDIA_PERMISSION_ACTIVITY_CODE,
  MEDIA_PERMISSIONS,
  MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE,
  MEDIA_ENFORCEMENT_PERMISSIONS
} from "../src/modules/media-library/domain/media-permissions";

const REVOKE_MIGRATION =
  "sql/087_awcms_media_library_revoke_attach_detach_permissions.sql";

/** The two ADR-0056 §A revoked, kept as literals so re-adding either is loud. */
const REVOKED_ACTIONS = ["attach", "detach"] as const;

describe("MEDIA_PERMISSIONS", () => {
  test("declares one key per required media lifecycle action (including cancel, added by Issue #634 for aborting a not-yet-uploaded session)", () => {
    expect(Object.keys(MEDIA_PERMISSIONS).sort()).toEqual(
      [
        "cancel",
        "create",
        "delete",
        "purge",
        "read",
        "restore",
        // Issue #615 — the eighth, for the usage-rights metadata `sql/137`
        // adds. Its endpoint (`PATCH /api/v1/media/objects/{id}`) landed in the
        // same change, which is the rule this file's own header states.
        "update",
        "verify"
      ].sort()
    );
  });

  test("every media permission key follows the media_library.media.<action> shape (ADR-0036 ownership inversion — was news_portal.media.*)", () => {
    for (const value of Object.values(MEDIA_PERMISSIONS)) {
      expect(value).toMatch(
        new RegExp(
          `^media_library\\.${MEDIA_PERMISSION_ACTIVITY_CODE}\\.[a-z]+$`
        )
      );
    }
  });

  test("media_library.module.ts declares exactly these 7 media permissions", () => {
    expect(mediaLibraryModule.permissions).toBeDefined();
    const mediaPermissions = mediaLibraryModule.permissions?.filter(
      (permission) => permission.activityCode === MEDIA_PERMISSION_ACTIVITY_CODE
    );
    expect(mediaPermissions?.length).toBe(
      Object.keys(MEDIA_PERMISSIONS).length
    );
  });
});

/**
 * ADR-0056 §A. A revocation is only real when all three halves agree: the
 * constants stop naming it, the descriptor stops declaring it (which is what
 * `module_management`'s registry sync reconciles against), and a migration
 * removes the rows already seeded — including the grants, since deleting the
 * catalog row alone would hit the FK.
 *
 * Each half is asserted separately on purpose. Declaring the key back without
 * a migration, or writing a migration while the descriptor still declares it,
 * are different bugs with the same symptom: `awcms_permissions` and the module
 * registry disagreeing about what this module can authorize.
 */
describe("ADR-0056 §A — attach/detach are revoked, not merely unused", () => {
  test("neither is a permission constant or a declared descriptor permission", () => {
    for (const action of REVOKED_ACTIONS) {
      expect(Object.keys(MEDIA_PERMISSIONS)).not.toContain(action);
      expect(
        mediaLibraryModule.permissions?.some(
          (permission) =>
            permission.activityCode === MEDIA_PERMISSION_ACTIVITY_CODE &&
            permission.action === action
        )
      ).toBe(false);
    }
  });

  test("sql/087 deletes the grants BEFORE the catalog rows", async () => {
    const migration = await readFile(REVOKE_MIGRATION, "utf8");

    const grantsAt = migration.indexOf("DELETE FROM awcms_role_permissions");
    const catalogAt = migration.indexOf("DELETE FROM awcms_permissions");

    expect(grantsAt).toBeGreaterThan(-1);
    expect(catalogAt).toBeGreaterThan(-1);
    // Reversed, the catalog delete hits the `awcms_role_permissions` FK and the
    // whole migration fails on any database that had ever seeded a grant.
    expect(grantsAt).toBeLessThan(catalogAt);

    for (const action of REVOKED_ACTIONS) {
      expect(migration).toContain(`'${action}'`);
    }
  });

  test("no application function is left writing the relation they named", async () => {
    const directory = await readFile(
      "src/modules/media-library/application/media-object-directory.ts",
      "utf8"
    );

    // The two zero-caller functions are gone. Matched on `function <name>` so
    // the file's own explanatory marker (which names them in prose) does not
    // make this pass or fail for the wrong reason.
    expect(directory).not.toContain("function attachNewsMediaObject");
    expect(directory).not.toContain("function detachNewsMediaObject");

    // Nothing writes `status = 'attached'` anymore. The status itself stays
    // readable — `sql/041`'s CHECK still admits it and existing rows still
    // resolve — so this asserts the WRITE is gone, not the value.
    expect(directory).not.toContain("SET status = 'attached'");
  });
});

describe("MEDIA_ENFORCEMENT_PERMISSIONS (ADR-0036 step 5a)", () => {
  test("declares only read + enable — one-way, no disable action ever", () => {
    expect(Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS).sort()).toEqual([
      "enable",
      "read"
    ]);
  });

  test("every enforcement key follows the media_library.enforcement.<action> shape, under a SEPARATE activity code from media", () => {
    expect(MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE).toBe("enforcement");
    expect(MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE).not.toBe(
      MEDIA_PERMISSION_ACTIVITY_CODE
    );
    for (const value of Object.values(MEDIA_ENFORCEMENT_PERMISSIONS)) {
      expect(value).toMatch(
        new RegExp(
          `^media_library\\.${MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE}\\.[a-z]+$`
        )
      );
    }
  });

  test("there is no `disable` enforcement permission (one-way by construction)", () => {
    expect(Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS)).not.toContain("disable");
  });

  test("media_library.module.ts declares exactly these 2 enforcement permissions", () => {
    const enforcementPermissions = mediaLibraryModule.permissions?.filter(
      (permission) =>
        permission.activityCode === MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE
    );
    expect(enforcementPermissions?.length).toBe(
      Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS).length
    );
  });
});
