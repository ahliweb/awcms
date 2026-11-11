/**
 * The customer Telegram dispatcher holds the channel key ring, so it must hold
 * NO login but its own (Issue #1156, audit H-A of PR #1260): it refuses a shared
 * login in its environment, and `config:validate` refuses a dispatcher URL that
 * reuses the app or worker user.
 */
import { describe, expect, test } from "bun:test";

import {
  assertNoSharedLogins,
  SHARED_LOGIN_ENV_NAMES
} from "../src/lib/database/telegram-engagement-dispatch-client";
import { telegramDispatchLoginProblems } from "../scripts/validate-env";

const DISPATCH =
  "postgres://awcms_telegram_engagement_dispatch:secret@db:5432/awcms";

describe("the dispatcher refuses a shared login in its environment", () => {
  test("names exactly the app, worker and setup logins", () => {
    expect([...SHARED_LOGIN_ENV_NAMES].sort()).toEqual(
      ["DATABASE_URL", "SETUP_DATABASE_URL", "WORKER_DATABASE_URL"].sort()
    );
  });

  test("any one of them present (non-blank) refuses", () => {
    for (const name of SHARED_LOGIN_ENV_NAMES) {
      expect(() =>
        assertNoSharedLogins({
          TELEGRAM_ENGAGEMENT_DATABASE_URL: DISPATCH,
          [name]: "postgres://someone:x@db/awcms"
        })
      ).toThrow(name);
    }
  });

  test("absent or blank passes", () => {
    expect(() =>
      assertNoSharedLogins({
        TELEGRAM_ENGAGEMENT_DATABASE_URL: DISPATCH,
        WORKER_DATABASE_URL: "   "
      })
    ).not.toThrow();
  });
});

describe("config:validate refuses a dispatcher login shared with app or worker", () => {
  test("the same user as DATABASE_URL or WORKER_DATABASE_URL is refused", () => {
    const shared = "postgres://awcms_app:a@db/awcms";

    expect(
      telegramDispatchLoginProblems({
        TELEGRAM_ENGAGEMENT_DATABASE_URL: shared,
        DATABASE_URL: shared
      })
    ).toHaveLength(1);
    expect(
      telegramDispatchLoginProblems({
        TELEGRAM_ENGAGEMENT_DATABASE_URL:
          "postgres://awcms_worker:x@other/awcms",
        WORKER_DATABASE_URL: "postgres://awcms_worker:w@db/awcms"
      })
    ).toHaveLength(1);
  });

  test("its own user passes; a URL without a user is refused", () => {
    expect(
      telegramDispatchLoginProblems({
        TELEGRAM_ENGAGEMENT_DATABASE_URL: DISPATCH,
        DATABASE_URL: "postgres://awcms_app:a@db/awcms",
        WORKER_DATABASE_URL: "postgres://awcms_worker:w@db/awcms"
      })
    ).toEqual([]);
    expect(
      telegramDispatchLoginProblems({
        TELEGRAM_ENGAGEMENT_DATABASE_URL: "postgres://db/awcms"
      })
    ).toHaveLength(1);
  });
});
