import { describe, expect, test } from "bun:test";

import { validateAnnouncementInput } from "../src/modules/email/domain/announcement-validation";

const VALID_USER_ID = "11111111-1111-1111-1111-111111111111";
const VALID_ROLE_ID = "22222222-2222-2222-2222-222222222222";

describe("validateAnnouncementInput", () => {
  test("accepts a tenant-wide announcement", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: { title: "Hi", body: "Body", actionUrl: "https://x" },
      target: { type: "tenant" }
    });

    expect(result.valid).toBe(true);
  });

  test("accepts a role-targeted announcement", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.maintenance",
      variables: {},
      target: { type: "role", roleId: VALID_ROLE_ID }
    });

    expect(result.valid).toBe(true);
  });

  test("accepts an explicit-users notification", () => {
    const result = validateAnnouncementInput({
      templateKey: "workflow.task_assigned",
      variables: {},
      target: { type: "users", userIds: [VALID_USER_ID] }
    });

    expect(result.valid).toBe(true);
  });

  test("rejects an unrecognized templateKey", () => {
    const result = validateAnnouncementInput({
      templateKey: "not.a.category",
      variables: {},
      target: { type: "tenant" }
    });

    expect(result.valid).toBe(false);
  });

  test("rejects target.type = role without a valid roleId", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: {},
      target: { type: "role", roleId: "not-a-uuid" }
    });

    expect(result.valid).toBe(false);
  });

  test("rejects target.type = users with an empty userIds array", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: {},
      target: { type: "users", userIds: [] }
    });

    expect(result.valid).toBe(false);
  });

  test("rejects target.type = users with a non-UUID entry", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: {},
      target: { type: "users", userIds: ["not-a-uuid"] }
    });

    expect(result.valid).toBe(false);
  });

  test("rejects an unrecognized target.type", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: {},
      target: { type: "everyone" }
    });

    expect(result.valid).toBe(false);
  });

  test("rejects a missing target", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: {}
    });

    expect(result.valid).toBe(false);
  });

  test("rejects non-string variable values", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      variables: { title: 123 },
      target: { type: "tenant" }
    });

    expect(result.valid).toBe(false);
  });

  test("defaults variables to an empty object when omitted", () => {
    const result = validateAnnouncementInput({
      templateKey: "system.announcement",
      target: { type: "tenant" }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.variables).toEqual({});
    }
  });
});
