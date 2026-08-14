/**
 * ADR-0095 — the sidebar's labels are translatable.
 *
 * `AdminLayout.astro` translates the sidebar by passing COMPOSED labels through
 * the catalog (`t(entry.label)`, `t(group.moduleLabel)`,
 * `tx("menu-section", section.label)`). Those arguments are variables, so
 * `i18n:catalog:check`'s literal harvester cannot see them — by construction,
 * not by exemption.
 *
 * This test is what stands in its place, and it is stronger than harvesting:
 * it reads the actual `SIDEBAR_LABELS` table and the actual module registry, so
 * a label added to either without a catalog entry fails here even though no
 * `t("...")` literal was ever written.
 *
 * The failure this prevents is quiet: an untranslated label renders as correct
 * English (the msgid fallback), so a missing entry looks like a design choice
 * rather than a gap. Nothing else in the chain would ever mention it.
 *
 * Pure: registry + `locales/`. No database, no network.
 */
import { describe, expect, test } from "bun:test";

import { compileLocale } from "../scripts/i18n-compile";
import {
  CORE_GROUP_LABEL,
  SIDEBAR_LABELS
} from "../src/modules/module-management/domain/sidebar-menu";
import { listModules } from "../src/modules";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locales";
import { catalogKey } from "../src/lib/i18n/po";

/**
 * Keys DECLARED by each catalog — including entries that are declared but not
 * yet translated.
 *
 * Declaration is the right bar here, not translation: whether a string has been
 * translated into Indonesian is the untranslated-ledger's question
 * (`i18n:catalog:check` check 4), while this test asks whether the string is
 * VISIBLE to translators at all. A label absent from `locales/` can never be
 * translated by anyone; a label present but untranslated is scheduled work.
 */
const declaredKeysByLocale = new Map(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    new Set(compileLocale(locale).declaredKeys)
  ])
);

/** Menu-type labels are rendered under a disambiguating context. */
const MENU_SECTION_CONTEXT = "menu-section";

const menuTypeLabels = Object.entries(SIDEBAR_LABELS)
  .filter(([key]) => key.startsWith("admin.menu_type."))
  .map(([, label]) => label);

const navEntryLabels = Object.entries(SIDEBAR_LABELS)
  .filter(([key]) => !key.startsWith("admin.menu_type."))
  .map(([, label]) => label);

const moduleDisplayNames = listModules().map((module) => module.name);

describe("sidebar labels are translatable", () => {
  test("the label table is not empty (a vacuous pass is not a pass)", () => {
    // Without this, an accidentally-emptied SIDEBAR_LABELS would make every
    // assertion below iterate zero times and report success.
    expect(menuTypeLabels.length).toBeGreaterThan(0);
    expect(navEntryLabels.length).toBeGreaterThan(0);
    expect(moduleDisplayNames.length).toBeGreaterThan(0);
  });

  for (const locale of SUPPORTED_LOCALES) {
    test(`every menu-section label is declared in ${locale}.po under the "${MENU_SECTION_CONTEXT}" context`, () => {
      const declared = declaredKeysByLocale.get(locale);
      const missing = menuTypeLabels.filter(
        (label) => !declared?.has(catalogKey(label, MENU_SECTION_CONTEXT))
      );

      expect(missing).toEqual([]);
    });

    test(`every sidebar link label is declared in ${locale}.po`, () => {
      const declared = declaredKeysByLocale.get(locale);
      const missing = navEntryLabels.filter(
        (label) => !declared?.has(catalogKey(label))
      );

      expect(missing).toEqual([]);
    });

    test(`every module display name is declared in ${locale}.po`, () => {
      const declared = declaredKeysByLocale.get(locale);
      const missing = moduleDisplayNames.filter(
        (name) => !declared?.has(catalogKey(name))
      );

      expect(missing).toEqual([]);
    });

    test(`the synthetic core group label is declared in ${locale}.po`, () => {
      // `CORE_GROUP_LABEL` never appears in `SIDEBAR_LABELS`, so the loops above
      // cannot see it — it reaches the screen through a different branch of
      // `composeSidebarSections` and would otherwise be the one label nothing
      // checked.
      const declared = declaredKeysByLocale.get(locale);

      expect(
        declared?.has(catalogKey(CORE_GROUP_LABEL, MENU_SECTION_CONTEXT)) ||
          declared?.has(catalogKey(CORE_GROUP_LABEL))
      ).toBe(true);
    });
  }
});
