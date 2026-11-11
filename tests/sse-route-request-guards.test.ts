/**
 * The request guards both SSE seams apply BEFORE any work (Issue #1171,
 * ADR-0154 section 3; security audit L-1 and L-2): the Origin rule and Fetch
 * Metadata, on `GET /api/v1/push/stream` (`defineSseTenantRoute`) and on
 * `GET /api/v1/whatsapp/senders/{id}/progress/stream` (`defineProgressSseRoute`).
 *
 * No database: every request here carries NO tenant, so a request that passes
 * the guards stops at `400 TENANT_REQUIRED` — the proof that it got PAST them —
 * and a refused one stops at `403 ORIGIN_REFUSED` before reaching that check.
 *
 * Verified to go red when the check is removed: deleting the
 * `isStreamOriginAllowed` branch from `defineSseTenantRoute` turns the
 * "foreign" and "null" cases for push/stream from 403 into 400.
 */
import { describe, expect, test } from "bun:test";
import type { APIContext, APIRoute } from "astro";

import { GET as pushStream } from "../src/pages/api/v1/push/stream";
import { GET as progressStream } from "../src/pages/api/v1/whatsapp/senders/[id]/progress/stream";

const SITE = "https://app.example";

async function call(
  route: APIRoute,
  headers: Record<string, string>
): Promise<{ status: number; code: string | undefined }> {
  const url = new URL(
    `${SITE}/api/v1/whatsapp/senders/11111111-2222-4333-8444-555555555555/progress/stream`
  );
  const response = await route({
    request: new Request(url, { headers }),
    url,
    params: { id: "11111111-2222-4333-8444-555555555555" },
    locals: {},
    cookies: { get: () => undefined },
    clientAddress: "127.0.0.1"
  } as unknown as APIContext);
  const body = (await response.json()) as { error?: { code: string } };

  return { status: response.status, code: body.error?.code };
}

const ROUTES: [string, APIRoute][] = [
  ["push/stream (defineSseTenantRoute)", pushStream],
  ["whatsapp progress stream (defineProgressSseRoute)", progressStream]
];

for (const [name, route] of ROUTES) {
  describe(name, () => {
    test("a foreign Origin is refused before anything else", async () => {
      expect(await call(route, { origin: "https://evil.example" })).toEqual({
        status: 403,
        code: "ORIGIN_REFUSED"
      });
    });

    test("the literal `null` Origin is refused", async () => {
      expect(await call(route, { origin: "null" })).toEqual({
        status: 403,
        code: "ORIGIN_REFUSED"
      });
    });

    test("an absent Origin and the site's own Origin go on (to the tenant check)", async () => {
      expect((await call(route, {})).code).toBe("TENANT_REQUIRED");
      expect(
        (await call(route, { origin: SITE, host: "app.example" })).status
      ).not.toBe(403);
    });

    test("Sec-Fetch-Site: cross-site is refused; same-origin and same-site go on", async () => {
      expect(await call(route, { "sec-fetch-site": "cross-site" })).toEqual({
        status: 403,
        code: "ORIGIN_REFUSED"
      });
      expect(
        (await call(route, { "sec-fetch-site": "same-origin" })).code
      ).toBe("TENANT_REQUIRED");
      expect((await call(route, { "sec-fetch-site": "same-site" })).code).toBe(
        "TENANT_REQUIRED"
      );
    });

    test("Sec-Fetch-Mode: navigate is refused; cors (EventSource) goes on", async () => {
      expect(await call(route, { "sec-fetch-mode": "navigate" })).toEqual({
        status: 403,
        code: "ORIGIN_REFUSED"
      });
      expect((await call(route, { "sec-fetch-mode": "cors" })).code).toBe(
        "TENANT_REQUIRED"
      );
    });
  });
}
