import { describe, expect, test } from "bun:test";

import { evaluateManagedMediaReadiness } from "../src/modules/media-library/domain/managed-media-readiness";

/**
 * Pure deployment-readiness for managed media (ADR-0036). This is the media half
 * carved out of `news-portal-preset-readiness.ts`; the reason-code STRINGS are
 * deliberately identical to what that function returned (they are recorded in
 * audit attributes and asserted elsewhere), so they are pinned here.
 */

const READY_ENV = {
  NEWS_MEDIA_R2_ENABLED: "true",
  NEWS_MEDIA_R2_ACCOUNT_ID: "acct",
  NEWS_MEDIA_R2_ACCESS_KEY_ID: "news-key",
  NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "news-secret",
  NEWS_MEDIA_R2_BUCKET: "news-media-bucket",
  NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test"
} as NodeJS.ProcessEnv;

describe("evaluateManagedMediaReadiness", () => {
  test("fail-closed when R2 is disabled — the single short-circuit reason", () => {
    const result = evaluateManagedMediaReadiness({
      NEWS_MEDIA_R2_ENABLED: "false"
    } as NodeJS.ProcessEnv);
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(["news_media_r2_disabled"]);
    expect(result.detail.length).toBe(1);
  });

  test("fail-closed when enabled but required config is missing", () => {
    const result = evaluateManagedMediaReadiness({
      NEWS_MEDIA_R2_ENABLED: "true"
    } as NodeJS.ProcessEnv);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("news_media_r2_config_incomplete");
  });

  test("fail-closed when the media R2 bucket/credentials collide with sync-storage's own R2_* vars", () => {
    const result = evaluateManagedMediaReadiness({
      ...READY_ENV,
      NEWS_MEDIA_R2_BUCKET: "shared-bucket",
      R2_BUCKET: "shared-bucket"
    } as NodeJS.ProcessEnv);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain(
      "news_media_r2_shares_sync_storage_bucket_or_credentials"
    );
  });

  test("ready when enabled, fully configured, and separated from sync-storage", () => {
    const result = evaluateManagedMediaReadiness(READY_ENV);
    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.detail).toEqual([]);
  });
});
