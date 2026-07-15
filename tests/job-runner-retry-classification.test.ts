import { describe, expect, test } from "bun:test";

import { classifyError } from "../src/lib/jobs/retry-classification";

describe("classifyError (Issue #697)", () => {
  test("serialization_failure (40001) is retryable", () => {
    const error = new Bun.SQL.PostgresError("could not serialize access", {
      code: "40001",
      errno: "40001"
    });
    expect(classifyError(error)).toBe("retryable");
  });

  test("deadlock_detected (40P01) is retryable", () => {
    const error = new Bun.SQL.PostgresError("deadlock detected", {
      code: "40P01",
      errno: "40P01"
    });
    expect(classifyError(error)).toBe("retryable");
  });

  test("connection exception (08006) is retryable", () => {
    const error = new Bun.SQL.PostgresError("connection failure", {
      code: "08006",
      errno: "08006"
    });
    expect(classifyError(error)).toBe("retryable");
  });

  test("insufficient resources (53300 too_many_connections) is retryable", () => {
    const error = new Bun.SQL.PostgresError("too many connections", {
      code: "53300",
      errno: "53300"
    });
    expect(classifyError(error)).toBe("retryable");
  });

  test("operator intervention (57P03 cannot_connect_now) is retryable", () => {
    const error = new Bun.SQL.PostgresError(
      "the database system is starting up",
      {
        code: "57P03",
        errno: "57P03"
      }
    );
    expect(classifyError(error)).toBe("retryable");
  });

  test("unique_violation (23505) is NOT retryable", () => {
    const error = new Bun.SQL.PostgresError("duplicate key value", {
      code: "23505",
      errno: "23505"
    });
    expect(classifyError(error)).toBe("not_retryable");
  });

  test("foreign_key_violation (23503) is NOT retryable", () => {
    const error = new Bun.SQL.PostgresError("violates foreign key constraint", {
      code: "23503",
      errno: "23503"
    });
    expect(classifyError(error)).toBe("not_retryable");
  });

  test("invalid_text_representation (22P02) is NOT retryable", () => {
    const error = new Bun.SQL.PostgresError(
      "invalid input syntax for type uuid",
      {
        code: "22P02",
        errno: "22P02"
      }
    );
    expect(classifyError(error)).toBe("not_retryable");
  });

  test("an unclassified Postgres SQLSTATE class is unknown, not guessed either way", () => {
    // Class 42 (syntax_error_or_access_rule_violation) has no rule here.
    const error = new Bun.SQL.PostgresError("permission denied", {
      code: "42501",
      errno: "42501"
    });
    expect(classifyError(error)).toBe("unknown");
  });

  test("a network-shaped generic Error (fetch to an external provider) is retryable", () => {
    expect(classifyError(new Error("fetch failed: ECONNRESET"))).toBe(
      "retryable"
    );
    expect(classifyError(new Error("The operation timed out"))).toBe(
      "retryable"
    );
  });

  test("an ordinary application error is unknown", () => {
    expect(classifyError(new Error("something went wrong"))).toBe("unknown");
  });

  test("a non-Error thrown value never throws and is unknown", () => {
    expect(classifyError("a plain string")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
    expect(classifyError({ some: "object" })).toBe("unknown");
  });
});
