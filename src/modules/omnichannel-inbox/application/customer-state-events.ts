/**
 * Which logged events can CHANGE a customer state, as a SQL predicate over
 * `awcms_domain_events e` (the #1275 re-audit, N-2).
 *
 * It is `readEnvelope`'s customer-state branches, expressed in SQL so a bounded
 * read never spends its bound on events the reader would ignore:
 *
 * - Telegram consent counts only for purpose `support` and action `opt_in` /
 *   `opt_out`; marketing or transactional consent never decides whether a
 *   conversation can be answered.
 * - A withdrawal counts always.
 * - In both, the payload's reference must be the event's own aggregate (the
 *   reader applies the payload's reference; the reads below join on the
 *   aggregate), so an event that would land on another conversation is not
 *   "pending" for this one.
 *
 * Without it, 2000 newer marketing-consent events of one contact filled the
 * sweep's batch on every run: each was "newer than the applied state", none
 * ever applied, and a support opt-out behind them was never applied and aged
 * out of the 48-hour window (`omnichannel-inbox-worker.integration.test.ts`
 * holds that case). Change the reader and this predicate together.
 *
 * The same rules are re-checked by the database for every state change
 * (`awcms_inbox_conversations_state_provenance`, sql/384).
 */
import {
  TELEGRAM_CONSENT_CHANGED_EVENT_TYPE,
  TELEGRAM_CONTACT_AGGREGATE_TYPE,
  WEBSITE_SUBMISSION_AGGREGATE_TYPE,
  WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE
} from "../domain/inbox-constants";

export function applicableCustomerStateEvent(tx: Bun.SQL) {
  return tx`
    (
      (
        e.event_type = ${TELEGRAM_CONSENT_CHANGED_EVENT_TYPE}
        AND e.aggregate_type = ${TELEGRAM_CONTACT_AGGREGATE_TYPE}
        AND e.payload->>'purpose' = 'support'
        AND e.payload->>'action' IN ('opt_in', 'opt_out')
        AND lower(e.payload->>'contactRef') = e.aggregate_id::text
      )
      OR (
        e.event_type = ${WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE}
        AND e.aggregate_type = ${WEBSITE_SUBMISSION_AGGREGATE_TYPE}
        AND lower(e.payload->>'submissionId') = e.aggregate_id::text
      )
    )
  `;
}
