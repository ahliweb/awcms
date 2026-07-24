/**
 * URL-change → redirect proposal planning (ADR-0039; adapted from awcms-micro
 * ADR-0028 §8) — the pure core of the URL-change capture hook. When a content slug /
 * domain / locale change is reported, this maps the old→new pair into a validated
 * redirect rule (or decides to skip) according to the tenant's configured auto
 * policy:
 *   - 'skip'    → no rule (return `skip`);
 *   - 'propose' → an INACTIVE rule for operator review (safe default);
 *   - 'create'  → an ACTIVE rule that redirects live traffic immediately.
 *
 * The old path becomes the redirect source; the new path becomes the (relative
 * same-tenant) target, both validated through `validateRedirectInput` so a capture
 * can never produce an unsafe/self/loop rule. The application layer persists the
 * result and audits it — this function performs no I/O.
 */
import {
  validateRedirectInput,
  type RedirectOrigin,
  type RedirectRuleInput,
  type RedirectValidationError
} from "./redirect-rule";
import type { UrlChangeAutoPolicy } from "./redirect-settings";

export type UrlChangeType = "slug_change" | "domain_change" | "locale_change";

export type UrlChangeInput = {
  oldPath: string;
  newPath: string;
  changeType: UrlChangeType;
  /** Optional scope narrowing for the produced rule. */
  localeScope?: string | null;
  domainScopeHost?: string | null;
  reason?: string | null;
};

export type UrlChangePlan =
  | { action: "skip" }
  | { action: "propose" | "create"; rule: RedirectRuleInput }
  | { action: "invalid"; errors: RedirectValidationError[] };

/**
 * Plan the redirect (if any) a captured URL change should produce, under the
 * tenant's `policy`. `allowedHosts` are the tenant's verified hosts (for target
 * validation / domain-scope checks).
 */
export function planUrlChangeRedirect(
  input: UrlChangeInput,
  policy: UrlChangeAutoPolicy,
  allowedHosts: readonly string[]
): UrlChangePlan {
  if (policy === "skip") {
    return { action: "skip" };
  }

  const origin: RedirectOrigin = input.changeType;
  const state = policy === "create" ? "active" : "inactive";

  const validation = validateRedirectInput(
    {
      sourcePath: input.oldPath,
      target: input.newPath,
      localeScope: input.localeScope ?? null,
      domainScopeHost: input.domainScopeHost ?? null,
      reason: input.reason ?? `Captured ${input.changeType}.`,
      origin,
      state
    },
    { allowedHosts, defaultOrigin: origin, defaultState: state }
  );

  if (!validation.ok) {
    return { action: "invalid", errors: validation.errors };
  }

  return { action: policy, rule: validation.value };
}
