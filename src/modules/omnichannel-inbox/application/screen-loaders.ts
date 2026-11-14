/**
 * What the three `/admin/omnichannel-inbox` screens read, as functions (Issue
 * #1164 audit follow-up, M-1/L-1).
 *
 * The screens used to chain `visibilityFor` -> `listConversations` (and the
 * detail / SLA-policy equivalents) inline in `.astro` frontmatter, where the
 * only test was a source-text match: a refactor that kept the CALL to
 * `visibilityFor` but handed `{ unconfined: true }` to the directory leaked
 * every brand's conversations and stayed green. The chain lives here so a
 * behavioural integration test can run the SAME code as a confined viewer.
 *
 * The functions take the screen's own guards (the pages spell them as literals
 * for `admin:screen-coverage:check`) and the `can()` chokepoint of the render.
 * Authorization of the entry itself stays with `loadAdminScreen`; this runs only
 * after it allowed the page.
 */
import {
  getConversation,
  listConversations,
  type ActivityView,
  type ConversationView
} from "./conversation-directory";
import { visibilityFor } from "./route-support";
import { listSlaPolicies, type SlaPolicyView } from "./sla-policy-directory";
import { listTags, type TagView } from "./tag-directory";
import { isOmnichannelInboxEnabled } from "../domain/inbox-config";
import { CONVERSATION_STATUSES, SOURCE_KINDS } from "../domain/inbox-constants";
import { validateListConversationsQuery } from "../domain/inbox-validation";
import type {
  InboxAccessContext,
  InboxGuard
} from "../infrastructure/channel-accounts-access";

/** `can()` of `loadAdminScreen`: the chokepoint, one boolean per probe. */
export type InboxCan = (guard: InboxGuard) => Promise<boolean>;

/** Two keyset pages of the API's own query: the bound of what the list loads. */
export const LOAD_PAGE_SIZE = 100;
export const LOAD_PAGE_LIMIT = 2;

export type InboxListFilters = {
  status?: string | null;
  assignee?: string | null;
  sla?: string | null;
  source?: string | null;
  tag?: string | null;
};

/** The URL filters as the API's own query string; an unknown value is dropped, never an error. */
export function inboxListParams(
  filters: InboxListFilters,
  cursor: string | null
): URLSearchParams {
  const params = new URLSearchParams();
  const { status, assignee, sla, source, tag } = filters;

  if (status && (CONVERSATION_STATUSES as readonly string[]).includes(status)) {
    params.set("status", status);
  }

  if (assignee === "me" || assignee === "unassigned") {
    params.set("assignee", assignee);
  }

  if (sla === "breached") params.set("slaState", "breached");

  if (source && (SOURCE_KINDS as readonly string[]).includes(source)) {
    params.set("sourceKind", source);
  }

  if (tag) params.set("tagId", tag);

  params.set("limit", String(LOAD_PAGE_SIZE));

  if (cursor) params.set("cursor", cursor);

  return params;
}

export type InboxListData = {
  enabled: boolean;
  conversations: ConversationView[];
  more: boolean;
  tags: TagView[];
  me: string;
  canSeeSettings: boolean;
};

export async function loadInboxList(input: {
  context: InboxAccessContext;
  filters: InboxListFilters;
  readGuard: InboxGuard;
  settingsGuard: InboxGuard;
  can: InboxCan;
}): Promise<InboxListData> {
  const { context, filters, readGuard, settingsGuard, can } = input;
  const me = context.auth.context.tenantUserId;

  // Checked AFTER the screen's authorization (the caller ran it), so an
  // unauthorised caller learns nothing about the switch.
  if (!isOmnichannelInboxEnabled()) {
    return {
      enabled: false,
      conversations: [],
      more: false,
      tags: [],
      me,
      canSeeSettings: false
    };
  }

  const visibility = await visibilityFor(context, readGuard);
  // One awaited query at a time: `tx` is one connection.
  const conversations: ConversationView[] = [];
  let cursor: string | null = null;
  let more = false;

  for (let page = 0; page < LOAD_PAGE_LIMIT; page += 1) {
    const validated = validateListConversationsQuery(
      inboxListParams(filters, cursor)
    );

    if (!validated.valid) break;

    const result = await listConversations(
      context.tx,
      context.tenantId,
      visibility,
      me,
      validated.value,
      context.now
    );

    conversations.push(...result.items);

    if (result.nextCursor === null) break;

    cursor = result.nextCursor;
    more = page === LOAD_PAGE_LIMIT - 1;
  }

  return {
    enabled: true,
    conversations,
    more,
    tags: await listTags(context.tx, context.tenantId),
    me,
    canSeeSettings: await can(settingsGuard)
  };
}

export type InboxDetailData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      conversation: ConversationView & { activity: ActivityView[] };
      tags: TagView[];
      me: string;
      canUpdate: boolean;
      canAssign: boolean;
    };

export async function loadInboxDetail(input: {
  context: InboxAccessContext;
  conversationId: string | null;
  readGuard: InboxGuard;
  updateGuard: InboxGuard;
  assignGuard: InboxGuard;
  can: InboxCan;
}): Promise<InboxDetailData> {
  const { context, conversationId, readGuard, can } = input;

  if (!isOmnichannelInboxEnabled()) return { enabled: false };

  if (conversationId === null) return { enabled: true, found: false };

  // A conversation the caller may not see is the same answer as an unknown id
  // or another tenant's id.
  const conversation = await getConversation(
    context.tx,
    context.tenantId,
    conversationId,
    await visibilityFor(context, readGuard),
    context.now
  );

  if (!conversation) return { enabled: true, found: false };

  return {
    enabled: true,
    found: true,
    conversation,
    tags: await listTags(context.tx, context.tenantId),
    me: context.auth.context.tenantUserId,
    canUpdate: await can(input.updateGuard),
    canAssign: await can(input.assignGuard)
  };
}

export type InboxSettingsData = {
  enabled: boolean;
  policies: SlaPolicyView[];
  /** `null` = the caller lacks `conversations.read`: no catalogue section, not an empty one. */
  tags: TagView[] | null;
  canConfigurePolicies: boolean;
  canConfigureTags: boolean;
  canRebuild: boolean;
};

export async function loadInboxSettings(input: {
  context: InboxAccessContext;
  slaReadGuard: InboxGuard;
  conversationsReadGuard: InboxGuard;
  slaConfigureGuard: InboxGuard;
  tagsConfigureGuard: InboxGuard;
  projectionConfigureGuard: InboxGuard;
  can: InboxCan;
}): Promise<InboxSettingsData> {
  const { context, can } = input;

  if (!isOmnichannelInboxEnabled()) {
    return {
      enabled: false,
      policies: [],
      tags: null,
      canConfigurePolicies: false,
      canConfigureTags: false,
      canRebuild: false
    };
  }

  // The route's own rule: the tenant default plus the scopes the caller covers
  // (everything when acting tenant-wide).
  const policies = await listSlaPolicies(
    context.tx,
    context.tenantId,
    await visibilityFor(context, input.slaReadGuard)
  );
  // The tag list is `conversations.read` on its endpoint.
  const tags = (await can(input.conversationsReadGuard))
    ? await listTags(context.tx, context.tenantId)
    : null;

  return {
    enabled: true,
    policies,
    tags,
    canConfigurePolicies: await can(input.slaConfigureGuard),
    canConfigureTags: await can(input.tagsConfigureGuard),
    canRebuild: await can(input.projectionConfigureGuard)
  };
}
