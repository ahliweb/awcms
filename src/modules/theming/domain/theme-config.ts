/**
 * Tenant theme configuration (Issue #269, ADR-0029 §4) — the DATA-ONLY shape a
 * tenant may set for a chosen theme, plus its validation against the theme
 * descriptor and its safe serialization into a `text/css` custom-property
 * stylesheet. Pure, no I/O.
 *
 * A `ThemeConfig` is the ONLY tenant-authored input in this module. It carries
 * no code, no template, no raw CSS/HTML/JS — only: token value overrides
 * (validated per token kind by `css-value-validation.ts`), slot variant
 * selections (from the descriptor's allow-list), media asset ids (UUIDs,
 * resolved same-tenant/verified by a media module at render time — a no-op in
 * this base until such a module is ported, ADR-0034 Fase 3), a content
 * section ordering (a permutation of declared sections), and a nav placement
 * (from the descriptor's allow-list). Anything not declared by the descriptor
 * is REJECTED — the descriptor bounds the whole configurable surface.
 */
import {
  CssValueError,
  validateColorValue,
  validateDimensionValue,
  validateFontStack,
  validateNumberValue
} from "./css-value-validation";
import type { ThemeDescriptor, ThemeTokenSpec } from "./theme-descriptor";

/** The `--awcms-theme-` prefix every emitted design-token custom property carries. */
export const THEME_CSS_CUSTOM_PROPERTY_PREFIX = "--awcms-theme-";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ThemeConfig = {
  themeKey: string;
  /** tokenKey -> validated token value. Only declared tokens; missing tokens fall back to descriptor defaults. */
  tokenOverrides: Record<string, string>;
  /** slotKey -> chosen variant key (from the slot's allow-list). */
  slotSelections: Record<string, string>;
  /** assetSlotKey -> media object UUID. */
  assetRefs: Record<string, string>;
  /** An ordering (permutation/subset) of the descriptor's contentSections keys. */
  sectionOrder: string[];
  /** One of the descriptor's navPlacements. */
  navPlacement: string;
};

export type ThemeConfigValidationError = { field: string; message: string };

export type ThemeConfigValidationResult =
  | { ok: true; value: ThemeConfig }
  | { ok: false; errors: ThemeConfigValidationError[] };

/** The neutral config for a descriptor: every token/slot/nav at its default, no overrides/assets. */
export function defaultThemeConfig(descriptor: ThemeDescriptor): ThemeConfig {
  return {
    themeKey: descriptor.themeKey,
    tokenOverrides: {},
    slotSelections: Object.fromEntries(
      descriptor.slots.map((slot) => [slot.key, slot.default])
    ),
    assetRefs: {},
    sectionOrder: descriptor.contentSections.map((section) => section.key),
    navPlacement: descriptor.navPlacements[0] ?? "top"
  };
}

/**
 * Validate a single token override value against its declared spec. Throws
 * `CssValueError` on an unsafe/out-of-range value; for `font_family` it checks
 * the value is a declared allow-list key (never a raw font stack).
 */
export function validateTokenOverride(
  descriptor: ThemeDescriptor,
  spec: ThemeTokenSpec,
  value: string
): void {
  switch (spec.kind) {
    case "color":
      validateColorValue(value);
      return;
    case "dimension":
      validateDimensionValue(value, spec.constraint);
      return;
    case "number":
      validateNumberValue(value, spec.constraint);
      return;
    case "font_family": {
      const allowed = descriptor.fontFamilies.some((f) => f.key === value);
      if (!allowed) {
        throw new CssValueError(
          `Font family "${value}" is not one of this theme's allowed families.`,
          value
        );
      }
      return;
    }
  }
}

/**
 * Validate + normalize an untrusted request body into a `ThemeConfig` for the
 * given theme descriptor. Rejects any token/slot/asset/section/nav the
 * descriptor does not declare, and any token value that fails its typed
 * validator (the CSS-injection spine). Unknown top-level keys are ignored
 * (forward-compatible), but unknown MAP keys inside tokenOverrides/
 * slotSelections/assetRefs are hard errors — those are the attack surface.
 */
