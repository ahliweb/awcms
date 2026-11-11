/**
 * Audit H-1 of PR #1260 (Issue #1156): a public OpenAPI operation that takes a
 * body is unreachable unless the middleware's `SESSION_FREE_BODY_ENDPOINTS`
 * exempts it, and a handler-level test never notices. This pins the structural
 * gate in `api:spec:check` both ways and proves it goes RED when an exemption
 * is removed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

import {
  collectSessionFreeBodyParityProblems,
  SESSION_FREE_NON_PUBLIC_OPERATIONS
} from "../scripts/api-spec-check";
import {
  requiresAuthenticatedCallerBeforeBody,
  SESSION_FREE_BODY_ENDPOINTS
} from "../src/lib/security/api-body-auth-boundary";

const doc = parse(
  readFileSync("openapi/awcms-public-api.openapi.yaml", "utf8")
) as Parameters<typeof collectSessionFreeBodyParityProblems>[0];

describe("public body operations and the session-free boundary (H-1)", () => {
  test("the real contract and the real boundary agree", () => {
    expect(collectSessionFreeBodyParityProblems(doc)).toEqual([]);
  });

  test("removing the customer Telegram webhook exemption turns the gate red", () => {
    const without = SESSION_FREE_BODY_ENDPOINTS.filter(
      (endpoint) =>
        endpoint.pattern !==
        "/api/v1/telegram-engagement/webhooks/:callbackToken"
    );
    const problems = collectSessionFreeBodyParityProblems(doc, without);

    expect(problems.length).toBe(1);
    expect(problems[0]).toContain(
      "/api/v1/telegram-engagement/webhooks/{callbackToken}"
    );
  });

  test("removing ANY public body exemption turns the gate red", () => {
    const publicOnes = SESSION_FREE_BODY_ENDPOINTS.filter(
      (endpoint) =>
        !Object.keys(SESSION_FREE_NON_PUBLIC_OPERATIONS).some((key) =>
          key.startsWith(
            `${endpoint.method} ${endpoint.pattern.split("/:")[0]}`
          )
        )
    );

    expect(publicOnes.length).toBeGreaterThan(10);

    for (const removed of publicOnes) {
      const problems = collectSessionFreeBodyParityProblems(
        doc,
        SESSION_FREE_BODY_ENDPOINTS.filter((endpoint) => endpoint !== removed)
      );

      expect(problems.length, removed.pattern).toBeGreaterThan(0);
    }
  });

  test("an exemption with no public operation behind it is refused", () => {
    const problems = collectSessionFreeBodyParityProblems(doc, [
      ...SESSION_FREE_BODY_ENDPOINTS,
      { method: "POST", pattern: "/api/v1/nowhere/:id", reason: "test" }
    ]);

    expect(
      problems.some((problem) => problem.includes("/api/v1/nowhere/:_"))
    ).toBe(true);
  });

  test("Telegram's real webhook path passes the boundary without a session", () => {
    const path = `/api/v1/telegram-engagement/webhooks/tge1.${crypto.randomUUID()}.${crypto.randomUUID()}.${"a".repeat(43)}`;

    expect(requiresAuthenticatedCallerBeforeBody("POST", path)).toBe(false);
    expect(requiresAuthenticatedCallerBeforeBody("POST", `${path}/`)).toBe(
      false
    );
    // Only that shape: a deeper path is still gated.
    expect(requiresAuthenticatedCallerBeforeBody("POST", `${path}/extra`)).toBe(
      true
    );
    expect(
      requiresAuthenticatedCallerBeforeBody(
        "POST",
        "/api/v1/telegram-engagement/bots"
      )
    ).toBe(true);
  });
});
