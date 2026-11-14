/**
 * What the three `/admin/crm-follow-up` screens read, as functions (Issue
 * #1165, ADR-0159, ADR-0149).
 *
 * The screens call the SAME directory functions the API routes call
 * (`listTasks`, `fetchTaskDetail`, `listStopSignals`, `listRules`,
 * `fetchRuleWithRevisions`, `fetchSettings`), with the viewer's own id for
 * "assigned to me". Keeping the chain here, not inline in `.astro`
 * frontmatter, lets a behavioural integration test run the SAME code as a
 * limited viewer instead of matching source text (the lesson of the #1164
 * audit).
 *
 * Authorization of the entry itself stays with `loadAdminScreen`; these run
 * only after it allowed the page. The deployment switch is checked HERE, so it
 * is read only after authorization and an unauthorised caller learns nothing
 * about it.
 *
 * There is NO business-scope dimension to confine on: a task holds only an
 * opaque lead id, never a brand or office (ADR-0159, no lead copy), exactly as
 * `GET /tasks` lists the tenant's queue. What this module's screens keep is
 * tenant isolation (the directories' own `tenant_id` predicate plus FORCE RLS)
 * and per-permission controls, both pinned by tests.
 */
import {
  CRM_FOLLOW_UP_MODULE_KEY,
  TASK_STATUSES,
  isCrmFollowUpEnabled
} from "../domain/crm-follow-up-constants";
import { validateTaskListQuery } from "../domain/crm-follow-up-validation";
import {
  fetchRuleWithRevisions,
  listRules,
  type RevisionView,
  type RuleView
} from "./rule-directory";
import { fetchSettings, type CrmFollowUpSettings } from "./settings-directory";
import {
  fetchTaskDetail,
  listStopSignals,
  listTasks,
  type NotificationView,
  type StopSignalView,
  type TaskActionView
} from "./task-directory";
import type { TaskView } from "./task-engine";

type Sql = Bun.SQL;

/** The screen's own guard, spelled out by each page as a literal. */
export type FollowUpGuard = {
  moduleKey: typeof CRM_FOLLOW_UP_MODULE_KEY;
  activityCode: string;
  action: "read" | "create" | "update" | "configure";
};

/** `can()` of `loadAdminScreen`: the chokepoint, one boolean per probe. */
export type FollowUpCan = (guard: FollowUpGuard) => Promise<boolean>;

export type FollowUpScreenContext = {
  tx: Sql;
  tenantId: string;
  /** The viewer's authorization result; only the acting person is read. */
  auth: { context: { tenantUserId: string } };
  now: Date;
};

/** Two keyset pages of the API's own query: the bound of what a list loads. */
export const LOAD_PAGE_SIZE = 100;
export const LOAD_PAGE_LIMIT = 2;

/**
 * The status filter's default: the work still to do (`open` and `escalated`).
 * The queue is ordered by DUE instant ascending, so without this the oldest
 * completed tasks would fill the bounded load and push live work off it.
 */
export const STATUS_VIEW_LIVE = "live";
export const STATUS_VIEW_ALL = "all";

export type WorklistFilters = {
  /** `live` (default), `all`, or one of the four task statuses. */
  status?: string | null;
  /** `me` or nothing (anyone). */
  assignee?: string | null;
  /** `true` or nothing. */
  overdue?: string | null;
};

/** The streams one status view reads: `live` is two statuses merged, `all` is one unfiltered. */
export function statusStreams(status: string | null | undefined): string[] {
  if (status === STATUS_VIEW_ALL) return [""];

  if (status && (TASK_STATUSES as readonly string[]).includes(status)) {
    return [status];
  }

  return ["open", "escalated"];
}

/** The URL filters as the API's own query string; an unknown value is dropped, never an error. */
export function worklistParams(
  stream: string,
  filters: WorklistFilters,
  cursor: string | null
): URLSearchParams {
  const params = new URLSearchParams();

  if (stream !== "") params.set("status", stream);

  if (filters.assignee === "me") params.set("assignee", "me");

  if (filters.overdue === "true") params.set("overdue", "true");

  params.set("limit", String(LOAD_PAGE_SIZE));

  if (cursor) params.set("cursor", cursor);

  return params;
}

type Keyed = { dueAt: string; id: string };

const compareKeys = (a: Keyed, b: Keyed) =>
  a.dueAt < b.dueAt
    ? -1
    : a.dueAt > b.dueAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/**
 * Merges due-ordered streams into one due-ordered list that is CORRECT up to
 * its end: a stream that was cut off (it has more rows than were loaded) caps
 * the merged list at its own last row, so no row of another stream is shown
 * past a point where this one's rows are missing.
 */
export function mergeStreams<T extends Keyed>(
  streams: { items: T[]; truncated: boolean }[],
  max: number
): { items: T[]; more: boolean } {
  let cap: Keyed | null = null;

  for (const stream of streams) {
    const last = stream.items[stream.items.length - 1];

    if (
      stream.truncated &&
      last &&
      (cap === null || compareKeys(last, cap) < 0)
    ) {
      cap = last;
    }
  }

  const merged = streams
    .flatMap((stream) => stream.items)
    .filter((item) => cap === null || compareKeys(item, cap) <= 0)
    .sort(compareKeys);
  const items = merged.slice(0, max);

  return { items, more: cap !== null || merged.length > max };
}

