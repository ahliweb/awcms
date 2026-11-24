/**
 * What `/admin/email-webhooks` shows and offers one caller (Issue #1162,
 * ADR-0151 section 5).
 *
 * It is a function in this module, not frontmatter, so a real database can test
 * the rules that matter: a callback or a provider event of an account the caller
 * cannot see never appears, every reported event says it is UNAUTHENTICATED, and
 * a review control is offered only where `POST /provider-events/{id}/review`
 * would accept it.
 *
 * ## It reads what the API reads, through the API's rules
 *
 * - callbacks: `listWebhookSubscriptions`, narrowed per account by the same
 *   `canUseAccount(..., "viewer")` decision `GET /email/webhook-callbacks`
 *   makes;
 * - events: `listProviderEvents` (keyset, newest first, one page) narrowed the
 *   same way `GET /email/provider-events` narrows it;
 * - accounts (for the "issue or rotate" choice and the account names): the
 *   channel registry's own lister under `email.webhook.read`.
 *
 * ## What is never read
 *
 * No callback token and no token hash: `WebhookSubscriptionView` carries
 * neither. No raw recipient: the event view carries `recipient_masked`. A click
 * shows the link's HOST only.
 *
 * One query at a time: `tx` is one reserved connection.
 */
import {
  EMAIL_WEBHOOK_MODE,
  isEmailWebhookEnabled
} from "../domain/email-webhook-config";
import { resolveSoftBounceThreshold } from "../domain/suppression-policy";
import {
  decodeProviderEventCursor,
  listProviderEvents,
  type ProviderEventReviewStatus,
  type ProviderEventView
} from "./provider-event-directory";
import { EMAIL_WEBHOOK_GUARDS } from "./webhook-route-support";
import {
  loadEmailSenderAccess,
  tryLoadMailketingAccountLister,
  tryLoadWebhookSubscriptionDirectory,
  type EmailSenderAccessContext,
  type EmailSenderAccessGuard
} from "../infrastructure/channel-account-loaders";

/** How many Mailketing accounts the screen loads (the callback choice and names). */
export const EMAIL_WEBHOOKS_ACCOUNT_LIMIT = 100;

type Can = (request: EmailSenderAccessGuard) => Promise<boolean>;

export const REVIEW_STATUS_FILTERS = [
  "pending",
  "confirmed",
  "dismissed",
  "informational"
] as const satisfies readonly ProviderEventReviewStatus[];

/** Only a bounce or an unsubscribe can be reviewed; opens, clicks and delivered are informational. */
const REVIEWABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "bounce",
  "unsubscribe"
]);

export type EmailWebhookAccountRow = {
  id: string;
  displayName: string;
  status: string;
  /** The account's live callback (`pending`/`active`), when it has one. */
  liveCallbackId: string | null;
};

export type EmailWebhookCallbackRow = {
  id: string;
  accountId: string;
  /** `null` when the account is one the registry list did not return (not read as a name). */
  accountName: string | null;
  status: string;
  lastEventAt: string | null;
  createdAt: string;
};

export type EmailProviderEventRow = {
  id: string;
  eventType: string;
  bounceClass: string | null;
  statusCode: string | null;
  recipientMasked: string;
  linkHost: string | null;
  accountName: string | null;
  providerReportedAt: string | null;
  receivedAt: string;
  reviewStatus: string;
  /** `true` only when the caller may approve AND the event is pending and reviewable. */
  reviewable: boolean;
};

export type EmailWebhooksScreen = {
  /** The channel module could not be loaded: nothing below is known, and that is not "no callbacks". */
  unavailable: boolean;
  channelAccountsEnabled: boolean;
  /** `EMAIL_WEBHOOK_ENABLED`. Off means the public callback answers nothing. */
  webhookEnabled: boolean;
  mode: typeof EMAIL_WEBHOOK_MODE;
  softBounceThreshold: number;
  canConfigure: boolean;
  canApprove: boolean;
  accounts: EmailWebhookAccountRow[];
  accountsTruncated: boolean;
  callbacks: EmailWebhookCallbackRow[];
  events: EmailProviderEventRow[];
  /** The review status the list is filtered by. */
  reviewStatus: ProviderEventReviewStatus;
  nextCursor: string | null;
};

/** An unknown or absent filter is the default (`pending`), never an error: an SSR page does not 400. */
export function parseReviewStatusFilter(
  raw: string | null
): ProviderEventReviewStatus {
  return (REVIEW_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as ProviderEventReviewStatus)
    : "pending";
}

