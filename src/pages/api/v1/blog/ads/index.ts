import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { listAds } from "../../../../../modules/blog-content/application/ads-directory";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ads",
  action: "read" as const
};

/** `GET /api/v1/blog/ads` (Issue #542) — list this tenant's non-deleted ads. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const ads = await listAds(tx, tenantId);

    return ok({ ads });
  });
};

/**
 * `POST /api/v1/blog/ads` — **retired** (ADR-0044 §4 Fase 2, step three).
 *
 * This endpoint created an advertisement from a free-text `imageUrl`: any URL
 * an admin typed, stored verbatim and rendered into an `<img src>` on a public
 * page. That is the managed-media bypass ADR-0036 inverted media ownership to
 * close, and it is the reason the merged module keeps only the media-backed
 * advertisement system.
 *
 * It is closed BEFORE the tables are dropped, not with them, and the ordering
 * is the point: the ingest job (`bun run blog:ads:ingest`) moves what exists at
 * the moment it runs. Leaving this open would let an editor create a free-URL
 * ad in the window between the ingest and the drop — an ad that migrates
 * nowhere and disappears when the table goes, with nothing in any report saying
 * it ever existed.
 *
 * `GET` and `DELETE` deliberately survive. An operator has to be able to read
 * the residue report's rows and retire the ones they do not want to re-create;
 * removing the read path would leave them resolving a report against data they
 * can no longer see.
 *
 * 410 rather than 404: the resource existed, its absence is permanent, and the
 * successor is named in the message. Deliberately answered before any auth or
 * database work — there is nothing left here to authorize.
 */
export const POST: APIRoute = async () =>
  fail(
    410,
    "ENDPOINT_RETIRED",
    "Free-URL advertisements are retired (ADR-0044). Upload the image through the media library, then create the advertisement via POST /api/v1/news-portal/ad-placements, which requires a verified media object instead of an arbitrary URL."
  );
