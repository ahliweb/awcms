/**
 * The provider capability matrix v1 (Issue #1140, ADR-0148 section 3): the code
 * mirror is held EQUAL to `docs/awcms/omnichannel-foundation.md` section 3, cell
 * by cell, and `evaluateCapability` is fail-closed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CHANNEL_CAPABILITIES,
  PROVIDER_MATRIX,
  PROVIDER_MATRIX_VERSION,
  cellGrantability,
  checkAccountShape,
  evaluateCapability,
  registrableProviders,
  type AccountFacts,
  type CapabilityRowFacts,
  type MatrixCell
} from "../src/modules/channel-accounts/domain/provider-matrix";

const DOC = readFileSync("docs/awcms/omnichannel-foundation.md", "utf8");

/** First word of a documentation cell, with markdown bold stripped. */
function cellOf(raw: string): MatrixCell {
  const word = raw.replaceAll("**", "").trim().split(/[\s(]/)[0]!;

  switch (word) {
    case "candidate":
      return "candidate";
    case "restricted":
      return "restricted";
    case "n/o":
      return "not_offered";
    case "unverified":
      return "unverified";
    case "n/a":
      return "not_applicable";
    case "barred":
      return "barred";
    default:
      throw new Error(`Unknown matrix cell: ${raw}`);
  }
}

function documentedMatrix(): Map<string, MatrixCell[]> {
  const start = DOC.indexOf("## 3. Provider capability matrix v1");
  const subsection = DOC.indexOf("\n### 3.1", start);
  const end = subsection !== -1 ? subsection : DOC.indexOf("## 4.", start);
  const rows = new Map<string, MatrixCell[]>();

  for (const line of DOC.slice(start, end).split("\n")) {
    if (!line.startsWith("| ")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 10 || cells[0] === "Provider and account kind") {
      continue;
    }

    if (/^-+$/.test(cells[0]!)) continue;

    rows.set(cells[0]!, cells.slice(1).map(cellOf));
  }

  return rows;
}

describe("provider matrix mirror equals the documentation", () => {
  const documented = documentedMatrix();

  test("the documentation table has the twelve rows the mirror declares", () => {
    expect(documented.size).toBe(Object.keys(PROVIDER_MATRIX).length);
    expect(documented.size).toBe(12);
  });

  test("the documented capability columns are exactly the code's nine, in order", () => {
    const header = DOC.split("\n").find((line) =>
      line.startsWith("| Provider and account kind")
    )!;
    const columns = header
      .split("|")
      .slice(2, -1)
      .map((column) => column.trim());

    expect(columns).toEqual([...CHANNEL_CAPABILITIES]);
  });

  test("the version in the documentation is the version in the code", () => {
    expect(DOC).toContain(
      `## 3. Provider capability matrix v${PROVIDER_MATRIX_VERSION}`
    );
  });

  for (const [provider, row] of Object.entries(PROVIDER_MATRIX)) {
    test(`${provider}: every cell equals the documented cell`, () => {
      const cells = documented.get(row.docLabel);

      expect(cells, `no documented row "${row.docLabel}"`).toBeDefined();
      expect(
        CHANNEL_CAPABILITIES.map((capability) => row.cells[capability])
      ).toEqual(cells!);
    });
  }
});

describe("matrix policy invariants", () => {
  test("LinkedIn member data is barred from lead use and is not registrable", () => {
    expect(PROVIDER_MATRIX.linkedin_member!.cells.leads).toBe("barred");
    expect(PROVIDER_MATRIX.linkedin_member!.registrable).toBe(false);
    expect(registrableProviders()).not.toContain("linkedin_member");
    expect(checkAccountShape("linkedin_member", "member", "oauth2")).toEqual({
      ok: false,
      code: "PROVIDER_NOT_REGISTRABLE"
    });
  });

  test("LinkedIn Lead Sync and ads are never usable, whatever the evidence", () => {
    const account: AccountFacts = {
      provider: "linkedin",
      accountKind: "organization_page",
      status: "connected",
      connectionGrantState: "active"
    };
    const row: CapabilityRowFacts = {
      state: "granted",
      evidenceKind: "scope_list_hash",
      evidenceRef: "x",
      matrixVersion: PROVIDER_MATRIX_VERSION
    };

    // `restricted` needs contract evidence; a scope list is not one.
    expect(evaluateCapability({ account, capability: "leads", row })).toEqual({
      allowed: false,
      code: "PROVIDER_RESTRICTED"
    });
    expect(evaluateCapability({ account, capability: "ads", row })).toEqual({
      allowed: false,
      code: "PROVIDER_RESTRICTED"
    });
  });

  test("no provider is enabled for a capability it cannot do, even with a granted row", () => {
    const row: CapabilityRowFacts = {
      state: "granted",
      evidenceKind: "contract_reference",
      evidenceRef: "contract-1",
      matrixVersion: PROVIDER_MATRIX_VERSION
    };

    for (const [provider, matrix] of Object.entries(PROVIDER_MATRIX)) {
      const kind = Object.keys(matrix.kinds)[0] ?? "x";

      for (const capability of CHANNEL_CAPABILITIES) {
        const verdict = evaluateCapability({
          account: {
            provider,
            accountKind: kind,
            status: "connected",
            connectionGrantState: "active"
          },
          capability,
          row
        });
        const cell = matrix.cells[capability];
        const container = matrix.kinds[kind]?.container === true;

        if (
          container ||
          cell === "not_offered" ||
          cell === "not_applicable" ||
          cell === "unverified" ||
          cell === "barred"
        ) {
          expect(verdict.allowed, `${provider}.${capability}`).toBe(false);
        }
      }
    }
  });

  test("a StarSender device is registrable only as a device key", () => {
    expect(checkAccountShape("starsender", "device", "device_key").ok).toBe(
      true
    );
    expect(checkAccountShape("starsender", "device", "oauth2")).toEqual({
      ok: false,
      code: "AUTH_MODE_INVALID"
    });
  });

  test("Mailketing is an API-token connection, never OAuth", () => {
    expect(checkAccountShape("mailketing", "esp_account", "api_token").ok).toBe(
      true
    );
    expect(checkAccountShape("mailketing", "esp_account", "oauth2")).toEqual({
      ok: false,
      code: "AUTH_MODE_INVALID"
    });
  });

  test("a child identity names its container kind", () => {
    expect(
      checkAccountShape("whatsapp_cloud", "waba_phone_number", "api_token")
    ).toEqual({ ok: true, container: false, parentKind: "waba" });
    expect(
      checkAccountShape("mailketing", "sender_identity", "api_token")
    ).toEqual({ ok: true, container: false, parentKind: "esp_account" });
  });

  test("unknown provider / kind are refused, never defaulted", () => {
    expect(checkAccountShape("nope", "x", "oauth2")).toEqual({
      ok: false,
      code: "PROVIDER_UNKNOWN"
    });
    expect(checkAccountShape("facebook", "profile", "oauth2")).toEqual({
      ok: false,
      code: "ACCOUNT_KIND_INVALID"
    });
    // Prototype keys are not providers.
    expect(checkAccountShape("constructor", "x", "oauth2")).toEqual({
      ok: false,
      code: "PROVIDER_UNKNOWN"
    });
  });
});

describe("evaluateCapability is fail-closed", () => {
  const account: AccountFacts = {
    provider: "facebook",
    accountKind: "page",
    status: "connected",
    connectionGrantState: "active"
  };
  const granted: CapabilityRowFacts = {
    state: "granted",
    evidenceKind: "app_review_reference",
    evidenceRef: "review-42",
    matrixVersion: PROVIDER_MATRIX_VERSION
  };

  test("a granted, evidenced, current capability on a connected account is allowed", () => {
    expect(
      evaluateCapability({ account, capability: "publish", row: granted })
    ).toEqual({ allowed: true });
  });

  test("an absent row is denied", () => {
    expect(
      evaluateCapability({ account, capability: "publish", row: null })
    ).toEqual({ allowed: false, code: "CAPABILITY_NOT_RECORDED" });
  });

  test("pending and denied rows are denied", () => {
    for (const state of [
      "pending_approval",
      "denied",
      "not_offered"
    ] as const) {
      expect(
        evaluateCapability({
          account,
          capability: "publish",
          row: { ...granted, state }
        })
      ).toEqual({ allowed: false, code: "CAPABILITY_NOT_GRANTED" });
    }
  });

  test("a granted row without evidence is denied", () => {
    expect(
      evaluateCapability({
        account,
        capability: "publish",
        row: { ...granted, evidenceRef: null }
      })
    ).toEqual({ allowed: false, code: "EVIDENCE_MISSING" });
  });

  test("a row verified against an older matrix is denied", () => {
    expect(
      evaluateCapability({
        account,
        capability: "publish",
        row: { ...granted, matrixVersion: PROVIDER_MATRIX_VERSION - 1 }
      })
    ).toEqual({ allowed: false, code: "MATRIX_VERSION_STALE" });
  });

  test("every account state but connected is denied", () => {
    for (const status of [
      "pending",
      "degraded",
      "revoked",
      "disabled",
      "deleted"
    ]) {
      expect(
        evaluateCapability({
          account: { ...account, status },
          capability: "publish",
          row: granted
        })
      ).toEqual({ allowed: false, code: "ACCOUNT_NOT_USABLE" });
    }
  });

  test("a connection that is not active (revoked, expired, missing) denies", () => {
    for (const connectionGrantState of [
      "pending",
      "expired",
      "revoked",
      "failed",
      "missing"
    ]) {
      expect(
        evaluateCapability({
          account: { ...account, connectionGrantState },
          capability: "publish",
          row: granted
        })
      ).toEqual({ allowed: false, code: "CONNECTION_NOT_ACTIVE" });
    }
  });

  test("an unsupported action is refused with a reason, never downgraded", () => {
    // Facebook Page `ads` is restricted; WhatsApp `publish` is not offered.
    expect(
      cellGrantability("whatsapp_cloud", "waba_phone_number", "publish")
    ).toEqual({ grantable: false, code: "PROVIDER_NOT_OFFERED" });
    expect(
      evaluateCapability({
        account: {
          provider: "whatsapp_cloud",
          accountKind: "waba_phone_number",
          status: "connected",
          connectionGrantState: null
        },
        capability: "publish",
        row: granted
      })
    ).toEqual({ allowed: false, code: "PROVIDER_NOT_OFFERED" });
  });

  test("a container (a WABA) never performs an action itself", () => {
    expect(cellGrantability("whatsapp_cloud", "waba", "reply")).toEqual({
      grantable: false,
      code: "ACCOUNT_KIND_CONTAINER"
    });
  });

  test("a restricted cell is usable only with contract evidence", () => {
    const restricted = {
      ...account,
      provider: "starsender",
      accountKind: "device",
      connectionGrantState: null
    };

    expect(
      evaluateCapability({
        account: restricted,
        capability: "broadcast",
        row: granted
      })
    ).toEqual({ allowed: false, code: "PROVIDER_RESTRICTED" });
    expect(
      evaluateCapability({
        account: restricted,
        capability: "broadcast",
        row: {
          ...granted,
          evidenceKind: "written_authorization",
          evidenceRef: "owner-ack-1"
        }
      })
    ).toEqual({ allowed: true });
  });

  test("an unknown provider is denied", () => {
    expect(
      evaluateCapability({
        account: { ...account, provider: "ghost" },
        capability: "publish",
        row: granted
      })
    ).toEqual({ allowed: false, code: "PROVIDER_UNKNOWN" });
  });
});
