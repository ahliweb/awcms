import { describe, expect, test } from "bun:test";

import { DELETE, PATCH } from "../src/pages/api/v1/blog/ads/[id]";
import { GET, POST } from "../src/pages/api/v1/blog/ads/index";

/**
 * ADR-0044 §4 Fase 2, step three: the free-URL advertisement WRITE path is
 * closed before the tables are dropped, not with them.
 *
 * `awcms_blog_ads.image_url` is free text rendered straight into a public
 * `<img src>`. That is the managed-media bypass ADR-0036 inverted media
 * ownership to close, and it stays open for as long as any route can write it.
 *
 * The ordering is the substance of this change. The ingest job moves what
 * exists at the moment it runs; an open write path lets an editor create a
 * free-URL ad in the window between the ingest and the drop — an ad that
 * migrates nowhere and disappears when the table goes, with nothing in any
 * report saying it existed.
 *
 * Both handlers answer before any auth or database work, which is what makes
 * them testable here with a bare `Request` and no harness at all. That is a
 * property worth pinning: if either ever starts touching the database, this
 * file stops compiling into a meaningful test and someone has to look.
 */
function retiredRequest(method: string): Request {
  return new Request("https://example.test/api/v1/blog/ads", { method });
}

async function callRetired(
  handler: typeof POST,
  method: string
): Promise<Response> {
  // Cast: these handlers ignore every argument by construction. Passing an
  // empty context is the assertion, not a shortcut — a handler that reads
  // `cookies` or `params` would throw here rather than quietly pass.
  return (await handler({
    request: retiredRequest(method)
  } as unknown as Parameters<typeof POST>[0])) as Response;
}

describe("ADR-0044 §4 — the free-URL advertisement write path is retired", () => {
  test("POST /api/v1/blog/ads is 410 Gone", async () => {
    const response = await callRetired(POST, "POST");

    // 410, not 404: the resource existed and its absence is permanent. A 404
    // would read as "wrong URL" and send an integrator looking for a typo.
    expect(response.status).toBe(410);

    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ENDPOINT_RETIRED");
    // The successor is named, or the caller is stuck.
    expect(body.error.message).toContain("/api/v1/news-portal/ad-placements");
  });

  test("PATCH /api/v1/blog/ads/{id} is 410 Gone", async () => {
    // Closing POST alone would not have been enough: PATCH could rewrite
    // `imageUrl` on an existing ad, which is the same bypass by a quieter
    // route — and one that creates no new row for anyone to notice.
    const response = await callRetired(
      PATCH as unknown as typeof POST,
      "PATCH"
    );

    expect(response.status).toBe(410);

    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(body.error.code).toBe("ENDPOINT_RETIRED");
    expect(body.error.message).toContain("/api/v1/news-portal/ad-placements");
  });

  test("neither retired handler touches auth or the database", async () => {
    // A `Request` and nothing else. `resolveAuthInputs` needs `cookies`,
    // `getDatabaseClient` needs configuration, and `params.id` is read by the
    // real DELETE handler — if a retired handler reached any of them it would
    // throw rather than return, and this would fail.
    for (const [handler, method] of [
      [POST, "POST"],
      [PATCH as unknown as typeof POST, "PATCH"]
    ] as const) {
      const response = await callRetired(handler, method);
      expect(response.status).toBe(410);
    }
  });

  test("GET and DELETE survive, so residue stays resolvable", () => {
    // An operator resolving the ingest's residue report has to be able to read
    // the rows it names, and to retire the ones they do not want to re-create.
    // Removing the read path would leave them resolving a report against data
    // they can no longer see; removing DELETE would leave "I do not want this
    // ad" with no way to say so, and `blog:ads:drop-readiness` counts a
    // soft-deleted ad as accounted for.
    expect(typeof GET).toBe("function");
    expect(typeof DELETE).toBe("function");
  });
});