export async function resolveEmailWebhooksScreen(
  context: EmailSenderAccessContext,
  can: Can,
  query: { reviewStatus: ProviderEventReviewStatus; cursor: string | null },
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<EmailWebhooksScreen> {
  const env = options.env ?? process.env;
  const base = {
    webhookEnabled: isEmailWebhookEnabled(env),
    mode: EMAIL_WEBHOOK_MODE,
    softBounceThreshold: resolveSoftBounceThreshold(),
    reviewStatus: query.reviewStatus
  };
  const empty = (
    unavailable: boolean,
    channelAccountsEnabled: boolean
  ): EmailWebhooksScreen => ({
    ...base,
    unavailable,
    channelAccountsEnabled,
    canConfigure: false,
    canApprove: false,
    accounts: [],
    accountsTruncated: false,
    callbacks: [],
    events: [],
    nextCursor: null
  });
  const lister = await tryLoadMailketingAccountLister();
  const directory = await tryLoadWebhookSubscriptionDirectory();
  const access = await loadEmailSenderAccess();

  // Default-deny: a dependency that cannot be loaded is "unavailable", not "none".
  if (!lister || !directory || !access) return empty(true, false);
  if (!lister.enabled()) return empty(false, false);

  const canConfigure = await can(EMAIL_WEBHOOK_GUARDS.configure);
  const canApprove = await can(EMAIL_WEBHOOK_GUARDS.approve);
  const listed = await lister.list(
    context,
    EMAIL_WEBHOOK_GUARDS.read,
    EMAIL_WEBHOOKS_ACCOUNT_LIMIT
  );
  const names = new Map(
    listed.accounts.map((account) => [account.id, account.displayName])
  );
  const subscriptions = await directory.listWebhookSubscriptions(
    context.tx,
    context.tenantId,
    "mailketing"
  );
  const visible = new Map<string, boolean>();
  const mayView = async (accountId: string): Promise<boolean> => {
    let known = visible.get(accountId);

    if (known === undefined) {
      known = await access.canUseAccount(
        context,
        EMAIL_WEBHOOK_GUARDS.read,
        accountId,
        "viewer"
      );
      visible.set(accountId, known);
    }

    return known;
  };
  const callbacks: EmailWebhookCallbackRow[] = [];

  for (const entry of subscriptions) {
    if (await mayView(entry.accountId)) {
      callbacks.push({
        id: entry.id,
        accountId: entry.accountId,
        accountName: names.get(entry.accountId) ?? null,
        status: entry.status,
        lastEventAt: entry.lastEventAt,
        createdAt: entry.createdAt
      });
    }
  }

  const liveByAccount = new Map<string, string>();

  for (const callback of callbacks) {
    if (
      (callback.status === "active" || callback.status === "pending") &&
      !liveByAccount.has(callback.accountId)
    ) {
      liveByAccount.set(callback.accountId, callback.id);
    }
  }

  const page = await listProviderEvents(context.tx, context.tenantId, {
    reviewStatus: query.reviewStatus,
    emailMessageId: null,
    cursor: decodeProviderEventCursor(query.cursor)
  });
  const events: EmailProviderEventRow[] = [];

  for (const event of page.events as ProviderEventView[]) {
    if (!(await mayView(event.espAccountId))) continue;

    events.push({
      id: event.id,
      eventType: event.eventType,
      bounceClass: event.bounceClass,
      statusCode: event.statusCode,
      recipientMasked: event.recipientMasked,
      linkHost: event.linkHost,
      accountName: names.get(event.espAccountId) ?? null,
      providerReportedAt: event.providerReportedAt,
      receivedAt: event.receivedAt,
      reviewStatus: event.reviewStatus,
      reviewable:
        canApprove &&
        event.reviewStatus === "pending" &&
        REVIEWABLE_EVENT_TYPES.has(event.eventType)
    });
  }

  return {
    ...base,
    unavailable: false,
    channelAccountsEnabled: true,
    canConfigure,
    canApprove,
    accounts: listed.accounts
      .filter((account) => account.accountKind === "esp_account")
      .map((account) => ({
        id: account.id,
        displayName: account.displayName,
        status: account.status,
        liveCallbackId: liveByAccount.get(account.id) ?? null
      })),
    accountsTruncated: listed.more,
    callbacks,
    events,
    nextCursor: page.nextCursor
  };
}
