/**
 * The tenant-level switch and the gate that combines it with Module Management
 * (Issue #965, ADR-0140 section 2, level 2 of 3).
 *
 * A tenant sends nothing until BOTH hold: the module is enabled for it in
 * Module Management (no row means "never toggled": enabled) AND an
 * administrator holding the high-risk `settings.configure` has turned the
 * setting on. Off is the default, and turning it off revokes every binding in the
 * same transaction: a tenant that switches Telegram off must not be left holding
 * encrypted chat ids for a channel it no longer uses.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { TELEGRAM_MODULE_KEY } from "../domain/telegram-constants";
import { auditEndedBindings, endBindings } from "./telegram-bindings";

export type TelegramTenantGate = {
  settingEnabled: boolean;
  moduleEnabled: boolean;
  /** False when the tenant itself is `inactive` or `suspended` (audit N4). Always true on the request path, which only serves active tenants. */
  tenantActive?: boolean;
};

/** For the request path (`awcms_app`, which can read the module registry directly). */
export async function readTelegramTenantGate(
  tx: Bun.SQL,
  tenantId: string
): Promise<TelegramTenantGate> {
  const rows = (await tx`
    SELECT
      COALESCE((SELECT enabled FROM awcms_telegram_settings
                WHERE tenant_id = ${tenantId}), false) AS setting_enabled,
      COALESCE((SELECT enabled FROM awcms_tenant_modules
                WHERE tenant_id = ${tenantId}
                  AND module_key = ${TELEGRAM_MODULE_KEY}), true) AS module_enabled
  `) as { setting_enabled: boolean; module_enabled: boolean }[];

  return {
    settingEnabled: rows[0]?.setting_enabled === true,
    moduleEnabled: rows[0]?.module_enabled !== false
  };
}

/**
 * For the dispatcher (`awcms_worker`, which holds no privilege on the module
 * registry): the module answer comes from the narrow `sql/217` function.
 */
export async function readTelegramTenantGateForWorker(
  tx: Bun.SQL,
  tenantId: string
): Promise<TelegramTenantGate> {
  const rows = (await tx`
    SELECT
      COALESCE((SELECT enabled FROM awcms_telegram_settings
                WHERE tenant_id = ${tenantId}), false) AS setting_enabled,
      awcms_telegram_module_enabled(${tenantId}::uuid) AS module_enabled,
      COALESCE((SELECT status = 'active' FROM awcms_tenants
                WHERE id = ${tenantId}), false) AS tenant_active
  `) as {
    setting_enabled: boolean;
    module_enabled: boolean;
    tenant_active: boolean;
  }[];

  return {
    settingEnabled: rows[0]?.setting_enabled === true,
    moduleEnabled: rows[0]?.module_enabled !== false,
    tenantActive: rows[0]?.tenant_active === true
  };
}

export function isTenantGateOpen(gate: TelegramTenantGate): boolean {
  return (
    gate.settingEnabled && gate.moduleEnabled && gate.tenantActive !== false
  );
}

export type TelegramSettingsView = {
  enabled: boolean;
  updatedAt: string | null;
};

export async function getTelegramSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<TelegramSettingsView> {
  const rows = (await tx`
    SELECT enabled, updated_at FROM awcms_telegram_settings
    WHERE tenant_id = ${tenantId}
  `) as { enabled: boolean; updated_at: Date | string }[];

  const row = rows[0];

  return {
    enabled: row?.enabled === true,
    updatedAt: row
      ? row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
      : null
  };
}

export type SetTelegramEnabledResult = {
  previous: boolean;
  enabled: boolean;
  changed: boolean;
  revokedBindings: number;
  cancelledMessages: number;
};

/**
 * Upserts the switch and audits the change. Turning it OFF ends every live
 * binding (cause `tenant_disabled`), erasing the stored chat ids and cancelling
 * what is queued, in the same transaction. Idempotent: setting the value it
 * already has changes nothing and writes no audit row.
 */
export async function setTelegramEnabled(
  tx: Bun.SQL,
  tenantId: string,
  enabled: boolean,
  actorTenantUserId: string,
  context: { correlationId?: string } = {}
): Promise<SetTelegramEnabledResult> {
  const previousRows = (await tx`
    SELECT enabled FROM awcms_telegram_settings
    WHERE tenant_id = ${tenantId} FOR UPDATE
  `) as { enabled: boolean }[];
  const previous = previousRows[0]?.enabled === true;

  await tx`
    INSERT INTO awcms_telegram_settings (tenant_id, enabled, updated_by)
    VALUES (${tenantId}, ${enabled}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by,
        updated_at = now()
  `;

  const changed = previous !== enabled;
  let revokedBindings = 0;
  let cancelledMessages = 0;

  if (!enabled) {
    const ended = await endBindings(
      tx,
      tenantId,
      { all: true },
      "tenant_disabled",
      {
        actorTenantUserId
      }
    );

    await auditEndedBindings(tx, tenantId, ended, "tenant_disabled", {
      actorTenantUserId,
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });

    revokedBindings = ended.ended.length;
    cancelledMessages = ended.cancelledMessages;
  }

  if (changed) {
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId,
      moduleKey: TELEGRAM_MODULE_KEY,
      action: "telegram_setting.changed",
      resourceType: "telegram_settings",
      resourceId: tenantId,
      severity: "warning",
      message: `Telegram delivery turned ${enabled ? "on" : "off"} for this tenant.`,
      attributes: {
        enabled,
        previous,
        revokedBindings,
        cancelledMessages
      },
      ...(context.correlationId ? { correlationId: context.correlationId } : {})
    });
  }

  return { previous, enabled, changed, revokedBindings, cancelledMessages };
}
