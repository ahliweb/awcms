import { describe, expect, mock, test } from "bun:test";

import * as realDatabaseClient from "../src/lib/database/client";
import * as realTenantContext from "../src/lib/database/tenant-context";
import { maskIdentifierValue } from "../src/modules/profile-identity/domain/identifier";

/**
 * Issue #144 (email masking is unreadable) and Issue #150 (duplicate
 * identifier returns 500 instead of 409). Both behaviours were ported from
 * awcms-mini's `maskIdentifier` / `DuplicateIdentifierError`.
 */
describe("maskIdentifierValue — email branch (Issue #144)", () => {
  test("keeps the domain and the local part's first character readable", () => {
    expect(maskIdentifierValue("budi.santoso@example.com")).toBe(
      "b***********@example.com"
    );
    expect(maskIdentifierValue("siti@example.com")).toBe("s***@example.com");
  });

  test("distinct recipients produce distinct masks (the point of the masked columns)", () => {
    expect(maskIdentifierValue("siti@example.com")).not.toBe(
      maskIdentifierValue("budi@example.com")
    );
    expect(maskIdentifierValue("jane@example.com")).not.toBe(
      maskIdentifierValue("jane@other.example.org")
    );
  });

  test("never returns the raw address, and never leaks the local part beyond its first character", () => {
    const masked = maskIdentifierValue("budi.santoso@example.com");

    expect(masked).not.toBe("budi.santoso@example.com");
    expect(masked).not.toContain("budi");
    expect(masked).not.toContain("santoso");
  });

  test("a single-character local part is not published verbatim", () => {
    expect(maskIdentifierValue("a@example.com")).toBe("a*@example.com");
  });

  test("a value with no local part falls back to the tail mask", () => {
    expect(maskIdentifierValue("@example.com")).toBe("********.com");
  });
});

describe("maskIdentifierValue — tail branch (Issue #144, short-value leak)", () => {
  test("short values are fully masked instead of leaking their last character", () => {
    expect(maskIdentifierValue("7788")).toBe("****");
    expect(maskIdentifierValue("12")).toBe("**");
    expect(maskIdentifierValue("9")).toBe("*");
  });

  test("an empty value stays empty", () => {
    expect(maskIdentifierValue("")).toBe("");
  });

  test("non-email identifiers keep only the last four characters", () => {
    expect(maskIdentifierValue("+6281234567890")).toBe("**********7890");
    expect(maskIdentifierValue("01.234.567.8-901.000")).toBe(
      "****************.000"
    );
  });
});

type AuditInsert = { text: string; values: unknown[] };

/**
 * Minimal tagged-template stand-in for `Bun.SQL`: the first statement is the
 * profile lookup, the second is the identifier INSERT, the third (success path
 * only) is the audit event.
 */
function fakeTx(options: { profileFound: boolean; insertError?: unknown }): {
  tx: Bun.SQL;
  statements: AuditInsert[];
} {
  const statements: AuditInsert[] = [];

  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });

    if (text.includes("FROM awcms_profiles")) {
      return Promise.resolve(
        options.profileFound
          ? [
              {
                id: "11111111-1111-4111-8111-111111111111",
                tenant_id: "22222222-2222-4222-8222-222222222222",
                profile_type: "person",
                display_name: "Budi",
                legal_name: null,
                status: "active",
                verification_status: "unverified",
                risk_level: "low",
                merged_into_profile_id: null,
                created_at: new Date(),
                updated_at: new Date(),
                created_by: null,
                updated_by: null,
                deleted_at: null,
                deleted_by: null,
                delete_reason: null,
                restored_at: null,
                restored_by: null
              }
            ]
          : []
      );
    }

    if (text.includes("INSERT INTO awcms_profile_identifiers")) {
      if (options.insertError) {
        return Promise.reject(options.insertError);
      }

      return Promise.resolve([
        {
          id: "33333333-3333-4333-8333-333333333333",
          profile_id: "11111111-1111-4111-8111-111111111111",
          identifier_type: "email",
          masked_value: "b***@example.com",
          is_primary: false,
          verification_status: "unverified"
        }
      ]);
    }

    return Promise.resolve([]);
  }) as unknown as Bun.SQL;

  return { tx, statements };
}

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";

function uniqueViolation(): Error {
  return new Bun.SQL.PostgresError("duplicate key value violates unique", {
    code: "23505",
    errno: "23505"
  });
}

