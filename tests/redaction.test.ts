import { describe, expect, test } from "bun:test";

import { redactSecretsInText } from "../src/modules/_shared/redaction";

describe("redactSecretsInText", () => {
  test("redacts connection-string credentials in free text", () => {
    const output = redactSecretsInText(
      'FATAL: password authentication failed for user "awcms" (postgres://awcms:S3cr3tP@ss@db:5432/awcms)'
    );

    expect(output).not.toContain("S3cr3tP@ss");
    expect(output).toContain("postgres://[REDACTED]@db:5432/awcms");
  });

  test("keeps the host and database name readable after redacting a DSN", () => {
    expect(
      redactSecretsInText("connect postgres://user:pw@db.internal:5432/reports")
    ).toBe("connect postgres://[REDACTED]@db.internal:5432/reports");
  });

  test("redacts a DSN password containing ':' and '@'", () => {
    const output = redactSecretsInText(
      "postgres://awcms:p@ss:word@db:5432/awcms"
    );

    expect(output).not.toContain("p@ss:word");
    expect(output).toBe("postgres://[REDACTED]@db:5432/awcms");
  });

  test("redacts a well-formed PEM block", () => {
    const output = redactSecretsInText(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234abcd\n-----END RSA PRIVATE KEY-----"
    );

    expect(output).toBe("[REDACTED_PRIVATE_KEY]");
  });

  test("redacts a PEM block truncated before its END marker", () => {
    const output = redactSecretsInText(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234abcd\n(log line cut off"
    );

    expect(output).not.toContain("MIIEowIBAAKCAQEA1234abcd");
    expect(output).toBe("[REDACTED_PRIVATE_KEY]");
  });

  test("redacts each of two well-formed PEM blocks without the truncation fallback swallowing the tail", () => {
    const output = redactSecretsInText(
      "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\nkeep this\n-----BEGIN EC PRIVATE KEY-----\nBBBB\n-----END EC PRIVATE KEY-----"
    );

    expect(output).toBe(
      "[REDACTED_PRIVATE_KEY]\nkeep this\n[REDACTED_PRIVATE_KEY]"
    );
  });

  test("redacts an AWS access key id", () => {
    expect(redactSecretsInText("using AKIAIOSFODNN7EXAMPLE for upload")).toBe(
      "using [REDACTED_AWS_KEY] for upload"
    );
  });

  test("still redacts the previously covered shapes", () => {
    expect(redactSecretsInText("Authorization: Bearer abc.def")).toBe(
      "Authorization: Bearer [REDACTED]"
    );
    expect(redactSecretsInText("token=eyJhbGciOi.eyJzdWIiOi.sig")).toContain(
      "[REDACTED"
    );
    expect(redactSecretsInText("password: hunter2")).toBe(
      "password: [REDACTED]"
    );
  });

  test("leaves text without secrets untouched", () => {
    expect(redactSecretsInText("connection refused to db:5432")).toBe(
      "connection refused to db:5432"
    );
  });
});
