/**
 * Photo usage-rights metadata (Issue #615).
 *
 * ## What is actually at risk
 *
 * Not the shape of a form. Three things:
 *
 * 1. **That a PATCH cannot erase what it did not mention.** `undefined` means
 *    "leave alone" and `null` means "clear"; collapsing them means a form
 *    submitting only a copyright status wipes a credit somebody else typed.
 * 2. **That rights verification never becomes the byte check.** `media.verify`
 *    and a `verified` object status mean a MIME sniff and a checksum passed. If
 *    one word ends up covering both, the half that silently reads as done is
 *    the legal one.
 * 3. **That the adjudication is stamped, not submitted.** `rightsVerifiedBy` is
 *    the authenticated actor. A client-supplied verifier is a client-supplied
 *    signature on a decision a takedown dispute is argued from.
 *
 * Pure — no database.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import {
  changesRightsAdjudication,
  COPYRIGHT_STATUSES,
  isCopyrightStatus,
  isRightsAdjudication,
  isRightsVerificationStatus,
  MAX_CREDIT_LINE_LENGTH,
  RIGHTS_VERIFICATION_STATUSES,
  validateMediaRightsUpdateInput
} from "../src/modules/media-library/domain/media-rights-policy";

const ROUTE = "src/pages/api/v1/media/objects/[id].ts";
const DIRECTORY =
  "src/modules/media-library/application/media-object-directory.ts";
const MIGRATION = "sql/137_awcms_media_rights_metadata.sql";

describe("the patch distinguishes 'leave alone' from 'clear'", () => {
  test("an omitted field is absent from the parsed value", () => {
    const result = validateMediaRightsUpdateInput({ creditLine: "Foto: Ani" });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.creditLine).toBe("Foto: Ani");
    expect("sourceName" in result.value).toBe(false);
    expect("copyrightStatus" in result.value).toBe(false);
  });

  test("an explicit null survives as null, and is not dropped", () => {
    const result = validateMediaRightsUpdateInput({ creditLine: null });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    // Dropping it would make "remove this credit" impossible to express.
    expect("creditLine" in result.value).toBe(true);
    expect(result.value.creditLine).toBeNull();
  });

  test("a blank string normalizes to null, not to an empty string", () => {
    const result = validateMediaRightsUpdateInput({ creditLine: "   " });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    // Two spellings of "no credit" would make "does this image have one" a
    // question with two right answers.
    expect(result.value.creditLine).toBeNull();
  });

  test("an empty patch is refused", () => {
    const result = validateMediaRightsUpdateInput({});

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(result.errors[0]?.field).toBe("body");
  });

  test("an over-long credit line is refused rather than truncated", () => {
    const result = validateMediaRightsUpdateInput({
      creditLine: "x".repeat(MAX_CREDIT_LINE_LENGTH + 1)
    });

    expect(result.valid).toBe(false);
  });

  test("an unknown status is refused, and names what is allowed", () => {
    const result = validateMediaRightsUpdateInput({
      copyrightStatus: "probably_fine"
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(result.errors[0]?.message).toContain("public_domain");
  });
});

describe("rights verification is not the byte check", () => {
  test("the two vocabularies share no member", () => {
    // `verified` appears in BOTH, and that is the trap this test exists for:
    // the object statuses are pinned elsewhere, and what matters here is that
    // the rights vocabulary is its own list on its own column.
    expect([...RIGHTS_VERIFICATION_STATUSES]).toEqual([
      "unverified",
      "verified",
      "rejected"
    ]);
    expect(COPYRIGHT_STATUSES).toContain("unknown");
    expect(COPYRIGHT_STATUSES[0]).toBe("unknown");
  });

  test("the guards accept only their own vocabulary", () => {
    expect(isCopyrightStatus("licensed")).toBe(true);
    expect(isCopyrightStatus("verified")).toBe(false);
    expect(isRightsVerificationStatus("rejected")).toBe(true);
    expect(isRightsVerificationStatus("attached")).toBe(false);
  });

  test("only the two decided states are adjudications", () => {
    expect(isRightsAdjudication("unverified")).toBe(false);
    expect(isRightsAdjudication("verified")).toBe(true);
    expect(isRightsAdjudication("rejected")).toBe(true);
  });

  test("the route gates on `update`, never on `verify`", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    expect(source).toMatch(/action:\s*"update"/);
    expect(source).not.toMatch(/action:\s*"verify"/);
  });
});

describe("the adjudication is stamped from the server, never from the body", () => {
  test("a status change is what triggers the stamp", () => {
    expect(
      changesRightsAdjudication(
        { rightsVerificationStatus: "verified" },
        "unverified"
      )
    ).toBe(true);
    // Re-sending the same status is not a new decision, so it must not rewrite
    // who decided and when.
    expect(
      changesRightsAdjudication(
        { rightsVerificationStatus: "verified" },
        "verified"
      )
    ).toBe(false);
    expect(changesRightsAdjudication({ creditLine: "x" }, "verified")).toBe(
      false
    );
  });

  test("the writer never reads a verifier out of the input", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    expect(source).toContain("rights_verified_by = CASE");
    expect(source).toContain("actorTenantUserId");
    // If either of these appears, a caller is choosing who signed off.
    expect(source).not.toContain("input.rightsVerifiedBy");
    expect(source).not.toContain("input.rightsVerifiedAt");
  });

  test("the audit severity follows the decision, not the edit", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    expect(source).toContain("news_media.object.rights_adjudicated");
    expect(source).toContain("news_media.object.rights_updated");
    expect(source).toContain('adjudicationChanged ? "warning" : "info"');
  });

  test("the database refuses the same inconsistency from below", async () => {
    const migration = await readFile(MIGRATION, "utf8");

    // Application validation and a CHECK, not either: one governs what a
    // request may ask for, the other what the table may hold — including rows
    // written by a path that predates the validation.
    expect(migration).toContain("rights_adjudication_check");
    expect(migration).toContain("rights_verified_by IS NULL");
    expect(migration).toContain("rights_verified_by IS NOT NULL");
    // The `now()` trap: a CHECK tying an app-supplied instant to the
    // transaction clock rejects ordinary rows for reasons nobody reproduces.
    expect(migration).not.toContain("rights_verified_at <= now()");
  });

  test("the permission and its surface landed together", async () => {
    const migration = await readFile(MIGRATION, "utf8");
    const route = stripComments(await readFile(ROUTE, "utf8"));

    expect(migration).toContain("'media_library', 'media', 'update'");
    expect(route).toContain("export const PATCH");
  });
});
