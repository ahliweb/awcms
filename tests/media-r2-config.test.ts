import { describe, expect, test } from "bun:test";

import {
  allowsSvgMimeType,
  findMissingNewsMediaR2Vars,
  findNewsMediaR2PublicBaseUrlProductionUnsafeReason,
  findNewsMediaR2SeparationViolations,
  findUnknownNewsMediaR2MimeTypes,
  isNewsMediaR2Enabled,
  isOrphanGraceTooShort,
  isPresignedUploadTtlTooLong,
  NEWS_MEDIA_R2_DEFAULTS,
  NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS,
  NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS,
  NEWS_MEDIA_R2_REQUIRED_WHEN_ENABLED,
  resolveNewsMediaR2Config
} from "../src/modules/media-library/domain/media-r2-config";

describe("resolveNewsMediaR2Config", () => {
  test("defaults to disabled with empty credential fields when env is empty", () => {
    const config = resolveNewsMediaR2Config({} as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(false);
    expect(config.accountId).toBe("");
    expect(config.accessKeyId).toBe("");
    expect(config.secretAccessKey).toBe("");
    expect(config.bucket).toBe("");
    expect(config.publicBaseUrl).toBe("");
    expect(config.presignedUploadTtlSeconds).toBe(
      NEWS_MEDIA_R2_DEFAULTS.presignedUploadTtlSeconds
    );
    expect(config.maxUploadBytes).toBe(NEWS_MEDIA_R2_DEFAULTS.maxUploadBytes);
    expect(config.allowedMimeTypes).toEqual(
      NEWS_MEDIA_R2_DEFAULTS.allowedMimeTypes
    );
    expect(config.pendingTtlMinutes).toBe(
      NEWS_MEDIA_R2_DEFAULTS.pendingTtlMinutes
    );
    expect(config.orphanGraceDays).toBe(NEWS_MEDIA_R2_DEFAULTS.orphanGraceDays);
  });

  test("parses a fully-configured enabled env", () => {
    const config = resolveNewsMediaR2Config({
      NEWS_MEDIA_R2_ENABLED: "true",
      NEWS_MEDIA_R2_ACCOUNT_ID: "acct-news",
      NEWS_MEDIA_R2_ACCESS_KEY_ID: "news-key",
      NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "news-secret",
      NEWS_MEDIA_R2_BUCKET: "news-media-bucket",
      NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test",
      NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS: "120",
      NEWS_MEDIA_R2_MAX_UPLOAD_BYTES: "2048",
      NEWS_MEDIA_R2_ALLOWED_MIME_TYPES: "image/jpeg, image/png",
      NEWS_MEDIA_R2_PENDING_TTL_MINUTES: "15",
      NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS: "45"
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      enabled: true,
      accountId: "acct-news",
      accessKeyId: "news-key",
      secretAccessKey: "news-secret",
      bucket: "news-media-bucket",
      publicBaseUrl: "https://media.example.test",
      presignedUploadTtlSeconds: 120,
      maxUploadBytes: 2048,
      allowedMimeTypes: ["image/jpeg", "image/png"],
      pendingTtlMinutes: 15,
      orphanGraceDays: 45
    });
  });

  test("falls back to defaults for malformed numeric values", () => {
    const config = resolveNewsMediaR2Config({
      NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS: "not-a-number",
      NEWS_MEDIA_R2_MAX_UPLOAD_BYTES: "-5",
      NEWS_MEDIA_R2_PENDING_TTL_MINUTES: "0",
      NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS: "not-a-number"
    } as NodeJS.ProcessEnv);

    expect(config.presignedUploadTtlSeconds).toBe(
      NEWS_MEDIA_R2_DEFAULTS.presignedUploadTtlSeconds
    );
    expect(config.maxUploadBytes).toBe(NEWS_MEDIA_R2_DEFAULTS.maxUploadBytes);
    expect(config.pendingTtlMinutes).toBe(
      NEWS_MEDIA_R2_DEFAULTS.pendingTtlMinutes
    );
    expect(config.orphanGraceDays).toBe(NEWS_MEDIA_R2_DEFAULTS.orphanGraceDays);
  });
});

describe("isNewsMediaR2Enabled", () => {
  test("false by default", () => {
    expect(isNewsMediaR2Enabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("true only for the literal string 'true'", () => {
    expect(
      isNewsMediaR2Enabled({
        NEWS_MEDIA_R2_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isNewsMediaR2Enabled({
        NEWS_MEDIA_R2_ENABLED: "TRUE"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});

describe("findMissingNewsMediaR2Vars", () => {
  test("empty when disabled, regardless of what else is set", () => {
    expect(findMissingNewsMediaR2Vars({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  test("lists every required var missing when enabled with nothing else set", () => {
    expect(
      findMissingNewsMediaR2Vars({
        NEWS_MEDIA_R2_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toEqual([...NEWS_MEDIA_R2_REQUIRED_WHEN_ENABLED]);
  });

  test("empty when enabled and fully configured", () => {
    expect(
      findMissingNewsMediaR2Vars({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_ACCOUNT_ID: "a",
        NEWS_MEDIA_R2_ACCESS_KEY_ID: "b",
        NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "c",
        NEWS_MEDIA_R2_BUCKET: "d",
        NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });
});

describe("findNewsMediaR2SeparationViolations — Keputusan kunci #1", () => {
  test("no violation when neither sync-storage R2 var nor news-media R2 var is set", () => {
    expect(
      findNewsMediaR2SeparationViolations({} as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("no violation when only one side is set (nothing to collide with)", () => {
    expect(
      findNewsMediaR2SeparationViolations({
        NEWS_MEDIA_R2_BUCKET: "news-bucket"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("no violation when both sides are set but genuinely different", () => {
    expect(
      findNewsMediaR2SeparationViolations({
        R2_BUCKET: "sync-bucket",
        R2_ACCESS_KEY_ID: "sync-key",
        R2_SECRET_ACCESS_KEY: "sync-secret",
        NEWS_MEDIA_R2_BUCKET: "news-bucket",
        NEWS_MEDIA_R2_ACCESS_KEY_ID: "news-key",
        NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "news-secret"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("flags a shared bucket", () => {
    expect(
      findNewsMediaR2SeparationViolations({
        R2_BUCKET: "same-bucket",
        NEWS_MEDIA_R2_BUCKET: "same-bucket"
      } as NodeJS.ProcessEnv)
    ).toEqual(["bucket_shared_with_sync_r2"]);
  });

  test("flags a shared access key id and secret access key independently", () => {
    expect(
      findNewsMediaR2SeparationViolations({
        R2_ACCESS_KEY_ID: "same-key",
        NEWS_MEDIA_R2_ACCESS_KEY_ID: "same-key",
        R2_SECRET_ACCESS_KEY: "same-secret",
        NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "same-secret"
      } as NodeJS.ProcessEnv)
    ).toEqual([
      "access_key_id_shared_with_sync_r2",
      "secret_access_key_shared_with_sync_r2"
    ]);
  });
});

describe("allowsSvgMimeType", () => {
  test("false for the default allow-list", () => {
    expect(allowsSvgMimeType({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("true only when an operator explicitly overrides the allow-list to include it", () => {
    expect(
      allowsSvgMimeType({
        NEWS_MEDIA_R2_ALLOWED_MIME_TYPES: "image/jpeg,image/svg+xml"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("findUnknownNewsMediaR2MimeTypes (Issue #635)", () => {
  test("empty when disabled, regardless of the allow-list value", () => {
    expect(
      findUnknownNewsMediaR2MimeTypes({
        NEWS_MEDIA_R2_ALLOWED_MIME_TYPES: "text/html"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("empty for the default allow-list", () => {
    expect(
      findUnknownNewsMediaR2MimeTypes({
        NEWS_MEDIA_R2_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("empty when the allow-list is deliberately overridden to include image/svg+xml (a known, if disallowed-by-default, type)", () => {
    expect(
      findUnknownNewsMediaR2MimeTypes({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_ALLOWED_MIME_TYPES: "image/jpeg,image/svg+xml"
      } as NodeJS.ProcessEnv)
    ).toEqual([]);
  });

  test("flags entries the MIME sniffer could never recognize (misconfiguration, not just unsafe)", () => {
    expect(
      findUnknownNewsMediaR2MimeTypes({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_ALLOWED_MIME_TYPES:
          "image/jpeg,text/html,application/octet-stream"
      } as NodeJS.ProcessEnv)
    ).toEqual(["text/html", "application/octet-stream"]);
  });
});

describe("isPresignedUploadTtlTooLong (Issue #635)", () => {
  test("false when disabled, regardless of the TTL value", () => {
    expect(
      isPresignedUploadTtlTooLong({
        NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS: "999999"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("false for the default TTL", () => {
    expect(
      isPresignedUploadTtlTooLong({
        NEWS_MEDIA_R2_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("false exactly at the maximum", () => {
    expect(
      isPresignedUploadTtlTooLong({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS: String(
          NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS
        )
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("true just above the maximum", () => {
    expect(
      isPresignedUploadTtlTooLong({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS: String(
          NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS + 1
        )
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("isOrphanGraceTooShort (Issue #690)", () => {
  test("false when disabled, regardless of the grace value", () => {
    expect(
      isOrphanGraceTooShort({
        NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS: "1"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("false for the default grace period", () => {
    expect(
      isOrphanGraceTooShort({
        NEWS_MEDIA_R2_ENABLED: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("false exactly at the minimum", () => {
    expect(
      isOrphanGraceTooShort({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS: String(
          NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS
        )
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  test("true just below the minimum", () => {
    expect(
      isOrphanGraceTooShort({
        NEWS_MEDIA_R2_ENABLED: "true",
        NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS: String(
          NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS - 1
        )
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("findNewsMediaR2PublicBaseUrlProductionUnsafeReason (Issue #635)", () => {
  test("null for a real custom domain", () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
        "https://media.example.com"
      )
    ).toBeNull();
  });

  test('"r2_dev_default_domain" for Cloudflare\'s default *.r2.dev host', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
        "https://pub-abc123.r2.dev"
      )
    ).toBe("r2_dev_default_domain");
  });

  test('does not false-positive on a custom domain that merely contains "r2.dev" as a substring elsewhere', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
        "https://media.example.com/r2.dev-archive"
      )
    ).toBeNull();
  });

  test('"loopback_host" for localhost', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
        "http://localhost:3000"
      )
    ).toBe("loopback_host");
  });

  test('"loopback_host" for 127.0.0.1', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason("http://127.0.0.1")
    ).toBe("loopback_host");
  });

  test('"loopback_host" for IPv6 ::1 (bracketed URL form)', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason("http://[::1]")
    ).toBe("loopback_host");
  });

  test('"loopback_host" for 0.0.0.0', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason("http://0.0.0.0")
    ).toBe("loopback_host");
  });

  test('"r2_dev_default_domain" for a trailing-dot FQDN variant of *.r2.dev (reviewer + security-auditor finding, PR #665 re-review — DNS treats "abc.r2.dev." identically to "abc.r2.dev", but a naive suffix regex would not)', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
        "https://pub-abc123.r2.dev./x"
      )
    ).toBe("r2_dev_default_domain");
  });

  test('"loopback_host" for a trailing-dot variant of localhost', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason("http://localhost.")
    ).toBe("loopback_host");
  });

  test('"unparseable_url" for a malformed value', () => {
    expect(
      findNewsMediaR2PublicBaseUrlProductionUnsafeReason("not-a-url")
    ).toBe("unparseable_url");
  });
});
