/**
 * Permission key constants for `tax` (ADR-0127, `sql/173`).
 *
 * Nine keys, split along the lines of what each can DAMAGE:
 *
 * - `rules.read` / `rules.configure` / `rules.publish` — authoring a draft rule
 *   version is not publishing it. `publish` is the act that changes what every
 *   future sale is taxed at, so it is separately grantable and is the natural
 *   second key in a maker/checker split (a tenant can author a SoD rule over
 *   `tax.rules.configure` + `tax.rules.publish`; the base ships none).
 * - `calculations.analyze` — the stateless quote. Named `analyze` rather than a
 *   new action: it is a read-only computation that records nothing, exactly the
 *   posture the `analyze` action already has for reporting.
 * - `snapshots.read` / `snapshots.create` / `snapshots.reverse` — finalising a
 *   document's tax and refunding it are different powers; `reverse` is
 *   HIGH-RISK (see `HIGH_RISK_ACTIONS`).
 * - `snapshots.backdate` — finalising or reversing with a tax date outside the
 *   server-date window (`tax-config.ts`). HIGH-RISK: it is the power to post a
 *   document into a closed period, so it is its own key rather than a flag.
 * - `reports.read` — the reconciliation view.
 */
export const TAX_MODULE_KEY = "tax";

export const TAX_RULES_ACTIVITY_CODE = "rules";
export const TAX_CALCULATIONS_ACTIVITY_CODE = "calculations";
export const TAX_SNAPSHOTS_ACTIVITY_CODE = "snapshots";
export const TAX_REPORTS_ACTIVITY_CODE = "reports";

export const TAX_PERMISSIONS = {
  rulesRead: "tax.rules.read",
  rulesConfigure: "tax.rules.configure",
  rulesPublish: "tax.rules.publish",
  calculationsAnalyze: "tax.calculations.analyze",
  snapshotsRead: "tax.snapshots.read",
  snapshotsCreate: "tax.snapshots.create",
  snapshotsReverse: "tax.snapshots.reverse",
  snapshotsBackdate: "tax.snapshots.backdate",
  reportsRead: "tax.reports.read"
} as const;
