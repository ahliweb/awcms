import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  fetchAiEgressApprovals,
  fetchAiPrivacyPosture
} from "../../../../../modules/omes-control/application/ai-privacy-directory";

/**
 * `GET /api/v1/omes/ai-privacy/posture` (Issue ahliweb/omes#232) — the
 * tenant-scoped AI privacy posture fleet view plus its egress-approval
 * request history, for `/admin/omes/ai-privacy`. Guarded by
 * `omes_control.ai_privacy.read`, re-checked here server-side regardless of
 * what the admin screen itself would have rendered.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: OMES_GUARDS.aiPrivacy.read,
  handler: async ({ tx, tenantId, now }) => {
    const [posturePage, approvals] = [
      await fetchAiPrivacyPosture(tx, tenantId, now),
      await fetchAiEgressApprovals(tx, tenantId)
    ];

    return ok({
      posture: posturePage.posture,
      fleetHealthy: posturePage.fleetHealthy,
      approvals
    });
  }
});
