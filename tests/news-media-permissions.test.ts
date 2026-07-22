import { describe, expect, test } from "bun:test";

import { newsPortalModule } from "../src/modules/news-portal/module";
import {
  NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
  NEWS_MEDIA_PERMISSIONS
} from "../src/modules/news-portal/domain/news-media-permissions";

describe("NEWS_MEDIA_PERMISSIONS", () => {
  test("declares one key per required media lifecycle action (including cancel, added by Issue #634 for aborting a not-yet-uploaded session)", () => {
    expect(Object.keys(NEWS_MEDIA_PERMISSIONS).sort()).toEqual(
      [
        "attach",
        "cancel",
        "create",
        "delete",
        "detach",
        "purge",
        "read",
        "restore",
        "verify"
      ].sort()
    );
  });

  test("every permission key follows the news_portal.media.<action> shape", () => {
    for (const value of Object.values(NEWS_MEDIA_PERMISSIONS)) {
      expect(value).toMatch(
        new RegExp(
          `^news_portal\\.${NEWS_MEDIA_PERMISSION_ACTIVITY_CODE}\\.[a-z]+$`
        )
      );
    }
  });

  test("module.ts now declares these as real permissions (Issue #634 added the endpoints that enforce them)", () => {
    // Previously (#633) `permissions` was deliberately left undeclared until
    // a real endpoint existed to enforce them. Issue #634 added the
    // presigned-upload-session endpoints (create/finalize/cancel) — see
    // `tests/modules/news-portal-module.test.ts` for the exhaustive
    // key-by-key match against these exact constants. Issue #637 later
    // added TWO more permissions under a DIFFERENT activityCode
    // (`homepage_sections`) — filtered out here since this test is
    // specifically about the `media` activityCode's own permission count,
    // not the module's total permission count.
    expect(newsPortalModule.permissions).toBeDefined();
    const mediaPermissions = newsPortalModule.permissions?.filter(
      (permission) =>
        permission.activityCode === NEWS_MEDIA_PERMISSION_ACTIVITY_CODE
    );
    expect(mediaPermissions?.length).toBe(
      Object.keys(NEWS_MEDIA_PERMISSIONS).length
    );
  });
});
