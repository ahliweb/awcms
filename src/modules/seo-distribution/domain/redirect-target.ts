/**
 * Redirect-target validation (ADR-0039; adapted from awcms-micro ADR-0028 §8) — a
 * thin, MANDATORY wrapper over the FROZEN `classifyRedirectTarget` /
 * `assertSafeRedirectTarget` guards (now re-homed as standalone domain helpers in
 * `./redirect-target-classification.ts` — awcms deliberately kept them OUT of the
 * `seo_facts` port, ADR-0038/ADR-0039). This module does NOT reinvent redirect-target
 * safety: every target — relative or absolute — is routed through the frozen guards,
 * which are the single open-redirect / cross-tenant control. Only a
 * `same_tenant_internal` classification is ever accepted:
 *   - a relative same-origin path (`relative_same_tenant`), first normalized by
 *     `normalizeRedirectPath` so dot-segments/duplicate-slashes/percent-encoding
 *     are canonical and CRLF/backslash/protocol-relative are already rejected; or
 *   - an absolute `http(s)` URL whose host is one of THIS tenant's verified
 *     registered domains (`verified_external`).
 * `//evil.com`, `/\evil.com`, `javascript:`, `data:`, `mailto:`, a cross-tenant
 * host, and every C0/DEL-control bypass are rejected by the frozen guard, not by
 * anything re-derived here.
 */
import {
  classifyRedirectTarget,
  type RedirectTargetClass
} from "./redirect-target-classification";
import { normalizeRedirectPath } from "./redirect-path";

export type RedirectTargetType = "relative_same_tenant" | "verified_external";

export type RedirectTargetValidationResult =
  | { ok: true; targetType: RedirectTargetType; target: string }
  | { ok: false; reason: string; classification?: RedirectTargetClass };

/**
 * Validate + canonicalize a raw redirect target against the tenant's verified
 * registered hosts. `allowedHosts` is the set of `normalized_hostname`s the tenant
 * owns (server-derived from `tenant_domain`, never a request `Host`). Returns the
 * canonical target string + its type, or a rejection.
 */
export function validateRedirectTarget(
  raw: unknown,
  allowedHosts: readonly string[]
): RedirectTargetValidationResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "Target must be a non-empty string." };
  }

  const value = raw.trim();

  // Relative target: normalize first (this alone rejects CRLF, backslash,
  // protocol-relative, off-origin), then confirm through the frozen guard.
  if (value.startsWith("/")) {
    const normalized = normalizeRedirectPath(value, { keepQuery: true });
    if (!normalized.ok) {
      return { ok: false, reason: `Target path invalid: ${normalized.reason}` };
    }

    const classification = classifyRedirectTarget(
      normalized.path,
      allowedHosts
    );
    if (classification !== "same_tenant_internal") {
      return {
        ok: false,
        reason:
          "Target is not a safe same-origin path (open-redirect guard rejected it).",
        classification
      };
    }

    return {
      ok: true,
      targetType: "relative_same_tenant",
      target: normalized.path
    };
  }

  // Absolute target: the frozen guard decides. Only a same-tenant registered host
  // is accepted; any other host is `cross_host_external` and rejected.
  const classification = classifyRedirectTarget(value, allowedHosts);

  if (classification === "same_tenant_internal") {
    // Canonicalize via the URL parser so the stored form is stable (host
    // lowercased, no fragment). Safe: already classified same_tenant_internal.
    try {
      const url = new URL(value);
      url.hash = "";
      return {
        ok: true,
        targetType: "verified_external",
        target: url.toString()
      };
    } catch {
      // Unreachable — the guard already parsed it — but fail safe.
      return { ok: false, reason: "Target is not a valid absolute URL." };
    }
  }

  if (classification === "cross_host_external") {
    return {
      ok: false,
      reason:
        "Target host is not one of this tenant's verified domains — external redirects are not allowed.",
      classification
    };
  }

  return {
    ok: false,
    reason:
      "Target is invalid (unsafe scheme, control characters, or protocol-relative).",
    classification
  };
}