export function validateThemeConfig(
  descriptor: ThemeDescriptor,
  body: unknown
): ThemeConfigValidationResult {
  const errors: ThemeConfigValidationError[] = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errors: [
        { field: "body", message: "Request body must be a JSON object." }
      ]
    };
  }
  const input = body as Record<string, unknown>;

  const tokenByKey = new Map(descriptor.tokens.map((t) => [t.key, t]));
  const slotByKey = new Map(descriptor.slots.map((s) => [s.key, s]));
  const assetByKey = new Map(descriptor.assetSlots.map((a) => [a.key, a]));
  const sectionKeys = new Set(descriptor.contentSections.map((s) => s.key));

  // --- token overrides ---
  const tokenOverrides: Record<string, string> = {};
  const rawTokens = input.tokenOverrides;
  if (rawTokens !== undefined && rawTokens !== null) {
    if (typeof rawTokens !== "object" || Array.isArray(rawTokens)) {
      errors.push({
        field: "tokenOverrides",
        message: "Must be an object of tokenKey -> value."
      });
    } else {
      for (const [key, rawValue] of Object.entries(
        rawTokens as Record<string, unknown>
      )) {
        const spec = tokenByKey.get(key);
        if (!spec) {
          errors.push({
            field: `tokenOverrides.${key}`,
            message: "Unknown token — not declared by this theme."
          });
          continue;
        }
        if (typeof rawValue !== "string") {
          errors.push({
            field: `tokenOverrides.${key}`,
            message: "Token value must be a string."
          });
          continue;
        }
        try {
          validateTokenOverride(descriptor, spec, rawValue);
          tokenOverrides[key] = rawValue;
        } catch (error) {
          const message =
            error instanceof CssValueError
              ? error.message
              : "Invalid token value.";
          errors.push({ field: `tokenOverrides.${key}`, message });
        }
      }
    }
  }

  // --- slot selections ---
  const slotSelections: Record<string, string> = {};
  const rawSlots = input.slotSelections;
  if (rawSlots !== undefined && rawSlots !== null) {
    if (typeof rawSlots !== "object" || Array.isArray(rawSlots)) {
      errors.push({
        field: "slotSelections",
        message: "Must be an object of slotKey -> variantKey."
      });
    } else {
      for (const [key, rawValue] of Object.entries(
        rawSlots as Record<string, unknown>
      )) {
        const spec = slotByKey.get(key);
        if (!spec) {
          errors.push({
            field: `slotSelections.${key}`,
            message: "Unknown slot — not declared by this theme."
          });
          continue;
        }
        if (
          typeof rawValue !== "string" ||
          !spec.variants.some((v) => v.key === rawValue)
        ) {
          errors.push({
            field: `slotSelections.${key}`,
            message: "Must be one of the slot's declared variants."
          });
          continue;
        }
        slotSelections[key] = rawValue;
      }
    }
  }
  // Fill unset slots with their defaults.
  for (const slot of descriptor.slots) {
    if (!(slot.key in slotSelections)) slotSelections[slot.key] = slot.default;
  }

  // --- asset refs (media UUIDs only) ---
  const assetRefs: Record<string, string> = {};
  const rawAssets = input.assetRefs;
  if (rawAssets !== undefined && rawAssets !== null) {
    if (typeof rawAssets !== "object" || Array.isArray(rawAssets)) {
      errors.push({
        field: "assetRefs",
        message: "Must be an object of assetSlotKey -> media UUID."
      });
    } else {
      for (const [key, rawValue] of Object.entries(
        rawAssets as Record<string, unknown>
      )) {
        if (!assetByKey.has(key)) {
          errors.push({
            field: `assetRefs.${key}`,
            message: "Unknown asset slot — not declared by this theme."
          });
          continue;
        }
        if (rawValue === null) continue; // explicit clear
        if (typeof rawValue !== "string" || !UUID_PATTERN.test(rawValue)) {
          errors.push({
            field: `assetRefs.${key}`,
            message: "Must be a media object UUID (never a URL)."
          });
          continue;
        }
        assetRefs[key] = rawValue;
      }
    }
  }
  for (const slot of descriptor.assetSlots) {
    if (slot.required && !(slot.key in assetRefs)) {
      errors.push({
        field: `assetRefs.${slot.key}`,
        message: "This asset slot is required."
      });
    }
  }

  // --- section order ---
  let sectionOrder = descriptor.contentSections.map((s) => s.key);
  const rawOrder = input.sectionOrder;
  if (rawOrder !== undefined && rawOrder !== null) {
    if (
      !Array.isArray(rawOrder) ||
      rawOrder.some((k) => typeof k !== "string")
    ) {
      errors.push({
        field: "sectionOrder",
        message: "Must be an array of section keys."
      });
    } else {
      const seen = new Set<string>();
      let bad = false;
      for (const key of rawOrder as string[]) {
        if (!sectionKeys.has(key) || seen.has(key)) {
          bad = true;
          break;
        }
        seen.add(key);
      }
      if (bad) {
        errors.push({
          field: "sectionOrder",
          message:
            "Must be a de-duplicated ordering of this theme's declared sections."
        });
      } else {
        // Append any sections the caller omitted, preserving declared order.
        const remaining = descriptor.contentSections
          .map((s) => s.key)
          .filter((k) => !seen.has(k));
        sectionOrder = [...(rawOrder as string[]), ...remaining];
      }
    }
  }

  // --- nav placement ---
  let navPlacement = descriptor.navPlacements[0] ?? "top";
  const rawNav = input.navPlacement;
  if (rawNav !== undefined && rawNav !== null) {
    if (
      typeof rawNav !== "string" ||
      !descriptor.navPlacements.includes(rawNav)
    ) {
      errors.push({
        field: "navPlacement",
        message: "Must be one of this theme's declared nav placements."
      });
    } else {
      navPlacement = rawNav;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      themeKey: descriptor.themeKey,
      tokenOverrides,
      slotSelections,
      assetRefs,
      sectionOrder,
      navPlacement
    }
  };
}

