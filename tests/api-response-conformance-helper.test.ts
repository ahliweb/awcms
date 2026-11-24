/**
 * The assertion helper behind the provider-side conformance tests (#1393) must
 * itself turn red when it should. These cases need no database: they feed
 * deliberately wrong answers through the SAME `assertResponseConforms` the
 * integration tests use.
 */
import { describe, expect, test } from "bun:test";

import { assertResponseConforms } from "./support/contract-conformance";

const NEUTRAL = {
  success: true,
  data: {
    message:
      "If that address can be subscribed, a confirmation email is on its way."
  },
  meta: {}
};

describe("assertResponseConforms", () => {
  test("accepts a declared status with a conforming body", () => {
    expect(() =>
      assertResponseConforms("post", "/api/v1/newsletter/subscribe", {
        status: 200,
        body: NEUTRAL
      })
    ).not.toThrow();
  });

  test("a status the operation does not declare is a failure", () => {
    // `202` is the drift #1379/R5 describes: documented one way, answered another.
    expect(() =>
      assertResponseConforms("post", "/api/v1/newsletter/subscribe", {
        status: 202,
        body: NEUTRAL
      })
    ).toThrow(/does not declare/);
  });

  test("a body missing a required field is a failure", () => {
    expect(() =>
      assertResponseConforms("post", "/api/v1/newsletter/subscribe", {
        status: 200,
        body: { success: true, meta: {} }
      })
    ).toThrow(/does not conform/);
  });

  test("a property the schema forbids is a failure", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      title: "t",
      slug: "t",
      status: "draft",
      visibility: "public",
      locale: "id",
      publishedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z"
    };
    expect(() =>
      assertResponseConforms("get", "/api/v1/blog/posts", {
        status: 200,
        body: { success: true, data: { posts: [row] } }
      })
    ).not.toThrow();
    expect(() =>
      assertResponseConforms("get", "/api/v1/blog/posts", {
        status: 200,
        body: {
          success: true,
          data: { posts: [{ ...row, contentJson: { leaked: true } }] }
        }
      })
    ).toThrow(/does not conform/);
  });

  test("an unknown operation is a failure, not a pass", () => {
    expect(() =>
      assertResponseConforms("get", "/api/v1/not-in-the-contract", {
        status: 200,
        body: {}
      })
    ).toThrow(/not an operation/);
  });
});
