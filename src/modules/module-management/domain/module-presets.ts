/**
 * Tenant module presets — named profiles a tenant can be brought to in one
 * action. Pure planning; no I/O.
 *
 * Ported from awcms-micro's `module-management/domain/module-presets.ts`
 * (Issue #261). The planning logic is unchanged; the PRESET SET is not — see
 * "Presets for this template" below.
 *
 * The application layer resolves current state, hands it here, then executes
 * the plan through the existing `enableTenantModule`/`disableTenantModule`
 * primitives. Nothing in this file re-implements lifecycle validation.
 *
 * ## Design decision 1 — a preset ENABLES and DISABLES
 *
 * Applying a preset enables every module it lists and disables every currently
 * enabled module that is neither listed nor protected. Enable-only would make
 * presets useless as a way to REACH a profile: a tenant that once enabled
 * `blog_content` and then applies `minimal` would stay non-minimal forever.
 *
 * A preset apply is therefore "make tenant module state match this profile",
 * best-effort — not a purely additive grant.
 *
 * ## Design decision 2 — "protected" is not the same as `isCore`
 *
 * Only `module_management` sets `isCore: true` in this registry. The other
 * foundational modules (`tenant_admin`, `identity_access`) are protected
 * INDIRECTLY, by the reverse-dependency check
 * (`MODULE_REVERSE_DEPENDENCY_ACTIVE`): nothing can disable them while
 * `module_management` — which depends on them and can never itself be disabled
 * — stays enabled.
 *
 * `resolveProtectedModuleKeys` makes that implicit protection explicit for
 * planning: `isCore` keys plus their full transitive dependency closure. It
 * does NOT duplicate the reverse-dependency check — the real
 * `enable`/`disableTenantModule` still validate against live state. It exists
 * so `minimal` can concretely mean "keep only what cannot be given up" instead
 * of an empty enable list that would silently leave everything as it was.
 *
 * ## Design decision 3 — a preset does not silently pull in dependencies
 *
 * If a preset lists a module whose dependency is neither listed nor already
 * enabled, this planner does not invent it. The existing
 * `MODULE_DEPENDENCY_MISSING`/`MODULE_DEPENDENCY_DISABLED` semantics are reused:
 * the enable fails and the application layer reports that failure. A planner
 * that quietly repaired the preset would hide a mistake in the preset.
 *
 * ## Presets for this template
 *
 * awcms is the ERP/back-office line and, since ADR-0035, the family superset
 * that absorbs the website/e-commerce cluster. Its presets are therefore not
 * micro's: `back_office` has no counterpart there, and micro's
 * `news_portal_full_online_r2` and `saas_online` are not reproduced because the
 * subsystems that distinguished them (an R2 activation preset subsystem, the
 * SaaS control plane) are not in this base. A preset naming a module this
 * registry does not have would be a dead profile, which
 * `computeModulePresetPlan` would have to report as `unknownModuleKeys` on
 * every single apply.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";
import type { ModuleTenantState } from "./tenant-module-lifecycle";

export type ModulePresetName =
  "minimal" | "website" | "news_portal" | "back_office";

export type ModulePresetDefinition = {
  name: ModulePresetName;
  label: string;
  description: string;
  /**
   * Keys this preset wants enabled, beyond what `resolveProtectedModuleKeys`
   * already keeps. `minimal` is deliberately empty — "protected modules only".
   */
  enabledModuleKeys: readonly string[];
};

