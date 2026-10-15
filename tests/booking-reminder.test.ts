/**
 * Booking reminder intents, the parts that need no database (Issue #943,
 * ADR-0131, ADR-0133 sections 3 and 8). The behaviour against PostgreSQL is
 * `tests/integration/booking-reminder.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { bookingModule } from "../src/modules/booking/module";
import {
  BOOKING_REMINDER_MAX_ATTEMPTS,
  BOOKING_WHATSAPP_TEMPLATES,
  BOOKING_CONFIRMATION_FRESH_SECONDS,
  BOOKING_REMINDER_BATCH_LIMIT,
  BOOKING_REMINDER_DISPATCH_BATCH_LIMIT,
  BOOKING_REMINDER_DISPATCH_BUDGET_MS,
  BOOKING_REMINDER_LOCK_TIMEOUT_MS,
  BOOKING_REMINDER_STATEMENT_TIMEOUT_MS,
  TERMINAL_MESSAGE_STATUSES,
  formatLocalStart,
  messageExpiry,
  reminderIdempotencyKey,
  settlementFor,
  staleIntentStatus
} from "../src/modules/booking/domain/booking-reminder";
import { registerBookingWhatsappTemplates } from "../src/modules/booking/infrastructure/booking-whatsapp-templates";
import {
  getWhatsappTemplate,
  renderWhatsappTemplate
} from "../src/modules/whatsapp-delivery/domain/whatsapp-templates";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function listFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? listFiles(join(directory, entry.name))
        : [join(directory, entry.name)]
  );
}

describe("the idempotency key", () => {
  const base = {
    reservationId: "r-1",
    kind: "reminder",
    occurrence: 1
  } as const;

  test("is a pure function of (reservation, kind, occurrence)", () => {
    expect(reminderIdempotencyKey(base)).toBe(
      reminderIdempotencyKey({ ...base })
    );
    expect(reminderIdempotencyKey(base)).toBe("booking:r-1:reminder:1");
  });

  test("differs for every component, so a confirmation never shadows a reminder", () => {
    const keys = new Set([
      reminderIdempotencyKey(base),
      reminderIdempotencyKey({ ...base, reservationId: "r-2" }),
      reminderIdempotencyKey({ ...base, kind: "confirmation", occurrence: 0 }),
      reminderIdempotencyKey({ ...base, occurrence: 2 })
    ]);

    expect(keys.size).toBe(4);
  });

  test("fits the delivery module's 200-character key limit for a uuid reservation", () => {
    expect(
      reminderIdempotencyKey({ ...base, reservationId: crypto.randomUUID() })
        .length
    ).toBeLessThan(200);
  });
});

describe("what an enqueue answer means", () => {
  test("queued and duplicate both settle enqueued with the message id", () => {
    for (const status of ["queued", "duplicate"] as const) {
      expect(settlementFor({ status, messageId: "m-1" }, 0)).toEqual({
        kind: "settle",
        status: "enqueued",
        outcomeCode: status,
        messageId: "m-1"
      });
    }
  });

  test("a suppression settles suppressed with its reason", () => {
    expect(
      settlementFor({ status: "suppressed", reason: "opt_out" }, 0)
    ).toMatchObject({
      kind: "settle",
      status: "suppressed",
      outcomeCode: "opt_out"
    });
  });

  test("a capability that is off, misconfigured or rate-limited is retried, and stops the pass", () => {
    for (const reason of [
      "DISABLED",
      "MISCONFIGURED",
      "RATE_LIMITED"
    ] as const) {
      expect(settlementFor({ status: "refused", reason }, 0)).toEqual({
        kind: "retry",
        outcomeCode: reason.toLowerCase(),
        stopPass: true
      });
    }
  });

  test("a rate limit is given up on after the bounded number of attempts", () => {
    expect(
      settlementFor(
        { status: "refused", reason: "RATE_LIMITED" },
        BOOKING_REMINDER_MAX_ATTEMPTS - 1
      )
    ).toMatchObject({ kind: "settle", status: "refused" });
  });

  test("every other refusal is a verdict about this message, not a retry", () => {
    for (const reason of [
      "CONSENT_REQUIRED",
      "TEMPLATE_UNKNOWN",
      "RECIPIENT_INVALID",
      "RECIPIENT_UNRESOLVED",
      "EXPIRY_REQUIRED"
    ] as const) {
      expect(settlementFor({ status: "refused", reason }, 0)).toMatchObject({
        kind: "settle",
        status: "refused",
        outcomeCode: reason.toLowerCase()
      });
    }
  });
});

describe("the message", () => {
  test("the start is shown in the reservation's own zone, falling back to UTC", () => {
    const start = new Date("2026-10-20T06:00:00Z");

    expect(formatLocalStart(start, "Asia/Pontianak")).toBe(
      "2026-10-20 13:00 (Asia/Pontianak)"
    );
    expect(formatLocalStart(start, "Not/AZone")).toBe("2026-10-20 06:00 (UTC)");
  });

  test("both templates register as transactional with only non-personal variables", () => {
    registerBookingWhatsappTemplates();
    registerBookingWhatsappTemplates();

    for (const template of BOOKING_WHATSAPP_TEMPLATES) {
      const registered = getWhatsappTemplate(template.key)!;

      expect(registered.purpose).toBe("transactional");
      expect([...registered.variables]).toEqual(["reservationNo", "startsAt"]);
    }
  });

  test("a variable that is not on the allow-list (a name, a number) is dropped, never sent", () => {
    registerBookingWhatsappTemplates();

    const rendered = renderWhatsappTemplate(
      getWhatsappTemplate("booking.reminder")!,
      {
        reservationNo: "BK-1",
        startsAt: "2026-10-20 13:00 (UTC)",
        customerName: "Sari",
        phone: "+6281234567890"
      }
    );

    expect(rendered.body).not.toContain("Sari");
    expect(rendered.body).not.toContain("6281234567890");
    expect(rendered.droppedVariables.sort()).toEqual(["customerName", "phone"]);
  });
});

describe("booking holds no channel credential and no second queue", () => {
  const sources = [
    ...listFiles("src/modules/booking"),
    "sql/284_awcms_booking_reminder_intents.sql",
    "sql/285_awcms_booking_reminder_functions.sql",
    "scripts/booking-reminders-dispatch.ts"
  ].filter((file) => /\.(ts|sql)$/.test(file));

  test("no source names a provider credential, token or API key variable", () => {
    for (const file of sources) {
      // Comments say what is absent; only code and SQL statements matter.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*(\/\/|--).*$/gm, "");

      // A delivery-module environment variable (not booking's own constants).
      expect(code).not.toMatch(/(?<![A-Z_])WHATSAPP_(?!ENABLED\b)[A-Z_]+/);
      expect(code).not.toMatch(
        /process\.env|api[_-]?key|access[_-]?token|bearer/i
      );
    }
  });

  test("the reminder tables hold no contact column", () => {
    const sql = read("sql/284_awcms_booking_reminder_intents.sql")
      .replace(/^\s*--.*$/gm, "")
      .replace(/COMMENT ON[\s\S]*?';/g, "");

    expect(sql).not.toMatch(
      /\b(phone|msisdn|email|recipient|body|variables)\b/i
    );
  });

  test("booking reaches whatsapp_delivery's code in exactly one declared place", () => {
    const importers = listFiles("src/modules/booking").filter(
      (file) =>
        file.endsWith(".ts") &&
        /from "(\.\.\/)+whatsapp-delivery\//.test(read(file))
    );

    expect(importers).toEqual([
      "src/modules/booking/infrastructure/booking-whatsapp-templates.ts"
    ]);
    expect(bookingModule.capabilities?.consumes).toContainEqual({
      capability: "whatsapp_delivery",
      providedBy: "whatsapp_delivery",
      optional: true
    });
  });

  test("booking creates no table named like a queue, outbox or attempt log of its own", () => {
    for (const file of sources.filter((entry) => entry.endsWith(".sql"))) {
      expect(read(file)).not.toMatch(
        /CREATE TABLE[^;]*(outbox|queue|messages|attempts)/i
      );
    }
  });
});

describe("the registry is complete in every process that sends", () => {
  test("the reminder job and whatsapp:dispatch both register booking's templates", () => {
    expect(read("scripts/booking-reminders-dispatch.ts")).toContain(
      "registerBookingWhatsappTemplates()"
    );
    expect(read("scripts/whatsapp-dispatch.ts")).toContain(
      "registerBookingWhatsappTemplates()"
    );
  });

  test("the job is declared on the descriptor and wired in package.json", () => {
    expect(bookingModule.jobs?.map((job) => job.command)).toContain(
      "bun run booking:reminders:dispatch"
    );
    expect(JSON.parse(read("package.json")).scripts).toHaveProperty(
      "booking:reminders:dispatch",
      "bun scripts/booking-reminders-dispatch.ts"
    );
  });
});

describe("review follow-ups", () => {
  const start = new Date("2026-10-20T06:00:00Z");

  test("M2: a reminder expires at the start; a confirmation at the earlier of the start and the freshness window", () => {
    expect(
      messageExpiry({ kind: "reminder", startsAt: start, confirmedAt: start })
    ).toEqual(start);

    const early = new Date(start.getTime() - 60 * 60 * 1000);

    expect(
      messageExpiry({
        kind: "confirmation",
        startsAt: start,
        confirmedAt: early
      })
    ).toEqual(start);

    const long = new Date(start.getTime() - 48 * 60 * 60 * 1000);

    expect(
      messageExpiry({
        kind: "confirmation",
        startsAt: start,
        confirmedAt: long
      }).getTime()
    ).toBe(long.getTime() + BOOKING_CONFIRMATION_FRESH_SECONDS * 1000);
  });

  test("M1: retry_wait and sending are not terminal", () => {
    expect(TERMINAL_MESSAGE_STATUSES).toEqual([
      "sent",
      "failed",
      "cancelled",
      "expired"
    ]);
  });

  test("I2: started or finished reservations expire the intent, cancelled ones cancel it", () => {
    for (const status of ["confirmed", "checked_in", "completed"]) {
      expect(staleIntentStatus(status)).toBe("expired");
    }

    for (const status of ["cancelled", "expired", "rescheduled"]) {
      expect(staleIntentStatus(status)).toBe("cancelled");
    }
  });

  test("L2: the dispatch holds few reservation locks, for a short time", () => {
    expect(BOOKING_REMINDER_DISPATCH_BATCH_LIMIT).toBeLessThanOrEqual(25);
    expect(BOOKING_REMINDER_DISPATCH_BATCH_LIMIT).toBeLessThan(
      BOOKING_REMINDER_BATCH_LIMIT
    );
    expect(BOOKING_REMINDER_DISPATCH_BUDGET_MS).toBeLessThanOrEqual(5_000);
    expect(BOOKING_REMINDER_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
    expect(BOOKING_REMINDER_STATEMENT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(
      read("src/modules/booking/application/booking-reminder-dispatch.ts")
    ).toMatch(/SET LOCAL lock_timeout[\s\S]*SET LOCAL statement_timeout/);
  });

  test("L1: the worker's grant on the intents is column-scoped", () => {
    const sql = read("sql/284_awcms_booking_reminder_intents.sql");

    expect(sql).toContain(
      "GRANT UPDATE (status, outcome_code, message_id, settled_at, attempts,"
    );
    expect(sql).not.toContain(
      "GRANT SELECT, UPDATE ON awcms_booking_reminder_intents"
    );
  });
});
