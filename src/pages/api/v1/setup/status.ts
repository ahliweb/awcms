import type { APIRoute } from "astro";

import { ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";

export const GET: APIRoute = async () => {
  const sql = getDatabaseClient();
  const rows =
    await sql`SELECT tenant_id, locked_at FROM awcms_setup_state WHERE id = true`;
  const state = rows[0] as
    { tenant_id: string | null; locked_at: Date | null } | undefined;

  if (!state || !state.locked_at) {
    return ok({ locked: false });
  }

  return ok({
    locked: true,
    tenantId: state.tenant_id ?? undefined,
    lockedAt: state.locked_at.toISOString()
  });
};