export const MODULE_PRESETS: readonly ModulePresetDefinition[] = [
  {
    name: "minimal",
    label: "Minimal",
    description:
      "Protected modules only. Everything the tenant can safely give up is disabled.",
    enabledModuleKeys: []
  },
  {
    name: "website",
    label: "Public website",
    description:
      "Public site with a custom domain, content, managed media, search, SEO, theming, comments and transactional email.",
    // `media_library` is listed next to `blog_content` deliberately (ADR-0036).
    // It is a non-protected System Foundation module, so a preset that enabled
    // content WITHOUT it would DISABLE it — presets disable every enabled,
    // non-protected, unlisted module — producing exactly the "website with no
    // media management" gap that ADR-0036's ownership inversion closed.
    // Dependency-CLOSED, deliberately. A preset does not auto-add a listed
    // module's dependencies (design decision 3), and it DISABLES anything
    // enabled and unlisted — so an unlisted dependency would be disabled and
    // then block the module that needs it. `logging`, `sync_storage` and
    // `domain_event_runtime` are here for that reason, not because a website
    // "uses" them directly. `tests/module-presets.test.ts` fails on any preset
    // whose closure is incomplete.
    enabledModuleKeys: [
      "tenant_domain",
      "blog_content",
      "media_library",
      "seo_distribution",
      "site_search",
      "theming",
      "comments",
      "email",
      "reporting",
      "logging",
      "sync_storage",
      "domain_event_runtime"
    ]
  },
  {
    name: "news_portal",
    label: "News portal",
    description:
      "The public website profile plus editorial homepage sections, advertising, and visitor analytics.",
    // ADR-0044 retired the `news_portal` MODULE; this PRESET keeps its name.
    // A preset names an intent ("run this tenant as a news portal"), not a
    // module, and the intent is unchanged — the editorial homepage composer and
    // ad placements it used to pull in now ship inside `blog_content`, which is
    // already listed. Renaming the preset would break every caller that stores
    // the name for no gain. What WOULD be a bug is leaving `"news_portal"` in
    // the key list below: `computeModulePresetPlan` would report it as an
    // `unknownModuleKey` on every single apply.
    enabledModuleKeys: [
      "tenant_domain",
      "blog_content",
      "media_library",
      "seo_distribution",
      "site_search",
      "theming",
      "comments",
      "email",
      "reporting",
      "visitor_analytics",
      "logging",
      "sync_storage",
      "domain_event_runtime",
      "data_lifecycle"
    ]
  },
  {
    name: "back_office",
    label: "ERP back office",
    description:
      "Back-office operation with no public site: approvals, reporting, retention/lifecycle, form drafts, offline sync and the domain-event runtime.",
    // No counterpart in awcms-micro — this is the line awcms actually is
    // (ADR-0035). Deliberately omits every public surface, so applying it to a
    // tenant that had a website disables that website. That is the point of a
    // profile.
    enabledModuleKeys: [
      "workflow",
      "reporting",
      "data_lifecycle",
      "form_drafts",
      "email",
      "sync_storage",
      "domain_event_runtime",
      "logging"
    ]
  }
];

export function findModulePreset(
  name: string
): ModulePresetDefinition | undefined {
  return MODULE_PRESETS.find((preset) => preset.name === name);
}

/**
 * `isCore` keys plus their full transitive dependency closure — the set a
 * preset never even attempts to disable, because the attempt would always be
 * rejected.
 */
export function resolveProtectedModuleKeys(
  allDescriptors: readonly ModuleDescriptor[]
): Set<string> {
  const descriptorByKey = new Map(allDescriptors.map((d) => [d.key, d]));
  const protectedKeys = new Set<string>();

  function includeWithDependencies(key: string): void {
    if (protectedKeys.has(key)) {
      return;
    }

    protectedKeys.add(key);

    for (const dependency of descriptorByKey.get(key)?.dependencies ?? []) {
      includeWithDependencies(dependency);
    }
  }

  for (const descriptor of allDescriptors) {
    if (descriptor.isCore) {
      includeWithDependencies(descriptor.key);
    }
  }

  return protectedKeys;
}

/** `moduleKey -> modules that declare it as a dependency`. */
function buildDependentsIndex(
  allDescriptors: readonly ModuleDescriptor[]
): Map<string, string[]> {
  const dependents = new Map<string, string[]>();

  for (const descriptor of allDescriptors) {
    for (const dependency of descriptor.dependencies ?? []) {
      dependents.set(dependency, [
        ...(dependents.get(dependency) ?? []),
        descriptor.key
      ]);
    }
  }

  return dependents;
}

/**
 * Orders enable candidates so each module's dependencies come first, given
 * `alreadyEnabled` as the satisfied base.
 *
 * Anything whose dependency can never be satisfied within this plan is still
 * appended at the end. Best-effort on purpose: the real `enableTenantModule`
 * then reports the exact rejection reason, instead of this planner silently
 * dropping the module and producing a plan that looks complete.
 */
function planEnableOrder(
  candidates: ReadonlySet<string>,
  allDescriptors: readonly ModuleDescriptor[],
  alreadyEnabled: ReadonlySet<string>
): string[] {
  const descriptorByKey = new Map(allDescriptors.map((d) => [d.key, d]));
  const remaining = new Set(candidates);
  const ordered: string[] = [];
  const satisfied = new Set(alreadyEnabled);

  let changed = true;

  while (remaining.size > 0 && changed) {
    changed = false;

    for (const key of remaining) {
      const dependencies = descriptorByKey.get(key)?.dependencies ?? [];

      if (dependencies.every((dependency) => satisfied.has(dependency))) {
        ordered.push(key);
        satisfied.add(key);
        remaining.delete(key);
        changed = true;
      }
    }
  }

  return [...ordered, ...remaining];
}

