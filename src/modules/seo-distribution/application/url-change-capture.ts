/**
 * URL-change capture (ADR-0039; adapted from awcms-micro ADR-0028 §8) — the
 * controlled, audited hook that turns a content slug / domain / locale change into a
 * redirect PROPOSAL or an active rule, according to the tenant's
 * `url_change_auto_policy`. This is the application seam a content module (or an
 * operator/automation) drives when a public URL changes; the pure decision lives in
 * `domain/url-change-plan.ts`, the safety gate in `redirect-safety.ts`, and this
 * function persists + audits the result inside the caller's tenant transaction.
 *
 * Nothing here starts redirecting live traffic unless the tenant explicitly chose
 * the `create` policy (or the caller overrode it) — the default `propose` produces
 * an INACTIVE rule that an operator reviews first.
 */
import {
  planUrlChangeRedirect,
  type UrlChangeInput
} from "../domain/url-change-plan";
import type { RedirectValidationError } from "../domain/redirect-rule";
import type { UrlChangeAutoPolicy } from "../domain/redirect-settings";
import { createRedirect, type RedirectRecord } from "./redirect-directory";
import { checkRedirectSafety } from "./redirect-safety";

export type UrlChangeCaptureAudit = (
  tx: Bun.SQL,
  detail: { action: "created" | "proposed"; redirect: RedirectRecord }
) => Promise<void>;

export type UrlChangeCaptureResult =
  | { outcome: "skipped" }
  | { outcome: "created" | "proposed"; redirect: RedirectRecord }
  | { outcome: "invalid"; errors: RedirectValidationError[] }
  | {
      outcome: "rejected";
      code: "SOURCE_CONFLICT" | "REDIRECT_LOOP" | "REDIRECT_CHAIN_TOO_LONG";
      message: string;
    };

/**
 * Capture a URL change into a redirect (or skip). `allowedHosts` are the tenant's
 * verified hosts; `policy` is the tenant's configured auto policy (the caller may
 * pass an explicit override). Records an audit event on any rule created/proposed.
 */
export async function captureUrlChangeRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: UrlChangeInput,
  allowedHosts: readonly string[],
  policy: UrlChangeAutoPolicy,
  recordAudit: UrlChangeCaptureAudit,
  now: Date = new Date()
): Promise<UrlChangeCaptureResult> {
  const plan = planUrlChangeRedirect(input, policy, allowedHosts);

  if (plan.action === "skip") return { outcome: "skipped" };
  if (plan.action === "invalid") {
    return { outcome: "invalid", errors: plan.errors };
  }

  const safety = await checkRedirectSafety(tx, tenantId, plan.rule, now, {
    allowedHosts
  });
  if (!safety.ok) {
    return { outcome: "rejected", code: safety.code, message: safety.message };
  }

  const redirect = await createRedirect(
    tx,
    tenantId,
    actorTenantUserId,
    plan.rule
  );
  const action = plan.action === "create" ? "created" : "proposed";
  await recordAudit(tx, { action, redirect });

  return { outcome: action, redirect };
}
