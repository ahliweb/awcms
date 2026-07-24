/**
 * Create/update-time redirect safety checks (ADR-0039; adapted from awcms-micro
 * ADR-0028 §8) — the "reject conflicts, loops, and excessive chains BEFORE they are
 * stored" control. Combines a source+scope conflict check with a bounded,
 * non-recursive chain preview that OVERLAYS the proposed rule on top of the tenant's
 * existing active rules and confirms it does not create a loop or a chain longer
 * than the hop cap.
 *
 * Reused by create, bulk import, URL-change capture, and the `validate`/chain-
 * preview endpoint, so every write path applies the identical safety gate.
 */
import {
  resolveRedirectChain,
  type RedirectChainLookup,
  type RedirectChainOutcome,
  type RedirectHopRule
} from "../domain/redirect-chain";
import type { RedirectRuleInput } from "../domain/redirect-rule";
import {
  findActiveRedirectByPath,
  findConflictingRedirect,
  type RedirectRecord
} from "./redirect-directory";

function toHopRule(rule: {
  id: string;
  targetType: RedirectRuleInput["targetType"];
  target: string;
  statusCode: RedirectRuleInput["statusCode"];
  preserveQuery: boolean;
}): RedirectHopRule {
  return {
    id: rule.id,
    targetType: rule.targetType,
    target: rule.target,
    statusCode: rule.statusCode,
    preserveQuery: rule.preserveQuery
  };
}

/**
 * A sibling batch rule (bulk import) is in scope for the proposed rule's chain
 * lookup when its own scope is a match for — or a superset of — the proposed rule's
 * (locale, host) scope, mirroring the resolve-time SQL predicate
 * (`locale_scope IS NULL OR = :locale` / `domain_scope_host IS NULL OR = :host`).
 * This lets `[{/a→/b},{/b→/a}]` see each other so the intra-batch loop is detected.
 */
function siblingInScope(
  sibling: RedirectRuleInput,
  proposed: Pick<RedirectRuleInput, "localeScope" | "domainScopeHost">
): boolean {
  const localeOk =
    sibling.localeScope === null ||
    sibling.localeScope === proposed.localeScope;
  const hostOk =
    sibling.domainScopeHost === null ||
    sibling.domainScopeHost === proposed.domainScopeHost;
  return localeOk && hostOk;
}

/**
 * Build a chain lookup that overlays the proposed rule at its own source path,
 * plus (for bulk import) any already-accepted sibling batch rules that would be
 * created in the same all-or-nothing import — so an intra-batch loop is previewed
 * even though none of the siblings is persisted yet.
 *
 * Defense-in-depth: every hop is resolved under the PROPOSED rule's own (locale,
 * host) scope — the only scope under which the proposed rule can itself participate
 * in a chain. A loop that closes solely under a DIFFERENT scope (one the proposed
 * rule can never match) is therefore not previewed here; it is caught at RESOLVE
 * time, where every emitted target is re-validated and any loop fails CLOSED (no
 * redirect) rather than being served. Resolving each hop under its own distinct
 * scope is not meaningful for a single request (a chain resolves under one fixed
 * request scope), so this is intentionally scoped, not a gap.
 */
function makeOverlayLookup(
  tx: Bun.SQL,
  tenantId: string,
  input: Pick<
    RedirectRuleInput,
    | "normalizedSourcePath"
    | "targetType"
    | "target"
    | "statusCode"
    | "preserveQuery"
    | "localeScope"
    | "domainScopeHost"
  >,
  now: Date,
  siblingRules: readonly RedirectRuleInput[] = []
): RedirectChainLookup {
  const overlay: RedirectHopRule = {
    id: "__proposed__",
    targetType: input.targetType,
    target: input.target,
    statusCode: input.statusCode,
    preserveQuery: input.preserveQuery
  };

  return async (pathKey) => {
    if (pathKey === input.normalizedSourcePath) return overlay;

    // Sibling batch rules take precedence over persisted rows — they would be
    // created in the same import, and none is in the DB yet.
    const sibling = siblingRules.find(
      (s) => s.normalizedSourcePath === pathKey && siblingInScope(s, input)
    );
    if (sibling) return toHopRule({ id: "__sibling__", ...sibling });

    const existing = await findActiveRedirectByPath(tx, tenantId, pathKey, {
      locale: input.localeScope,
      host: input.domainScopeHost,
      now
    });
    return existing ? toHopRule(existing) : null;
  };
}

/** Preview the chain the proposed rule would produce (overlaid on existing rules). */
export async function previewRedirectChainForInput(
  tx: Bun.SQL,
  tenantId: string,
  input: RedirectRuleInput,
  now: Date,
  allowedHosts: readonly string[],
  siblingRules: readonly RedirectRuleInput[] = []
): Promise<RedirectChainOutcome> {
  return resolveRedirectChain(
    input.normalizedSourcePath,
    makeOverlayLookup(tx, tenantId, input, now, siblingRules),
    // Fold `verified_external` hops on the tenant's own hosts back into the chain so
    // a same-host loop is rejected at write time, not just at resolve.
    { allowedHosts }
  );
}

export type RedirectSafetyResult =
  | { ok: true; chain: RedirectChainOutcome }
  | {
      ok: false;
      code: "SOURCE_CONFLICT" | "REDIRECT_LOOP" | "REDIRECT_CHAIN_TOO_LONG";
      message: string;
      conflict?: RedirectRecord;
      chain?: RedirectChainOutcome;
    };

export type RedirectSafetyOptions = {
  /** The tenant's currently-verified hosts (`verified_external` same-host loop fold-back). */
  allowedHosts: readonly string[];
  /** Skip a source+scope conflict against the rule being updated in place. */
  excludeId?: string;
  /** Already-accepted sibling batch rules to overlay for intra-batch loop detection (bulk import). */
  siblingRules?: readonly RedirectRuleInput[];
};

/**
 * Full pre-write safety gate: reject if the source+scope already has a live rule
 * (conflict), or if the proposed rule would create a loop / an over-long chain.
 * `options.excludeId` skips a conflict against the rule being updated in place;
 * `options.siblingRules` overlays not-yet-persisted batch siblings (bulk import).
 */
export async function checkRedirectSafety(
  tx: Bun.SQL,
  tenantId: string,
  input: RedirectRuleInput,
  now: Date,
  options: RedirectSafetyOptions
): Promise<RedirectSafetyResult> {
  const conflict = await findConflictingRedirect(
    tx,
    tenantId,
    input.normalizedSourcePath,
    input.localeScope,
    input.domainScopeHost,
    options.excludeId
  );

  if (conflict) {
    return {
      ok: false,
      code: "SOURCE_CONFLICT",
      message:
        "Another live rule already governs this source path and scope. Archive or delete it first.",
      conflict
    };
  }

  const chain = await previewRedirectChainForInput(
    tx,
    tenantId,
    input,
    now,
    options.allowedHosts,
    options.siblingRules
  );

  if (chain.outcome === "loop") {
    return {
      ok: false,
      code: "REDIRECT_LOOP",
      message: "This rule would create a redirect loop.",
      chain
    };
  }

  if (chain.outcome === "chain_too_long") {
    return {
      ok: false,
      code: "REDIRECT_CHAIN_TOO_LONG",
      message:
        "This rule would create a redirect chain beyond the allowed length.",
      chain
    };
  }

  return { ok: true, chain };
}
