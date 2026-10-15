/**
 * The `booking` reservation state machine, pure (Issue #937, ADR-0131).
 *
 * The table test covers EVERY (state x action) pair -- 8 x 7 -- so a legal
 * transition cannot go missing and an illegal one cannot be added by accident.
 * `tests/integration/booking-database.integration.test.ts` asserts that the
 * database trigger agrees with this table for every pair of states.
 */
import { describe, expect, test } from "bun:test";

import { BOOKING_AUDIT_EVENTS } from "../src/modules/booking/domain/booking-audit";
import {
  BOOKING_GUARDS,
  BOOKING_MODULE_KEY
} from "../src/modules/booking/domain/booking-permissions";
import {
  RESERVATION_ACTIONS,
  RESERVATION_STATUSES,
  TERMINAL_RESERVATION_STATUSES,
  creationEventKinds,
  evaluateTransition,
  initialReservationStatus,
  isTerminalReservationStatus,
  type ReservationAction,
  type ReservationStatus
} from "../src/modules/booking/domain/booking-reservation-state";
import { bookingModule } from "../src/modules/booking/module";

const NOW = new Date("2026-10-12T10:00:00.000Z");
const FUTURE = new Date("2026-10-12T10:15:00.000Z");
const PAST = new Date("2026-10-12T09:45:00.000Z");

/** The complete legal set, written out independently of the implementation. */
const LEGAL: Record<
  ReservationAction,
  Partial<Record<ReservationStatus, ReservationStatus>>
> = {
  extend: { held: "held" },
  confirm: { held: "confirmed" },
  expire: { held: "expired" },
  cancel: { held: "cancelled", confirmed: "cancelled" },
  reschedule: { confirmed: "rescheduled" },
  check_in: { confirmed: "checked_in" },
  complete: { checked_in: "completed" },
  no_show: { confirmed: "no_show" }
};

function decide(from: ReservationStatus, action: ReservationAction) {
  // A live hold for `confirm`; an elapsed one for `expire`, so each legal pair
  // is reachable. The expiry rules have their own tests below.
  const holdExpiresAt =
    from === "held" ? (action === "expire" ? PAST : FUTURE) : null;
  return evaluateTransition({ from, action, now: NOW, holdExpiresAt });
}

describe("reservation state machine: every state x action pair", () => {
  for (const action of RESERVATION_ACTIONS) {
    for (const from of RESERVATION_STATUSES) {
      const to = LEGAL[action][from];
      test(`${from} --${action}--> ${to ?? "refused"}`, () => {
        const result = decide(from, action);
        if (to) {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.to).toBe(to);
          }
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("INVALID_STATE");
            expect(result.httpStatus).toBe(409);
          }
        }
      });
    }
  }

  test("the legal set has exactly 9 transitions (extend included)", () => {
    const count = RESERVATION_ACTIONS.flatMap((action) =>
      RESERVATION_STATUSES.filter((from) => decide(from, action).ok)
    ).length;
    expect(count).toBe(9);
  });

  test("a terminal state accepts no action at all", () => {
    for (const from of TERMINAL_RESERVATION_STATUSES) {
      for (const action of RESERVATION_ACTIONS) {
        expect(decide(from, action).ok).toBe(false);
      }
    }
  });

  test("terminal statuses are exactly those with no outgoing transition", () => {
    for (const status of RESERVATION_STATUSES) {
      const hasOutgoing = RESERVATION_ACTIONS.some(
        (action) => decide(status, action).ok
      );
      expect(isTerminalReservationStatus(status)).toBe(!hasOutgoing);
    }
  });
});

