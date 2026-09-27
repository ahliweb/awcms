/**
 * Pure-unit tests for the AI privacy domain layer (Issue ahliweb/omes#232,
 * OMES issue #217, ADR-0029): freshness/effective-status recomputation,
 * the owner-approval authorization gate (including the unconditional
 * RESTRICTED->cloud_sanitized refusal), and the disallowed-evidence-key
 * scanner. No database.
 */
import { describe, expect, test } from "bun:test";

import {
  AI_EGRESS_APPROVABLE_REASON_CODES,
  AI_EGRESS_APPROVAL_DENIED_BY_ACTOR,
  AI_EGRESS_APPROVAL_DENIED_CROSS_TENANT,
  AI_EGRESS_APPROVAL_DENIED_NOT_APPROVABLE,
  AI_EGRESS_APPROVAL_DENIED_RESTRICTED_CLOUD_NEVER_APPROVABLE,
  AI_PRIVACY_STATUSES,
  authorizeAiEgressApproval,
  classifyFreshness,
  findDisallowedEvidenceKeys,
  projectAiPrivacyPosture,
  type StoredAiPrivacyPosture
} from "../src/modules/omes-control/domain/ai-privacy";

const NOW = new Date("2026-09-27T12:00:00Z");

function stored(
  overrides: Partial<StoredAiPrivacyPosture> = {}
): StoredAiPrivacyPosture {
  return {
    authority: "omes-host",
    classificationMode: "fail_closed_v1",
    destinationClass: "local",
    localEndpointClassification: null,
    status: "PASS",
    reasonCodes: ["AI_PRIVACY_POSTURE_PASS_CONSISTENT"],
    lastVerifiedAt: "2026-09-27T11:55:00Z",
    projectedAt: "2026-09-27T12:00:00Z",
    ...overrides
  };
}

describe("classifyFreshness", () => {
  test("a recent timestamp within the window is fresh", () => {
    expect(classifyFreshness("2026-09-27T11:55:00Z", NOW)).toBe("fresh");
  });

  test("a timestamp older than the default 24h window is stale", () => {
    expect(classifyFreshness("2026-09-25T00:00:00Z", NOW)).toBe("stale");
  });

  test("a missing timestamp is unknown, never fresh", () => {
    expect(classifyFreshness(null, NOW)).toBe("unknown");
    expect(classifyFreshness(undefined, NOW)).toBe("unknown");
  });

  test("an unparsable timestamp is unknown", () => {
    expect(classifyFreshness("not-a-date", NOW)).toBe("unknown");
  });

  test("a timestamp in the future (clock/producer problem) is unknown, never fresh", () => {
    expect(classifyFreshness("2026-09-28T00:00:00Z", NOW)).toBe("unknown");
  });

  test("a custom max-age window is honored", () => {
    expect(classifyFreshness("2026-09-27T11:00:00Z", NOW, 30 * 60)).toBe(
      "stale"
    );
    expect(classifyFreshness("2026-09-27T11:50:00Z", NOW, 30 * 60)).toBe(
      "fresh"
    );
  });
});

describe("projectAiPrivacyPosture — stale/unknown evidence is never rendered as healthy", () => {
  test("fresh, recognized, PASS evidence projects as healthy", () => {
    const result = projectAiPrivacyPosture(stored(), NOW);
    expect(result.evidenceFreshness).toBe("fresh");
    expect(result.effectiveStatus).toBe("PASS");
    expect(result.isHealthy).toBe(true);
  });

  test("stale evidence downgrades a stored PASS to BLOCKED — never rendered healthy", () => {
    const result = projectAiPrivacyPosture(
      stored({ lastVerifiedAt: "2026-09-01T00:00:00Z", status: "PASS" }),
      NOW
    );
    expect(result.evidenceFreshness).toBe("stale");
    expect(result.effectiveStatus).toBe("BLOCKED");
    expect(result.isHealthy).toBe(false);
  });

  test("a missing/unparsable lastVerifiedAt is 'unknown' and downgrades PASS to BLOCKED", () => {
    const result = projectAiPrivacyPosture(
      stored({ lastVerifiedAt: null, status: "PASS" }),
      NOW
    );
    expect(result.evidenceFreshness).toBe("unknown");
    expect(result.effectiveStatus).toBe("BLOCKED");
    expect(result.isHealthy).toBe(false);
  });

  test("an unrecognized stored status is treated as BLOCKED", () => {
    const result = projectAiPrivacyPosture(
      stored({ status: "TOTALLY_HEALTHY_HONEST" }),
      NOW
    );
    expect(AI_PRIVACY_STATUSES as readonly string[]).not.toContain(
      "TOTALLY_HEALTHY_HONEST"
    );
    expect(result.effectiveStatus).toBe("BLOCKED");
  });

  test("an unrecognized destination class downgrades a fresh PASS to BLOCKED", () => {
    const result = projectAiPrivacyPosture(
      stored({ destinationClass: "outer-space" }),
      NOW
    );
    expect(result.evidenceFreshness).toBe("fresh");
    expect(result.effectiveStatus).toBe("BLOCKED");
  });

  test("an unrecognized classification mode downgrades a fresh PASS to BLOCKED", () => {
    const result = projectAiPrivacyPosture(
      stored({ classificationMode: "vibes_based" }),
      NOW
    );
    expect(result.effectiveStatus).toBe("BLOCKED");
  });

  test("empty reasonCodes downgrades a fresh PASS to BLOCKED", () => {
    const result = projectAiPrivacyPosture(stored({ reasonCodes: [] }), NOW);
    expect(result.effectiveStatus).toBe("BLOCKED");
  });

  test("a genuinely FAIL/WARN status is never upgraded to PASS by freshness alone", () => {
    const fail = projectAiPrivacyPosture(stored({ status: "FAIL" }), NOW);
    expect(fail.effectiveStatus).toBe("FAIL");
    const warn = projectAiPrivacyPosture(stored({ status: "WARN" }), NOW);
    expect(warn.effectiveStatus).toBe("WARN");
  });
});

