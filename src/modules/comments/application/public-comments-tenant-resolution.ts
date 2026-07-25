/**
 * Public tenant resolution + module-enablement gate for the public comment
 * surfaces (`POST/GET /api/v1/comments`, replies, report, edit) — ADR-0041 §5,
 * ported from awcms-micro Issue #271. Mirrors `site_search`'s `withSiteSearchTenant` exactly (which in turn mirrors
 * `seo_distribution`'s `withSeoPublicTenant`): resolve the
 * tenant from the request host (`resolvePublicTenantFromRequest`), then confirm
 * `comments` is enabled for that tenant before running the handler. Every
 * non-resolving case collapses to the same generic `null` (mapped to a neutral
 * response by the caller — never leak WHY), cost-normalized against a timing
 * side-channel.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import type { CommentSettings } from "../domain/comment-settings";
import { COMMENTS_MODULE_KEY } from "../domain/comments-permissions";
import { fetchCommentSettings } from "./comment-settings-directory";

export type CommentsTenantHandler<T> = (
  tx: Bun.TransactionSQL,
  tenant: PublicTenantResolution,
  settings: CommentSettings
) => Promise<T>;

const TIMING_PAD_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export function buildPublicHostResolverConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PublicHostResolverConfig {
  return {
    mode: env.PUBLIC_TENANT_RESOLUTION_MODE,
    trustProxy: env.PUBLIC_TRUST_PROXY === "true"
  };
}

async function checkCommentsGate(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<{ enabled: boolean; settings: CommentSettings }> {
  const entry = await fetchTenantModuleEntry(tx, tenantId, COMMENTS_MODULE_KEY);
  const settings = await fetchCommentSettings(tx, tenantId);
  return {
    // Fail-closed: a missing entry is disabled. Also honor the tenant's own
    // policy: `disabled` mode means no public comment surface.
    enabled:
      (entry?.tenantEnabled ?? false) &&
      settings.defaultPolicyMode !== "disabled",
    settings
  };
}

export async function padUnresolvedCommentsTenantLatency(
  sql: Bun.SQL,
  _env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await withTenant(sql, TIMING_PAD_TENANT_ID, async (tx) => {
    await checkCommentsGate(tx, TIMING_PAD_TENANT_ID);
  });
}

/**
 * Resolve the public tenant for a comment request and, only if resolved +
 * enabled, open a tenant-scoped transaction and run `handler` with the tenant's
 * comment settings. Returns `null` for every non-resolving/disabled case.
 */
export async function withCommentsTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: CommentsTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T | null> {
  const config = buildPublicHostResolverConfigFromEnv(env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);

  if (!tenant) {
    await padUnresolvedCommentsTenantLatency(sql, env);
    return null;
  }

  return withTenant(sql, tenant.tenantId, async (tx) => {
    const { enabled, settings } = await checkCommentsGate(tx, tenant.tenantId);
    if (!enabled) return null;
    return handler(tx, tenant, settings);
  });
}
