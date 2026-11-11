/**
 * Reads the four verified envelopes the inbox projects (ADR-0150 section 3,
 * ADR-0152, ADR-0155) into the small set of facts the projection keeps
 * (ADR-0160 section 2). Pure.
 *
 * It reads ids, kinds and times ONLY. The payloads carry nothing else that is
 * worth reading (no body, no sender address, by the producers' own contracts),
 * and anything the reader does not name is ignored, so a future field in an
 * envelope can never leak into the projection by accident. A malformed payload
 * yields `null`: the projector skips it rather than inventing a conversation.
 */
import {
  TELEGRAM_CONSENT_CHANGED_EVENT_TYPE,
  TELEGRAM_INTERACTION_RECEIVED_EVENT_TYPE,
  WEBSITE_SUBMISSION_RECEIVED_EVENT_TYPE,
  WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE,
  type CustomerState,
  type SourceKind
} from "./inbox-constants";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboundFact = {
  kind: "inbound";
  sourceKind: SourceKind;
  sourceRef: string;
  channelAccountId: string | null;
  /** The SERVER receipt time (never a provider-supplied time): the SLA clock. */
  receivedAt: Date;
};

export type CustomerStateFact = {
  kind: "customer_state";
  sourceKind: SourceKind;
  sourceRef: string;
  state: CustomerState;
};

export type EnvelopeFact = InboundFact | CustomerStateFact;

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function instant(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The fact an envelope contributes, or `null` when it contributes none (an
 * event kind the inbox does not track, a consent for another purpose, a
 * malformed payload).
 */
export function readEnvelope(
  eventType: string,
  payload: Record<string, unknown>
): EnvelopeFact | null {
  switch (eventType) {
    case TELEGRAM_INTERACTION_RECEIVED_EVENT_TYPE: {
      // `membership` updates (a block, an unblock) are not customer messages.
      if (payload.eventKind !== "message" && payload.eventKind !== "command") {
        return null;
      }

      const sourceRef = uuid(payload.conversationRef);
      const channelAccountId = uuid(payload.channelAccountId);
      const receivedAt = instant(payload.receivedAt);

      if (!sourceRef || !channelAccountId || !receivedAt) return null;

      return {
        kind: "inbound",
        sourceKind: "telegram",
        sourceRef,
        channelAccountId,
        receivedAt
      };
    }

    case TELEGRAM_CONSENT_CHANGED_EVENT_TYPE: {
      // Only SUPPORT consent decides whether a conversation can be answered.
      if (payload.purpose !== "support") return null;

      const sourceRef = uuid(payload.contactRef);

      if (!sourceRef) return null;

      if (payload.action === "opt_out") {
        return {
          kind: "customer_state",
          sourceKind: "telegram",
          sourceRef,
          state: "opted_out"
        };
      }

      if (payload.action === "opt_in") {
        return {
          kind: "customer_state",
          sourceKind: "telegram",
          sourceRef,
          state: "active"
        };
      }

      return null;
    }

    case WEBSITE_SUBMISSION_RECEIVED_EVENT_TYPE: {
      // An `interaction` (a page event) is not a request somebody answers.
      if (payload.kind !== "contact" && payload.kind !== "lead") return null;

      const sourceRef = uuid(payload.submissionId);
      const receivedAt = instant(payload.receivedAt);

      if (!sourceRef || !receivedAt) return null;

      return {
        kind: "inbound",
        sourceKind: "website",
        sourceRef,
        channelAccountId: null,
        receivedAt
      };
    }

    case WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE: {
      const sourceRef = uuid(payload.submissionId);

      if (!sourceRef) return null;

      return {
        kind: "customer_state",
        sourceKind: "website",
        sourceRef,
        state: "withdrawn"
      };
    }

    default:
      return null;
  }
}