/**
 * Resolve the final token value map (descriptor defaults with tenant overrides
 * applied on top) as `tokenKey -> value`. RE-VALIDATES every value (defense in
 * depth — a stored config should already be valid, but a token that somehow
 * failed to round-trip must throw here rather than reach the stylesheet). For
 * font_family tokens the returned value is the descriptor-owned CSS stack, NOT
 * the tenant's allow-list key — so the emitted value is never tenant-authored.
 */
export function resolveThemeTokens(
  descriptor: ThemeDescriptor,
  config: ThemeConfig
): Record<string, string> {
  const fontStackByKey = new Map(
    descriptor.fontFamilies.map((f) => [f.key, f.stack])
  );
  const resolved: Record<string, string> = {};
  for (const spec of descriptor.tokens) {
    const raw = config.tokenOverrides[spec.key] ?? spec.default;
    // Re-validate (throws on any unsafe value) before it can be serialized.
    validateTokenOverride(descriptor, spec, raw);
    if (spec.kind === "font_family") {
      const stack = fontStackByKey.get(raw);
      if (stack === undefined) {
        throw new CssValueError(`Font family key "${raw}" has no stack.`, raw);
      }
      // Re-validate the descriptor-owned stack before emit (defense in depth —
      // it was validated at load, but the serializer trusts nothing it emits).
      validateFontStack(stack);
      resolved[spec.key] = stack;
    } else {
      resolved[spec.key] = raw;
    }
  }
  return resolved;
}

/**
 * Serialize a validated `ThemeConfig` into a `:root { … }` block of
 * `--awcms-theme-<token>` custom properties. Safe by construction: only tokens
 * that pass `resolveThemeTokens` (which re-validates) are emitted, so there is
 * nothing left to escape. The font-family stack is descriptor-owned; a color/
 * dimension/number value is already constrained to the safe charset.
 */
export function serializeThemeTokensCss(
  descriptor: ThemeDescriptor,
  config: ThemeConfig
): string {
  const tokens = resolveThemeTokens(descriptor, config);
  const lines = descriptor.tokens.map(
    (spec) =>
      `  ${THEME_CSS_CUSTOM_PROPERTY_PREFIX}${spec.key}: ${tokens[spec.key]};`
  );
  return `:root {\n${lines.join("\n")}\n}\n`;
}
