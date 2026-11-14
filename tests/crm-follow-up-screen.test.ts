/**
 * Pure rules of the follow-up screens (Issue #1165, ADR-0159): how the URL
 * filters become the API's own query, how two due-ordered streams merge without
 * ever showing a row past a gap, and how stored minutes become text. No
 * database; the behavioural side is
 * `tests/integration/crm-follow-up-screens.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  actionKindLabel,
  noticeSettleLabel,
  reasonLabel,
  stopKindLabel,
  taskOutcomeLabel,
  taskStatusLabel,
  taskStatusTone
} from "../src/lib/i18n/labels/crm-follow-up";
import { getTranslator } from "../src/lib/i18n";
import {
  minutesToClock,
  offsetParts,
  switchBody
} from "../src/lib/ui/crm-follow-up-screen";
import {
  LOAD_PAGE_SIZE,
  mergeStreams,
  statusStreams,
  worklistParams
} from "../src/modules/crm-follow-up/application/screen-loaders";
import {
  STOP_KINDS,
  TASK_OUTCOMES,
  TASK_STATUSES
} from "../src/modules/crm-follow-up/domain/crm-follow-up-constants";
import { validateTaskListQuery } from "../src/modules/crm-follow-up/domain/crm-follow-up-validation";

const row = (dueAt: string, id: string) => ({ dueAt, id });

describe("status views", () => {
  test("the default view is the live work: open and escalated", () => {
    expect(statusStreams(null)).toEqual(["open", "escalated"]);
    expect(statusStreams(undefined)).toEqual(["open", "escalated"]);
    // An unknown value never widens the view to the closed history.
    expect(statusStreams("deleted")).toEqual(["open", "escalated"]);
  });

  test("one status is one stream, and 'all' is one unfiltered stream", () => {
    for (const status of TASK_STATUSES) {
      expect(statusStreams(status)).toEqual([status]);
    }

    expect(statusStreams("all")).toEqual([""]);
  });
});

describe("the URL becomes the API's own query", () => {
  test("every stream's query passes the API's own validator", () => {
    for (const stream of ["", ...TASK_STATUSES]) {
      for (const filters of [
        {},
        { assignee: "me" },
        { overdue: "true" },
        { assignee: "me", overdue: "true", status: "open" }
      ]) {
        const validated = validateTaskListQuery(
          worklistParams(stream, filters, null)
        );

        expect(validated.valid).toBe(true);
      }
    }
  });

  test("an unknown filter value is dropped, never forwarded", () => {
    const params = worklistParams(
      "open",
      { assignee: "someone-else", overdue: "yes" },
      null
    );

    expect(params.get("assignee")).toBeNull();
    expect(params.get("overdue")).toBeNull();
    expect(params.get("status")).toBe("open");
    expect(params.get("limit")).toBe(String(LOAD_PAGE_SIZE));
  });

  test("'assigned to me' is the API's own 'me', resolved server-side", () => {
    expect(
      worklistParams("open", { assignee: "me" }, null).get("assignee")
    ).toBe("me");
  });

  test("a cursor is carried only when given", () => {
    expect(worklistParams("open", {}, null).has("cursor")).toBe(false);
    expect(worklistParams("open", {}, "c").get("cursor")).toBe("c");
  });
});

describe("merging the open and escalated streams", () => {
  test("two complete streams interleave in due order", () => {
    const merged = mergeStreams(
      [
        {
          items: [
            row("2026-01-01T00:00:00Z", "a"),
            row("2026-01-03T00:00:00Z", "c")
          ],
          truncated: false
        },
        { items: [row("2026-01-02T00:00:00Z", "b")], truncated: false }
      ],
      10
    );

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged.more).toBe(false);
  });

  test("a truncated stream caps the list at its own last row", () => {
    // Stream one stops at day 2 with more behind it; stream two has a row on
    // day 5. Showing day 5 would hide whatever stream one holds on days 3-4.
    const merged = mergeStreams(
      [
        {
          items: [
            row("2026-01-01T00:00:00Z", "a"),
            row("2026-01-02T00:00:00Z", "b")
          ],
          truncated: true
        },
        { items: [row("2026-01-05T00:00:00Z", "z")], truncated: false }
      ],
      10
    );

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged.more).toBe(true);
  });

  test("the maximum is a hard bound and reports that more exist", () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      row(`2026-01-0${index + 1}T00:00:00Z`, `t${index}`)
    );
    const merged = mergeStreams([{ items, truncated: false }], 3);

    expect(merged.items).toHaveLength(3);
    expect(merged.more).toBe(true);
  });

  test("rows due at the same instant are ordered by id, deterministically", () => {
    const merged = mergeStreams(
      [
        { items: [row("2026-01-01T00:00:00Z", "b")], truncated: false },
        { items: [row("2026-01-01T00:00:00Z", "a")], truncated: false }
      ],
      10
    );

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("labels cover every closed vocabulary and never blank a cell", () => {
  const { t } = getTranslator("id");
  const en = getTranslator("en").t;

  test("every status, outcome and stop kind has a label, not its raw token", () => {
    for (const status of TASK_STATUSES) {
      expect(taskStatusLabel(en, status)).not.toBe(status);
    }

    for (const outcome of TASK_OUTCOMES) {
      expect(taskOutcomeLabel(en, outcome)).not.toBe(outcome);
    }

    for (const kind of STOP_KINDS) {
      expect(stopKindLabel(en, kind)).not.toBe(kind);
      expect(reasonLabel(en, `stop_${kind}`)).toContain(
        stopKindLabel(en, kind)
      );
    }
  });

  test("an unknown token falls back to itself, null reasons to nothing", () => {
    expect(taskStatusLabel(t, "weird")).toBe("weird");
    expect(actionKindLabel(t, "weird")).toBe("weird");
    expect(reasonLabel(t, null)).toBe("");
    expect(noticeSettleLabel(t, null)).toBe("");
    expect(taskStatusTone("weird")).toBe("neutral");
  });

  test("the Indonesian catalogue translates the labels", () => {
    expect(taskStatusLabel(t, "escalated")).toBe("Dieskalasi");
  });
});

describe("minutes become text", () => {
  test("a minute-of-day is a clock time", () => {
    expect(minutesToClock(540)).toBe("09:00");
    expect(minutesToClock(1440)).toBe("24:00");
    expect(minutesToClock(1020)).toBe("17:00");
  });

  test("an offset is hours and minutes, never negative", () => {
    expect(offsetParts(90)).toEqual({ hours: 1, minutes: 30 });
    expect(offsetParts(0)).toEqual({ hours: 0, minutes: 0 });
    expect(offsetParts(-5)).toEqual({ hours: 0, minutes: 0 });
    expect(offsetParts(Number.NaN)).toEqual({ hours: 0, minutes: 0 });
  });

  test("the switch asks for the opposite of what is shown", () => {
    expect(switchBody(true)).toEqual({ enabled: false });
    expect(switchBody(false)).toEqual({ enabled: true });
  });
});