describe("authorizeAiEgressApproval", () => {
  const TENANT_A = "tenant-a";
  const TENANT_B = "tenant-b";

  test("RESTRICTED classification resolving to cloud_sanitized is ALWAYS refused, regardless of reason_code or approve flag", () => {
    for (const reasonCode of [
      ...AI_EGRESS_APPROVABLE_REASON_CODES,
      "SOME_OTHER_REASON_CODE"
    ]) {
      const result = authorizeAiEgressApproval({
        requesterTenantId: TENANT_A,
        tenantId: TENANT_A,
        decisionRef: {
          classification: "RESTRICTED",
          destination: "cloud_sanitized",
          reasonCode
        },
        approve: true
      });
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reasonCode).toBe(
          AI_EGRESS_APPROVAL_DENIED_RESTRICTED_CLOUD_NEVER_APPROVABLE
        );
      }
    }
  });

  test("cross-tenant requester is refused before any other check runs", () => {
    const result = authorizeAiEgressApproval({
      requesterTenantId: TENANT_B,
      tenantId: TENANT_A,
      decisionRef: {
        classification: "CONFIDENTIAL",
        destination: "private_endpoint",
        reasonCode: "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT"
      },
      approve: true
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reasonCode).toBe(AI_EGRESS_APPROVAL_DENIED_CROSS_TENANT);
    }
  });

  test("a reason_code that is not one of the three approval_required codes is refused as not-approvable", () => {
    const result = authorizeAiEgressApproval({
      requesterTenantId: TENANT_A,
      tenantId: TENANT_A,
      decisionRef: {
        classification: "CONFIDENTIAL",
        destination: "private_endpoint",
        reasonCode: "AI_EGRESS_DENY_RESTRICTED_CLOUD_SANITIZED"
      },
      approve: true
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reasonCode).toBe(AI_EGRESS_APPROVAL_DENIED_NOT_APPROVABLE);
    }
  });

  test("an explicit denial (approve: false) on an otherwise-approvable request is refused as denied-by-actor", () => {
    const result = authorizeAiEgressApproval({
      requesterTenantId: TENANT_A,
      tenantId: TENANT_A,
      decisionRef: {
        classification: "CONFIDENTIAL",
        destination: "private_endpoint",
        reasonCode: "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT"
      },
      approve: false
    });
    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.reasonCode).toBe(AI_EGRESS_APPROVAL_DENIED_BY_ACTOR);
    }
  });

  test("an approvable reason_code with approve: true is allowed", () => {
    for (const reasonCode of AI_EGRESS_APPROVABLE_REASON_CODES) {
      const result = authorizeAiEgressApproval({
        requesterTenantId: TENANT_A,
        tenantId: TENANT_A,
        decisionRef: {
          classification: "CONFIDENTIAL",
          destination: "private_endpoint",
          reasonCode
        },
        approve: true
      });
      expect(result.allow).toBe(true);
    }
  });

  test("a null requesterTenantId (system/service actor) does not trigger the cross-tenant refusal", () => {
    const result = authorizeAiEgressApproval({
      requesterTenantId: null,
      tenantId: TENANT_A,
      decisionRef: {
        classification: "CONFIDENTIAL",
        destination: "private_endpoint",
        reasonCode: "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT"
      },
      approve: true
    });
    expect(result.allow).toBe(true);
  });
});

describe("findDisallowedEvidenceKeys — structural rejection of raw-content-shaped fields", () => {
  test("a clean, bounded-metadata-only payload has no disallowed keys", () => {
    expect(
      findDisallowedEvidenceKeys({
        policy_version: "v1",
        classification: "CONFIDENTIAL",
        destination: "cloud_sanitized",
        decision: "approval_required",
        reason_codes: [
          "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_CLOUD_SANITIZED"
        ]
      })
    ).toEqual([]);
  });

  test("a top-level prompt-shaped key is found", () => {
    expect(
      findDisallowedEvidenceKeys({ decision: "deny", prompt: "ignore this" })
    ).toContain("prompt");
  });

  test("a nested transcript/credential/token-shaped key is found regardless of depth", () => {
    const found = findDisallowedEvidenceKeys({
      decision: "deny",
      nested: { deeply: { chain_of_thought: "...", access_token: "..." } }
    });
    expect(found).toContain("chain_of_thought");
    expect(found).toContain("access_token");
  });

  test("keys are matched case-insensitively", () => {
    expect(
      findDisallowedEvidenceKeys({ RAW_PROVIDER_RESPONSE: "..." })
    ).toContain("raw_provider_response");
  });

  test("null/empty payloads are clean", () => {
    expect(findDisallowedEvidenceKeys(null)).toEqual([]);
    expect(findDisallowedEvidenceKeys({})).toEqual([]);
  });
});
