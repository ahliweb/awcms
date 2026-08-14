/**
 * The ONLY module that reads or writes `awcms_principal_preferences`
 * (ADR-0095, sql/128).
 *
 * ## Why a single store module, when this table holds nothing secret
 *
 * `awcms_principal_preferences` is GLOBAL and has no RLS, exactly like
 * `awcms_principals` and `awcms_principal_mfa_factors`. For those two,
 * `bun run identity:principal-access:check` enforces a per-file allow-list
 * because the rows are a credential and a targeting list. This table is neither
 * — it holds the string `"id"` — so widening that gate to cover it would blur
 * what the gate is actually protecting (ADR-0095 §"Keputusan 1" states this
 * explicitly).
 *
 * The confinement is kept anyway, as a convention rather than a gate, for the
 * reason that outlives the security argument: a table with no RLS has no
 * database-side answer to "which rows may this caller see", so the ONLY place
 * that answer can be written down is the query. Every query below is keyed by
 * `principal_id` and returns at most one row. Nothing here scans, and nothing
 * here takes a `LIKE`.
 *
 * ## Reads never throw
 *
 * A display preference is chrome. `readPreferences` degrades to "no opinion" on
 * any fault, so a hiccup reading this table renders the admin in the fallback
 * language instead of 500-ing the page. Writes are the opposite: an account
 * screen that reports success without persisting is worse than an error.
 */
import type { SQL } from "bun";

import { coerceLocale } from "../../../lib/i18n/negotiate";
import type { Locale } from "../../../lib/i18n/locales";

/** The theme vocabulary, matching `ThemeToggle`'s cycle and sql/128's CHECK. */
export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

/**
 * Coerces an untrusted theme value, mirroring `coerceLocale`. `null` means "not
 * chosen", which is a real state in sql/128 and distinct from choosing
 * `"system"`: the former falls through to the tenant default, the latter is an
 * explicit decision to follow the operating system.
 */
export function coerceThemeMode(value: unknown): ThemeMode | null {
  return isThemeMode(value) ? value : null;
}

export interface PrincipalPreferences {
  readonly locale: Locale | null;
  readonly theme: ThemeMode | null;
}

/** "No opinion on either axis" — the value every failure path returns. */
export const NO_PREFERENCES: PrincipalPreferences = {
  locale: null,
  theme: null
};

interface PreferenceRow {
  locale: string | null;
  theme: string | null;
}

/**
 * Reads one principal's preferences. Never throws; never returns null.
 *
 * `principalId` may be null because `awcms_identities.principal_id` is nullable
 * by design (sql/112 §3 — an identity created by a path not yet taught about
 * principals must be visibly unlinked rather than a 500). Such an identity
 * simply has no preferences, which this models as `NO_PREFERENCES` rather than
 * as an error.
 */
export async function readPreferences(
  tx: SQL,
  principalId: string | null
): Promise<PrincipalPreferences> {
  if (!principalId) return NO_PREFERENCES;

  try {
    const rows = (await tx`
      SELECT locale, theme
      FROM awcms_principal_preferences
      WHERE principal_id = ${principalId}
    `) as PreferenceRow[];

    const row = rows[0];

    if (!row) return NO_PREFERENCES;

    // Coerced on the way OUT, not trusted because the CHECK constraint exists.
    // The constraint bounds what can be WRITTEN; a value written under an older
    // build whose locale list has since shrunk is still in the column, and it
    // must read as "no opinion" rather than select a catalog that is gone.
    return {
      locale: coerceLocale(row.locale),
      theme: coerceThemeMode(row.theme)
    };
  } catch {
    return NO_PREFERENCES;
  }
}

/**
 * Resolves the principal behind a tenant identity, for the preference lookup.
 *
 * Keyed on `(tenant_id, id)` — `awcms_identities` is tenant-scoped and under
 * FORCE RLS, so the tenant predicate is belt-and-braces rather than the sole
 * control, per this repo's convention of never leaning on RLS alone in an
 * explicit query.
 */
export async function resolvePrincipalIdForIdentity(
  tx: SQL,
  tenantId: string,
  identityId: string
): Promise<string | null> {
  try {
    const rows = (await tx`
      SELECT principal_id
      FROM awcms_identities
      WHERE tenant_id = ${tenantId} AND id = ${identityId}
    `) as Array<{ principal_id: string | null }>;

    return rows[0]?.principal_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Upserts a principal's preferences.
 *
 * Both fields are written on every call, so passing `null` for one is how a
 * reader RESETS that axis to "not chosen" (sql/128 withholds DELETE precisely so
 * this is the only way to express it).
 *
 * `ON CONFLICT` here is the reason sql/128 grants SELECT alongside INSERT: the
 * conflict target has to be read to be resolved, and `GRANT INSERT` alone fails
 * at runtime with `permission denied` while every migration and CI run stays
 * green. This repo has already paid for that once (sql/127).
 *
 * Unlike the reads above, this propagates its error. A preference screen that
 * says "saved" without saving trains its user to distrust the whole surface.
 */
export async function writePreferences(
  tx: SQL,
  principalId: string,
  preferences: PrincipalPreferences
): Promise<void> {
  await tx`
    INSERT INTO awcms_principal_preferences (principal_id, locale, theme)
    VALUES (${principalId}, ${preferences.locale}, ${preferences.theme})
    ON CONFLICT (principal_id) DO UPDATE
      SET locale = EXCLUDED.locale,
          theme = EXCLUDED.theme,
          updated_at = now()
  `;
}