describe("hold expiry (the database clock is the only clock)", () => {
  test("confirming an expired hold is HOLD_EXPIRED even without a sweep", () => {
    const result = evaluateTransition({
      from: "held",
      action: "confirm",
      now: NOW,
      holdExpiresAt: PAST
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("HOLD_EXPIRED");
      expect(result.httpStatus).toBe(409);
    }
  });

  test("a hold expiring exactly now is expired (half-open)", () => {
    const result = evaluateTransition({
      from: "held",
      action: "confirm",
      now: NOW,
      holdExpiresAt: NOW
    });
    expect(result.ok).toBe(false);
  });

  test("extending an expired hold is HOLD_EXPIRED; a live one may be extended", () => {
    expect(
      evaluateTransition({
        from: "held",
        action: "extend",
        now: NOW,
        holdExpiresAt: PAST
      })
    ).toMatchObject({ ok: false, code: "HOLD_EXPIRED" });
    expect(
      evaluateTransition({
        from: "held",
        action: "extend",
        now: NOW,
        holdExpiresAt: FUTURE
      })
    ).toMatchObject({ ok: true, to: "held" });
  });

  test("an unexpired hold cannot be reclaimed as expired", () => {
    const result = evaluateTransition({
      from: "held",
      action: "expire",
      now: NOW,
      holdExpiresAt: FUTURE
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  test("a held reservation without an expiry is refused, never 'forever'", () => {
    const result = evaluateTransition({
      from: "held",
      action: "confirm",
      now: NOW,
      holdExpiresAt: null
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  test("cancelling a hold is allowed whether or not it has expired", () => {
    for (const holdExpiresAt of [PAST, FUTURE]) {
      expect(
        evaluateTransition({
          from: "held",
          action: "cancel",
          now: NOW,
          holdExpiresAt
        }).ok
      ).toBe(true);
    }
  });
});

describe("what each transition does to allocations and history", () => {
  test("only expire, cancel and reschedule release allocations, with their reason", () => {
    const released = RESERVATION_ACTIONS.flatMap((action) =>
      RESERVATION_STATUSES.map((from) => ({
        action,
        result: decide(from, action)
      }))
    )
      .filter(
        (entry) => entry.result.ok && entry.result.allocations === "release"
      )
      .map((entry) =>
        entry.result.ok ? [entry.action, entry.result.releasedReason] : []
      );
    expect(new Set(released.map((pair) => pair.join(":")))).toEqual(
      new Set(["expire:expired", "cancel:cancelled", "reschedule:rescheduled"])
    );
  });

  test("completing and no-show keep the booked interval (not shrunk)", () => {
    for (const [from, action] of [
      ["checked_in", "complete"],
      ["confirmed", "no_show"],
      ["confirmed", "check_in"],
      ["held", "confirm"]
    ] as const) {
      const result = decide(from, action);
      expect(result.ok && result.allocations).toBe("keep");
    }
  });

  test("only confirm clears the hold expiry", () => {
    for (const action of RESERVATION_ACTIONS) {
      for (const from of RESERVATION_STATUSES) {
        const result = decide(from, action);
        if (result.ok) {
          expect(result.clearsHoldExpiry).toBe(action === "confirm");
        }
      }
    }
  });

  test("each transition appends the event of the state it reaches", () => {
    for (const action of RESERVATION_ACTIONS) {
      for (const from of RESERVATION_STATUSES) {
        const result = decide(from, action);
        if (result.ok) {
          // An extension changes no status and appends no event.
          expect(result.eventKind).toBe(action === "extend" ? null : result.to);
        }
      }
    }
  });

  test("severity follows the design table: cancel, reschedule, no_show warn", () => {
    expect(decide("confirmed", "cancel")).toMatchObject({
      severity: "warning"
    });
    expect(decide("confirmed", "reschedule")).toMatchObject({
      severity: "warning"
    });
    expect(decide("confirmed", "no_show")).toMatchObject({
      severity: "warning"
    });
    expect(decide("held", "confirm")).toMatchObject({ severity: "info" });
  });

  test("expiry is a system action; every other verb names its permission", () => {
    expect(decide("held", "expire")).toMatchObject({ permissionAction: null });
    for (const action of RESERVATION_ACTIONS.filter((a) => a !== "expire")) {
      const from = RESERVATION_STATUSES.find((s) => decide(s, action).ok)!;
      const result = decide(from, action);
      // Extending a hold needs `reservations.create` (booking.md section 5.1).
      expect(result.ok && result.permissionAction).toBe(
        action === "extend" ? "create" : action
      );
    }
  });
});

describe("creation", () => {
  test("immediate offerings are born confirmed, the rest held", () => {
    expect(initialReservationStatus("immediate")).toBe("confirmed");
    expect(initialReservationStatus("hold_then_confirm")).toBe("held");
  });

  test("created + confirmed for immediate; created + held otherwise", () => {
    expect(creationEventKinds("immediate")).toEqual(["created", "confirmed"]);
    expect(creationEventKinds("hold_then_confirm")).toEqual([
      "created",
      "held"
    ]);
  });
});

describe("module descriptor, guards and audit names stay in step", () => {
  test("the module is active, declares its API fragment and one screen per read permission", () => {
    expect(bookingModule.key).toBe(BOOKING_MODULE_KEY);
    // Issue #942 shipped the admin screens, so ADR-0021 criterion 1 (every
    // ACTIVE module declares a screen) holds and the module left `experimental`.
    expect(bookingModule.status).toBe("active");
    expect(bookingModule.api?.openApiPath).toBe(
      "openapi/modules/booking.openapi.yaml"
    );
    expect(
      (bookingModule.navigation ?? []).map((entry) => [
        entry.path,
        entry.requiredPermission
      ])
    ).toEqual([
      ["/admin/booking/reservations", "booking.reservations.read"],
      ["/admin/booking/resources", "booking.resources.read"],
      ["/admin/booking/offerings", "booking.offerings.read"],
      ["/admin/booking/schedules", "booking.schedules.read"],
      ["/admin/booking/blocks", "booking.blocks.read"],
      ["/admin/booking/policy", "booking.policy.read"]
    ]);
  });

  test("it does not depend on commerce or any ERP module", () => {
    // `domain_event_runtime` since Issue #941: the nine reservation events are
    // published through its outbox, in the same transaction as the transition.
    expect(bookingModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "logging",
      "domain_event_runtime"
    ]);
  });

  test("every guard literal is a declared permission, and vice versa", () => {
    const declared = new Set(
      (bookingModule.permissions ?? []).map(
        (p) => `${p.activityCode}.${p.action}`
      )
    );
    const guards = new Set<string>();
    for (const group of Object.values(BOOKING_GUARDS)) {
      for (const guard of Object.values(group)) {
        expect(guard.moduleKey).toBe("booking");
        guards.add(`${guard.activityCode}.${guard.action}`);
      }
    }
    expect(guards).toEqual(declared);
    expect(declared.size).toBe(32);
  });

  test("audit actions are unique, namespaced and the override is critical", () => {
    const actions = Object.values(BOOKING_AUDIT_EVENTS).map((e) => e.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const action of actions) {
      expect(action.startsWith("booking.")).toBe(true);
    }
    expect(BOOKING_AUDIT_EVENTS.reservationOverridden.severity).toBe(
      "critical"
    );
    expect(BOOKING_AUDIT_EVENTS.reservationCancelled.severity).toBe("warning");
  });
});