export type WorklistData = {
  enabled: boolean;
  tasks: TaskView[];
  more: boolean;
  me: string;
  /** The tenant's own switch: while off, tasks can be read but not closed. */
  tenantEnabled: boolean;
  canSeeRules: boolean;
};

export async function loadWorklist(input: {
  context: FollowUpScreenContext;
  filters: WorklistFilters;
  rulesReadGuard: FollowUpGuard;
  can: FollowUpCan;
}): Promise<WorklistData> {
  const { context, filters, can } = input;
  const me = context.auth.context.tenantUserId;

  if (!isCrmFollowUpEnabled()) {
    return {
      enabled: false,
      tasks: [],
      more: false,
      me,
      tenantEnabled: false,
      canSeeRules: false
    };
  }

  // One awaited query at a time: `tx` is one connection.
  const streams: { items: TaskView[]; truncated: boolean }[] = [];

  for (const stream of statusStreams(filters.status)) {
    const items: TaskView[] = [];
    let cursor: string | null = null;
    let truncated = false;

    for (let page = 0; page < LOAD_PAGE_LIMIT; page += 1) {
      const validated = validateTaskListQuery(
        worklistParams(stream, filters, cursor)
      );

      if (!validated.valid) break;

      const result = await listTasks(
        context.tx,
        context.tenantId,
        me,
        validated.value,
        context.now
      );

      items.push(...result.items);

      if (result.nextCursor === null) break;

      cursor = result.nextCursor;
      truncated = page === LOAD_PAGE_LIMIT - 1;
    }

    streams.push({ items, truncated });
  }

  const merged = mergeStreams(streams, LOAD_PAGE_SIZE * LOAD_PAGE_LIMIT);
  const settings = await fetchSettings(context.tx, context.tenantId);

  return {
    enabled: true,
    tasks: merged.items,
    more: merged.more,
    me,
    tenantEnabled: settings.enabled,
    canSeeRules: await can(input.rulesReadGuard)
  };
}

export type TaskDetailData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      task: TaskView;
      actions: TaskActionView[];
      notifications: NotificationView[];
      stopSignals: StopSignalView[];
      me: string;
      tenantEnabled: boolean;
      canUpdate: boolean;
      canStop: boolean;
    };

export async function loadTaskDetail(input: {
  context: FollowUpScreenContext;
  taskId: string | null;
  updateGuard: FollowUpGuard;
  stopGuard: FollowUpGuard;
  can: FollowUpCan;
}): Promise<TaskDetailData> {
  const { context, taskId, can } = input;

  if (!isCrmFollowUpEnabled()) return { enabled: false };

  if (taskId === null) return { enabled: true, found: false };

  // An unknown id and another tenant's id are the same answer.
  const detail = await fetchTaskDetail(
    context.tx,
    context.tenantId,
    taskId,
    context.now
  );

  if (!detail) return { enabled: true, found: false };

  const settings = await fetchSettings(context.tx, context.tenantId);

  return {
    enabled: true,
    found: true,
    task: detail.task,
    actions: detail.actions,
    notifications: detail.notifications,
    stopSignals: await listStopSignals(
      context.tx,
      context.tenantId,
      detail.task.leadId
    ),
    me: context.auth.context.tenantUserId,
    tenantEnabled: settings.enabled,
    canUpdate: await can(input.updateGuard),
    canStop: await can(input.stopGuard)
  };
}

export type RulesData = {
  enabled: boolean;
  rules: RuleView[];
  /** The rule the caller opened, with every revision, or `null`. */
  selected: { rule: RuleView; revisions: RevisionView[] } | null;
  /** The URL asked for a rule that does not exist in this tenant. */
  selectedNotFound: boolean;
  settings: CrmFollowUpSettings;
  me: string;
  canConfigure: boolean;
};

export async function loadRules(input: {
  context: FollowUpScreenContext;
  selectedRuleId: string | null;
  configureGuard: FollowUpGuard;
  can: FollowUpCan;
}): Promise<RulesData> {
  const { context, can } = input;

  if (!isCrmFollowUpEnabled()) {
    return {
      enabled: false,
      rules: [],
      selected: null,
      selectedNotFound: false,
      settings: {
        enabled: false,
        maxNoticesPerRecipientHour: 0,
        updatedAt: null
      },
      me: context.auth.context.tenantUserId,
      canConfigure: false
    };
  }

  const rules = await listRules(context.tx, context.tenantId);
  const selected =
    input.selectedRuleId === null
      ? null
      : await fetchRuleWithRevisions(
          context.tx,
          context.tenantId,
          input.selectedRuleId
        );

  return {
    enabled: true,
    rules,
    selected,
    selectedNotFound: input.selectedRuleId !== null && selected === null,
    settings: await fetchSettings(context.tx, context.tenantId),
    me: context.auth.context.tenantUserId,
    canConfigure: await can(input.configureGuard)
  };
}
