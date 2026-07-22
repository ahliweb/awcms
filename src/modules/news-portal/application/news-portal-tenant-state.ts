/**
 * Tamper-proof per-tenant "has this tenant genuinely applied the
 * `news_portal_full_online_r2` preset" signal (Issue #636, migration
 * `043_awcms_news_portal_tenant_state_schema.sql`). See that
 * migration's header comment for the full story of why this needed to be
 * a brand-new, dedicated table rather than reusing
 * `awcms_tenant_modules`/`awcms_module_settings` (both were
 * tried, both failed — one silently useless, one silently exploitable).
 *
 * `markFullOnlineR2ModeApplied` is called ONLY from
 * `apply-news-portal-preset.ts` (the sanctioned entry point for this
 * preset) — no route/domain code anywhere else should import it. There is
 * deliberately no corresponding "unmark"/"clear" function and no HTTP
 * route exposes a write path to this table at all; the only way this
 * signal changes is by successfully re-running the preset activation.
 */

export async function markFullOnlineR2ModeApplied(
  tx: Bun.SQL,
  tenantId: string,
  appliedAt: Date = new Date()
): Promise<void> {
  await tx`
    INSERT INTO awcms_news_portal_tenant_state
      (tenant_id, full_online_r2_mode_applied_at, updated_at)
    VALUES (${tenantId}, ${appliedAt}, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      full_online_r2_mode_applied_at = ${appliedAt},
      updated_at = now()
  `;
}

/**
 * `true` only if this tenant has a row here at all — a tenant that never
 * had `markFullOnlineR2ModeApplied` called for it (the overwhelming
 * majority of tenants) has no row, fail-closed by construction.
 */
export async function isFullOnlineR2ModeAppliedForTenant(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT tenant_id FROM awcms_news_portal_tenant_state
    WHERE tenant_id = ${tenantId}
  `) as { tenant_id: string }[];

  return rows.length > 0;
}
