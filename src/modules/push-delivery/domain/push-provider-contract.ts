/**
 * Provider-neutral push delivery contract (Issue #465, epic #463, ADR-0074).
 *
 * Pure types only. `PushProvider` is the port; the safe `log` adapter
 * (`../infrastructure/log-push-provider.ts`) implements it today, and the two
 * real transports land behind the same interface — FCM HTTP v1 for native apps
 * and Web Push/VAPID for browsers (Issue #466). Mirrors
 * `email/domain/email-provider-contract.ts`'s `EmailProvider`: one interface,
 * resolved to a concrete implementation at the edge, never imported by name
 * outside the adapter itself and its resolver.
 *
 * Callers enqueue a message and a SEPARATE dispatcher
 * (`../application/push-dispatch.ts`) calls `PushProvider.send` OUTSIDE any DB
 * transaction. That is not a style preference: ADR-0006 forbids external
 * network calls inside a transaction, and it is the entire reason this module
 * has its own queue instead of riding `awcms_domain_events`, whose consumers
 * run inside the claim transaction by design.
 */

/** Transports a subscription can speak. Matches `awcms_push_subscriptions.transport`. */
export type PushTransport = "web_push" | "fcm";

/**
 * One delivery target, already resolved from `awcms_push_subscriptions`.
 *
 * `endpoint` is the RAW value (a Web Push endpoint URL or an FCM registration
 * token) and is credential-grade — anyone holding it can push to that device.
 * It reaches an adapter because delivery is impossible without it, and it must
 * not reach anything else: log lines, diagnostics, and error snippets read
 * `endpointMasked`.
 */
export type PushTarget = {
  transport: PushTransport;
  endpoint: string;
  endpointMasked: string;
  /** RFC 8291 key material. Present for `web_push`, absent for `fcm` — the DB CHECK makes that structural. */
  p256dhKey?: string;
  authSecret?: string;
};

export type PushMessage = {
  title: string;
  body: string;
  /** Same-origin path (`/admin/...`). Validated before enqueue — a queue row must never aim a notification at another origin. */
  targetPath?: string;
  data?: Record<string, string>;
  /** Propagated to provider requests and logs for tracing. Never a dedupe key — the queue row's identity owns that. */
  correlationId?: string;
};

/**
 * `retryable` tells the dispatcher whether to schedule a retry
 * (`sending → retry_wait`) or move straight to `failed`.
 *
 * `subscriptionGone` is separate from both, and the distinction is the one that
 * matters operationally: a browser that revoked permission, or an app that was
 * uninstalled, answers `404`/`410` (Web Push) or `UNREGISTERED` (FCM). That is
 * not a delivery failure to retry and not an error to alert on — it is the
 * subscription telling us it is dead, and the dispatcher disables it. Folding
 * it into `retryable: false` would leave a tombstone endpoint in the table
 * collecting one permanent failure per message forever.
 */
export type PushDeliveryResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      subscriptionGone?: boolean;
    };

export type PushHealthCheckResult = { ok: true } | { ok: false; error: string };

export type PushProvider = {
  /** Which transports this adapter can actually deliver. The dispatcher refuses a target the resolved provider does not claim, rather than discovering it at the wire. */
  readonly supportedTransports: readonly PushTransport[];
  send(target: PushTarget, message: PushMessage): Promise<PushDeliveryResult>;
  healthCheck(): Promise<PushHealthCheckResult>;
};
