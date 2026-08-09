import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import { enqueuePushToRecipients } from "../../../../modules/push-delivery/application/push-enqueue";
import { isPushEnabled } from "../../../../modules/push-delivery/domain/push-config";

/** The `awcms_push_messages_category_format_check` shape: `namespace.name`. */
const TEST_CATEGORY = "push_delivery.test";

/**
 * `POST /api/v1/push/test` (Issue #466) — queue a notification to the CALLER'S
 * OWN devices, to prove the chain end to end.
 *
 * ## Why the chain needs proving at all
 *
 * Push delivery fails in places nothing else in this system can see: a VAPID
 * key pair that does not match the one the browser subscribed with, a service
 * worker that registered at the wrong scope, an operating system that silently
 * withholds notification permission. Every one of those produces a queue that
 * drains cleanly and a device that shows nothing. Without a deliberate probe,
 * the first evidence is a user reporting a notification they never got — about
 * an event nobody can re-fire.
 *
 * ## Own devices only, and that is a security boundary
 *
 * The recipient is `auth.context.tenantUserId` and the route accepts no
 * recipient parameter. A test endpoint that took one would be an
 * arbitrary-notification surface: a system-branded message, with attacker-
 * chosen text and a click target, delivered to any colleague's lock screen by
 * anyone holding one diagnostics permission. Notification content is the most
 * trusted text this application can put in front of a person, and it stays
 * unaddressable from the outside.
 *
 * For the same reason the title and body are FIXED. There is nothing to
 * customise about "does push work", and a free-text field here is the same
 * surface by a smaller door.
 *
 * ## `check`, not `create`
 *
 * The action is `diagnostics.check` — the same classification
 * `module_management.health.check` uses. It reads as what it is (an operator
 * probing infrastructure) rather than as authorship of a notification, which is
 * a capability this module deliberately does not offer to anybody.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "push_delivery",
    activityCode: "diagnostics",
    action: "check"
  },
  handler: async ({ tx, tenantId, auth }) => {
    if (!isPushEnabled()) {
      // Refused before the row is written. Queuing a probe on a deployment
      // whose dispatcher claims nothing would leave a message that stays
      // `queued` forever, and the operator reading that would conclude the
      // queue is stuck rather than that push is switched off.
      return fail(
        409,
        "PUSH_DISABLED",
        'Push delivery is disabled on this deployment (PUSH_ENABLED is not "true"), so a test notification would never be sent.'
      );
    }

    const result = await enqueuePushToRecipients(
      tx,
      tenantId,
      [auth.context.tenantUserId],
      {
        category: TEST_CATEGORY,
        title: "Push notification test",
        body: "If you can read this, push delivery is working on this device.",
        priority: "normal",
        createdBy: auth.context.tenantUserId
      }
    );

    if (result.messageIds.length === 0) {
      // A NORMAL outcome for the enqueue helper (most users never enable push),
      // but for a deliberate probe it is the whole answer: there is nothing to
      // send to. Reported as a refusal so the screen does not show "queued 0"
      // and leave the operator to work out what that means.
      return fail(
        409,
        "NO_ACTIVE_SUBSCRIPTION",
        "You have no active push subscription on any device. Enable notifications first, then send the test."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "push_delivery",
      action: "push_test.queued",
      resourceType: "push_message",
      resourceId: result.messageIds[0]!,
      severity: "info",
      message: `Test push notification queued to ${result.messageIds.length} device(s).`,
      attributes: { queuedCount: result.messageIds.length }
    });

    return ok({ queuedCount: result.messageIds.length });
  }
});
