/**
 * The inbox.status.progress contract text must match what the topic does
 * (Issue #1171 audit L-2) and the frame visibility is an intersection (L-1).
 * The topic's `resolveResource` ends a stream only when the inbox is switched
 * off, so a business scope lost mid-stream narrows later frames and never ends
 * it with `authorization-revoked`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { intersectVisibility } from "../src/modules/omnichannel-inbox/application/inbox-status-progress";

const read = (path: string) => readFileSync(path, "utf8");

describe("inbox.status.progress: contract text and visibility", () => {
  test("the stream route and OpenAPI do not claim a lost business scope or assignment ends the stream", () => {
    const route = read("src/pages/api/v1/omnichannel-inbox/progress/stream.ts");
    const spec = read("openapi/modules/omnichannel-inbox.openapi.yaml");

    expect(route).not.toMatch(
      /role, an assignment or a business scope removed mid-stream/
    );
    expect(spec).not.toMatch(
      /the role, the\s+assignment, the business scope or the session ended/
    );
    expect(route).toContain("does NOT end it");
    expect(spec).toContain("does NOT end the stream");
  });

  test("the stream route's cost comment does not claim one guard chain per tick for confined callers", () => {
    const route = read("src/pages/api/v1/omnichannel-inbox/progress/stream.ts");

    expect(route).not.toContain("plus three indexed reads per tick");
    expect(route).toContain("UNLOGGED");
  });

  test("intersectVisibility: unconfined only when both are; otherwise the shared keys", () => {
    const wide = { unconfined: true } as const;
    const ab = { unconfined: false, scopeKeys: ["office:a", "office:b"] };
    const b = { unconfined: false, scopeKeys: ["office:b"] };
    const none = { unconfined: false, scopeKeys: [] };

    expect(intersectVisibility(wide, wide)).toEqual({ unconfined: true });
    expect(intersectVisibility(wide, ab)).toEqual(ab);
    expect(intersectVisibility(ab, wide)).toEqual(ab);
    expect(intersectVisibility(ab, b)).toEqual(b);
    expect(intersectVisibility(ab, none)).toEqual(none);
  });
});
