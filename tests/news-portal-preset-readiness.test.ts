import { describe, expect, test } from "bun:test";

import {
  evaluateNewsPortalFullOnlineR2Readiness,
  isKnownNewsPortalProfile,
  NEWS_PORTAL_PROFILES
} from "../src/modules/news-portal/domain/news-portal-preset-readiness";

const FULLY_CONFIGURED_ENV = {
  NEWS_PORTAL_ENABLED: "true",
  NEWS_PORTAL_PROFILE: "full_online_r2",
  NEWS_MEDIA_R2_ENABLED: "true",
  NEWS_MEDIA_R2_ACCOUNT_ID: "acct",
  NEWS_MEDIA_R2_ACCESS_KEY_ID: "news-key",
  NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "news-secret",
  NEWS_MEDIA_R2_BUCKET: "news-media-bucket",
  NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test"
} as NodeJS.ProcessEnv;

describe("isKnownNewsPortalProfile", () => {
  test("accepts the one known profile", () => {
    expect(isKnownNewsPortalProfile("full_online_r2")).toBe(true);
  });

  test("rejects unknown/undefined values", () => {
    expect(isKnownNewsPortalProfile("offline_lan")).toBe(false);
    expect(isKnownNewsPortalProfile(undefined)).toBe(false);
  });

  test("NEWS_PORTAL_PROFILES currently has exactly one value", () => {
    expect(NEWS_PORTAL_PROFILES).toEqual(["full_online_r2"]);
  });
});

describe("evaluateNewsPortalFullOnlineR2Readiness", () => {
  test("ready when every condition holds", () => {
    const result =
      evaluateNewsPortalFullOnlineR2Readiness(FULLY_CONFIGURED_ENV);

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("not ready by default (empty env) — opt-in only, never a default", () => {
    const result = evaluateNewsPortalFullOnlineR2Readiness(
      {} as NodeJS.ProcessEnv
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("news_portal_disabled");
    expect(result.reasons).toContain("profile_not_full_online_r2");
    expect(result.reasons).toContain("news_media_r2_disabled");
  });

  test("fails when NEWS_PORTAL_ENABLED is true but profile is wrong", () => {
    const result = evaluateNewsPortalFullOnlineR2Readiness({
      ...FULLY_CONFIGURED_ENV,
      NEWS_PORTAL_PROFILE: "something_else"
    } as NodeJS.ProcessEnv);

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(["profile_not_full_online_r2"]);
  });

  test("fails when news media R2 is disabled even if everything else is configured", () => {
    const result = evaluateNewsPortalFullOnlineR2Readiness({
      ...FULLY_CONFIGURED_ENV,
      NEWS_MEDIA_R2_ENABLED: "false"
    } as NodeJS.ProcessEnv);

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(["news_media_r2_disabled"]);
  });

  test("fails when a required NEWS_MEDIA_R2_* var is missing", () => {
    const { NEWS_MEDIA_R2_BUCKET, ...rest } = FULLY_CONFIGURED_ENV as Record<
      string,
      string
    >;

    const result = evaluateNewsPortalFullOnlineR2Readiness(
      rest as NodeJS.ProcessEnv
    );

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(["news_media_r2_config_incomplete"]);
    expect(result.detail[0]).toContain("NEWS_MEDIA_R2_BUCKET");
  });

  test("fails when news-media R2 bucket collides with sync-storage's R2_BUCKET (Keputusan kunci #1)", () => {
    const result = evaluateNewsPortalFullOnlineR2Readiness({
      ...FULLY_CONFIGURED_ENV,
      R2_BUCKET: FULLY_CONFIGURED_ENV.NEWS_MEDIA_R2_BUCKET
    } as NodeJS.ProcessEnv);

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "news_media_r2_shares_sync_storage_bucket_or_credentials"
    ]);
  });

  test("fails when news-media R2 access key collides with sync-storage's R2_ACCESS_KEY_ID", () => {
    const result = evaluateNewsPortalFullOnlineR2Readiness({
      ...FULLY_CONFIGURED_ENV,
      R2_ACCESS_KEY_ID: FULLY_CONFIGURED_ENV.NEWS_MEDIA_R2_ACCESS_KEY_ID
    } as NodeJS.ProcessEnv);

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "news_media_r2_shares_sync_storage_bucket_or_credentials"
    ]);
  });
});
