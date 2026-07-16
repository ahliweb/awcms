/**
 * Synthetic sample data for template preview (Issue #498 — "Preview does
 * not leak real recipient data by default"). One placeholder value per
 * variable the category allows; never a real recipient/tenant value.
 */
import { getAllowedVariablesForCategory } from "./email-template-categories";

export function buildSyntheticSampleVariables(
  category: string
): Record<string, string> {
  const allowlist = getAllowedVariablesForCategory(category) ?? [];
  const sample: Record<string, string> = {};

  for (const key of allowlist) {
    sample[key] = `Sample ${key}`;
  }

  return sample;
}
