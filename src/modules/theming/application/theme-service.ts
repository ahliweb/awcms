/**
 * Theme lifecycle orchestration (Issue #269, ADR-0029 §4/§8): save draft →
 * publish → rollback → retire, plus preview-session creation. Each mutating
 * operation records an audit event through an INJECTED hook (the route wires
 * `recordAuditEvent`; tests pass a spy) so this service stays testable without
 * the whole logging module and the route composition root remains the single
 * place cross-module wiring happens (the same injected-audit-hook convention
 * every high-risk service in this base uses).
 *
 * Every function runs inside the caller's tenant transaction (`withTenant`), so
 * the state change and its audit row commit atomically. Published versions are
 * IMMUTABLE — publish INSERTs a new version, rollback/retire only move the active
 * pointer (`awcms_theming_tenant_state`), never touching a version row.
 */
import { computeRequestHash } from "../../_shared/idempotency";
import type { ThemeConfig } from "../domain/theme-config";
import type { ThemeDescriptor } from "../domain/theme-descriptor";
import { isValidRollbackTarget } from "../domain/theme-lifecycle";
import {
  fetchDraftVersion,
  fetchThemeTenantState,
  fetchVersionById,
  insertPublishedVersion,
  listPublishedVersionIds,
  nextPublishedVersionNumber,
  setActiveThemeVersion,
  setDraftThemeKey,
  upsertDraftVersion,
  type ThemeConfigVersion
} from "./theme-config-directory";

export type ThemeAuditHook = (
  tx: Bun.SQL,
  detail: {
    action: string;
    resourceType: string;
    resourceId: string;
    attributes: Record<string, unknown>;
  }
) => Promise<void>;

/** Canonical config hash — the idempotent-replay / change-detection fingerprint. */
export function hashThemeConfig(themeKey: string, config: ThemeConfig): string {
  return computeRequestHash({ themeKey, config });
}

/**
 * Save/replace the tenant's single draft config for a chosen theme (the
 * validated `ThemeConfig` is produced by the route via `validateThemeConfig`).
 * Audited (high-risk: the draft is what a subsequent publish promotes).
 */
export async function saveThemeDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  descriptor: ThemeDescriptor,
  config: ThemeConfig,
  recordAudit: ThemeAuditHook
): Promise<ThemeConfigVersion> {
  const configHash = hashThemeConfig(descriptor.themeKey, config);
  const draft = await upsertDraftVersion(
    tx,
    tenantId,
    actorTenantUserId,
    descriptor.themeKey,
    descriptor.version,
    config,
    configHash
  );
  await setDraftThemeKey(tx, tenantId, actorTenantUserId, descriptor.themeKey);
  await recordAudit(tx, {
    action: "theming.config.update",
    resourceType: "theming_draft",
    resourceId: draft.id,
    attributes: { themeKey: descriptor.themeKey, configHash }
  });
  return draft;
}

export type PublishResult =
  | { ok: true; version: ThemeConfigVersion }
  | { ok: false; code: "NO_DRAFT"; message: string };

/**
 * Publish the current draft as a new IMMUTABLE version and make it the tenant's
 * active/live look. INSERT-only (never mutates a published row); the version
 * number comes from `nextPublishedVersionNumber` and the sql/033 partial unique
 * index turns a concurrent double-publish into a rejection on one of them.
 */
export async function publishThemeDraft(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  recordAudit: ThemeAuditHook
): Promise<PublishResult> {
  const draft = await fetchDraftVersion(tx, tenantId);
  if (!draft) {
    return {
      ok: false,
      code: "NO_DRAFT",
      message: "No draft theme config to publish."
    };
  }
  const versionNumber = await nextPublishedVersionNumber(tx, tenantId);
  const published = await insertPublishedVersion(
    tx,
    tenantId,
    actorTenantUserId,
    draft.themeKey,
    draft.themeVersion,
    draft.config,
    draft.configHash,
    versionNumber
  );
  await setActiveThemeVersion(
    tx,
    tenantId,
    actorTenantUserId,
    published.themeKey,
    published.id
  );
  await recordAudit(tx, {
    action: "theming.version.publish",
    resourceType: "theming_version",
    resourceId: published.id,
    attributes: {
      themeKey: published.themeKey,
      versionNumber,
      configHash: published.configHash
    }
  });
  return { ok: true, version: published };
}

export type RollbackResult =
  | { ok: true; version: ThemeConfigVersion }
  | { ok: false; code: "INVALID_TARGET"; message: string };

/**
 * Roll the active pointer back to an earlier published version (never mutates a
 * version row). The target must be one of THIS tenant's own published version
 * ids (RLS + the explicit set check).
 */
export async function rollbackThemeVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  targetVersionId: string,
  recordAudit: ThemeAuditHook
): Promise<RollbackResult> {
  const publishedIds = await listPublishedVersionIds(tx, tenantId);
  if (!isValidRollbackTarget(targetVersionId, publishedIds)) {
    return {
      ok: false,
      code: "INVALID_TARGET",
      message: "Rollback target is not a published version of this tenant."
    };
  }
  const target = await fetchVersionById(tx, tenantId, targetVersionId);
  // Non-null by construction (id is in the published set), but stay fail-closed.
  if (!target || target.status !== "published") {
    return {
      ok: false,
      code: "INVALID_TARGET",
      message: "Rollback target is not a published version of this tenant."
    };
  }
  await setActiveThemeVersion(
    tx,
    tenantId,
    actorTenantUserId,
    target.themeKey,
    target.id
  );
  await recordAudit(tx, {
    action: "theming.version.restore",
    resourceType: "theming_version",
    resourceId: target.id,
    attributes: {
      themeKey: target.themeKey,
      versionNumber: target.versionNumber
    }
  });
  return { ok: true, version: target };
}

/** Retire the active theme: clear the active pointer so the site falls back to the default. Audited. */
export async function retireActiveTheme(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  recordAudit: ThemeAuditHook
): Promise<{ previousThemeKey: string | null }> {
  const state = await fetchThemeTenantState(tx, tenantId);
  await setActiveThemeVersion(tx, tenantId, actorTenantUserId, null, null);
  await recordAudit(tx, {
    action: "theming.version.archive",
    resourceType: "theming_state",
    resourceId: tenantId,
    attributes: { previousThemeKey: state.activeThemeKey }
  });
  return { previousThemeKey: state.activeThemeKey };
}