export type ModulePresetDisableSkip = {
  moduleKey: string;
  reason: "reverse_dependency_active";
};

type ModulePresetDisablePlan = {
  ordered: string[];
  skipped: ModulePresetDisableSkip[];
};

/**
 * Orders disable candidates leaves-first, so a module is only disabled once
 * nothing still enabled depends on it — mirroring what the real, sequential
 * `disableTenantModule` calls will see as each lands.
 *
 * A candidate that can never become disableable is reported in `skipped`,
 * never silently dropped and never force-disabled.
 *
 * `stillEnabledBase` must include both what is already enabled AND what this
 * same plan is about to enable. A disable candidate that only a
 * freshly-enabling module depends on has to be skipped pre-emptively; passing
 * only the pre-plan set schedules it for disable and turns a clean skip into a
 * spurious rejection from the real call. (awcms-micro hit exactly that and
 * fixed it post-review; the fix is carried over rather than rediscovered.)
 */
function planDisableOrder(
  candidates: ReadonlySet<string>,
  allDescriptors: readonly ModuleDescriptor[],
  stillEnabledBase: ReadonlySet<string>
): ModulePresetDisablePlan {
  const dependentsOf = buildDependentsIndex(allDescriptors);
  const remaining = new Set(candidates);
  const ordered: string[] = [];
  const stillEnabled = new Set(stillEnabledBase);

  let changed = true;

  while (remaining.size > 0 && changed) {
    changed = false;

    for (const key of remaining) {
      const blocked = (dependentsOf.get(key) ?? []).some((dependent) =>
        stillEnabled.has(dependent)
      );

      if (!blocked) {
        ordered.push(key);
        stillEnabled.delete(key);
        remaining.delete(key);
        changed = true;
      }
    }
  }

  return {
    ordered,
    skipped: [...remaining].map((moduleKey) => ({
      moduleKey,
      reason: "reverse_dependency_active" as const
    }))
  };
}

export type ModulePresetPlan = {
  presetName: ModulePresetName;
  /** Keys to enable, dependency-safe order. */
  toEnable: readonly string[];
  /** Keys to disable, leaves-first order. */
  toDisable: readonly string[];
  /** Enabled, unlisted modules left alone because something still enabled depends on them. */
  skippedDisable: readonly ModulePresetDisableSkip[];
  /** Never considered for disabling (core plus its dependency closure). */
  protectedModuleKeys: readonly string[];
  /** Preset-listed keys that resolve to no registered descriptor. */
  unknownModuleKeys: readonly string[];
};

/**
 * Decide what a preset apply would do. Pure — no I/O, and it calls neither
 * `evaluateModuleEnable` nor `evaluateModuleDisable`.
 *
 * The result is an INTENT, not a guarantee: the application layer runs the real
 * lifecycle primitives for every planned change and surfaces their rejections
 * rather than this function pre-empting them.
 */
export function computeModulePresetPlan(input: {
  preset: ModulePresetDefinition;
  allDescriptors: readonly ModuleDescriptor[];
  currentState: readonly ModuleTenantState[];
}): ModulePresetPlan {
  const { preset, allDescriptors, currentState } = input;
  const descriptorByKey = new Map(allDescriptors.map((d) => [d.key, d]));
  const currentlyEnabled = new Set(
    currentState.filter((state) => state.tenantEnabled).map((s) => s.moduleKey)
  );
  const protectedKeys = resolveProtectedModuleKeys(allDescriptors);

  const unknownModuleKeys = preset.enabledModuleKeys.filter(
    (key) => !descriptorByKey.has(key)
  );
  const wantEnabled = new Set(
    preset.enabledModuleKeys.filter((key) => descriptorByKey.has(key))
  );

  const toEnable = planEnableOrder(
    new Set([...wantEnabled].filter((key) => !currentlyEnabled.has(key))),
    allDescriptors,
    currentlyEnabled
  );

  const disablePlan = planDisableOrder(
    new Set(
      [...currentlyEnabled].filter(
        (key) => !protectedKeys.has(key) && !wantEnabled.has(key)
      )
    ),
    allDescriptors,
    new Set([...currentlyEnabled, ...wantEnabled])
  );

  return {
    presetName: preset.name,
    toEnable,
    toDisable: disablePlan.ordered,
    skippedDisable: disablePlan.skipped,
    protectedModuleKeys: [...protectedKeys].sort(),
    unknownModuleKeys
  };
}