describe("addIdentifierToProfile — duplicate handling (Issue #150)", () => {
  test("translates a 23505 unique violation into DuplicateIdentifierError", async () => {
    const { addIdentifierToProfile, DuplicateIdentifierError } =
      await import("../src/modules/profile-identity/application/identifier-directory");
    const { tx } = fakeTx({
      profileFound: true,
      insertError: uniqueViolation()
    });

    await expect(
      addIdentifierToProfile(tx, TENANT_ID, ACTOR_ID, PROFILE_ID, {
        identifierType: "email",
        value: "budi@example.com",
        isPrimary: false
      })
    ).rejects.toBeInstanceOf(DuplicateIdentifierError);
  });

  test("rethrows any other Postgres error untouched", async () => {
    const { addIdentifierToProfile, DuplicateIdentifierError } =
      await import("../src/modules/profile-identity/application/identifier-directory");
    const foreignKeyViolation = new Bun.SQL.PostgresError(
      "violates foreign key constraint",
      { code: "23503", errno: "23503" }
    );
    const { tx } = fakeTx({
      profileFound: true,
      insertError: foreignKeyViolation
    });

    const call = addIdentifierToProfile(tx, TENANT_ID, ACTOR_ID, PROFILE_ID, {
      identifierType: "email",
      value: "budi@example.com",
      isPrimary: false
    });

    await expect(call).rejects.not.toBeInstanceOf(DuplicateIdentifierError);
    await expect(call).rejects.toBeInstanceOf(Bun.SQL.PostgresError);
  });

  test("the success path still writes its audit event (the duplicate guard must not swallow audit)", async () => {
    const { addIdentifierToProfile } =
      await import("../src/modules/profile-identity/application/identifier-directory");
    const { tx, statements } = fakeTx({ profileFound: true });

    const record = await addIdentifierToProfile(
      tx,
      TENANT_ID,
      ACTOR_ID,
      PROFILE_ID,
      { identifierType: "email", value: "Budi@Example.com", isPrimary: false }
    );

    expect(record).not.toBeNull();
    expect(
      statements.some((statement) =>
        statement.text.includes("INSERT INTO awcms_audit_events")
      )
    ).toBe(true);
  });

  test("stores an email-shaped masked value (Issue #144 reaches the column)", async () => {
    const { addIdentifierToProfile } =
      await import("../src/modules/profile-identity/application/identifier-directory");
    const { tx, statements } = fakeTx({ profileFound: true });

    await addIdentifierToProfile(tx, TENANT_ID, ACTOR_ID, PROFILE_ID, {
      identifierType: "email",
      value: "Budi.Santoso@Example.com",
      isPrimary: false
    });

    const insert = statements.find((statement) =>
      statement.text.includes("INSERT INTO awcms_profile_identifiers")
    );

    expect(insert?.values).toContain("b***********@example.com");
  });
});

describe("POST /api/v1/profiles/{id}/identifiers — duplicate maps to 409 (Issue #150)", () => {
  test("returns 409 IDENTIFIER_ALREADY_EXISTS instead of an unhandled 500", async () => {
    const { tx } = fakeTx({
      profileFound: true,
      insertError: uniqueViolation()
    });

    // `mock.module` replaces the WHOLE module registry entry and persists for
    // the rest of the run, so spread the real exports back in: overriding only
    // the named ones keeps unrelated suites (e.g. database-capacity-config,
    // which imports `resolvePoolMaxForKind` from this same module) working
    // when the full suite runs in one process.
    mock.module("../src/lib/database/client", () => ({
      ...realDatabaseClient,
      getDatabaseClient: () => ({}) as Bun.SQL
    }));
    mock.module("../src/lib/database/tenant-context", () => ({
      ...realTenantContext,
      withTenant: (
        _sql: unknown,
        _tenantId: string,
        fn: (tx: Bun.SQL) => Promise<Response>
      ) => fn(tx)
    }));
    mock.module(
      "../src/modules/identity-access/application/access-guard",
      () => ({
        resolveAuthInputs: () => ({ tenantId: TENANT_ID, token: "token" }),
        authorizeInTransaction: () =>
          Promise.resolve({
            allowed: true,
            context: { tenantUserId: ACTOR_ID }
          })
      })
    );

    const { POST } =
      await import("../src/pages/api/v1/profiles/[id]/identifiers");

    const response = await POST({
      request: new Request("https://awcms.test/api/v1/profiles/x/identifiers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-awcms-tenant-id": TENANT_ID,
          authorization: "Bearer token"
        },
        body: JSON.stringify({
          identifierType: "email",
          value: "budi@example.com"
        })
      }),
      params: { id: PROFILE_ID },
      cookies: { get: () => undefined },
      locals: { correlationId: "corr-1" }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(response.status).toBe(409);

    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("IDENTIFIER_ALREADY_EXISTS");
  });
});
