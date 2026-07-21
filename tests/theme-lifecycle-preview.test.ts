/**
 * Unit tests for the theme lifecycle state machine + preview token helpers
 * (Issue #269, ADR-0029 §4/§6).
 */
import { describe, expect, test } from "bun:test";

import {
  canActivateVersion,
  canPublishFromStatus,
  isValidRollbackTarget,
  isVersionMutable
} from "../src/modules/theming/domain/theme-lifecycle";
import {
  PREVIEW_SESSION_MAX_TTL_MINUTES,
  PREVIEW_SESSION_TTL_MINUTES,
  buildPreviewUrlToken,
  generatePreviewToken,
  hashPreviewToken,
  isPreviewSessionActive,
  isWellFormedPreviewToken,
  parsePreviewUrlToken,
  resolvePreviewTtlMinutes
} from "../src/modules/theming/domain/preview-token";

const TENANT = "22222222-2222-2222-2222-222222222222";

describe("lifecycle", () => {
  test("only published versions may become the active pointer", () => {
    expect(canActivateVersion("published")).toBe(true);
    expect(canActivateVersion("draft")).toBe(false);
  });

  test("only a draft may be published, only a draft is mutable", () => {
    expect(canPublishFromStatus("draft")).toBe(true);
    expect(canPublishFromStatus("published")).toBe(false);
    expect(isVersionMutable("draft")).toBe(true);
    expect(isVersionMutable("published")).toBe(false);
  });

  test("rollback target must be one of the tenant's own published versions", () => {
    expect(isValidRollbackTarget("v1", ["v1", "v2"])).toBe(true);
    expect(isValidRollbackTarget("v9", ["v1", "v2"])).toBe(false);
  });
});

describe("preview token", () => {
  test("generates unique 64-hex tokens", () => {
    const a = generatePreviewToken();
    const b = generatePreviewToken();
    expect(isWellFormedPreviewToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isWellFormedPreviewToken("nope")).toBe(false);
  });

  test("hash is deterministic 64-hex and differs per token", () => {
    const raw = generatePreviewToken();
    expect(hashPreviewToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPreviewToken(raw)).toBe(hashPreviewToken(raw));
    expect(hashPreviewToken(raw)).not.toBe(
      hashPreviewToken(generatePreviewToken())
    );
  });

  test("TTL resolution defaults and caps", () => {
    expect(resolvePreviewTtlMinutes(undefined)).toBe(
      PREVIEW_SESSION_TTL_MINUTES
    );
    expect(resolvePreviewTtlMinutes(0)).toBe(PREVIEW_SESSION_TTL_MINUTES);
    expect(resolvePreviewTtlMinutes(10)).toBe(10);
    expect(resolvePreviewTtlMinutes(9999)).toBe(
      PREVIEW_SESSION_MAX_TTL_MINUTES
    );
  });

  test("session active only until expiry", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isPreviewSessionActive(new Date("2026-01-01T00:30:00Z"), now)).toBe(
      true
    );
    expect(isPreviewSessionActive(new Date("2025-12-31T23:59:00Z"), now)).toBe(
      false
    );
  });

  test("URL token round-trips tenant id + raw token, and rejects malformed", () => {
    const raw = generatePreviewToken();
    const urlToken = buildPreviewUrlToken(TENANT, raw);
    const parsed = parsePreviewUrlToken(urlToken);
    expect(parsed).toEqual({ tenantId: TENANT, rawToken: raw });
    expect(parsePreviewUrlToken("no-separator")).toBeNull();
    expect(parsePreviewUrlToken(`not-a-uuid~${raw}`)).toBeNull();
    expect(parsePreviewUrlToken(`${TENANT}~short`)).toBeNull();
  });
});
