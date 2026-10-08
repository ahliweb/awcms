/**
 * `asyncapi:provisional:check` -- every rule gets a planted defect, and the
 * committed document is held to the same rules so the gate cannot be green over
 * a file it never read.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";
import {
  collectProvisionalProblems,
  PROVISIONAL_ASYNCAPI_PATH
} from "../scripts/asyncapi-provisional-check";

const root = path.join(import.meta.dir, "..");

async function load(file: string): Promise<any> {
  return parse(await readFile(path.join(root, file), "utf8"));
}

const registryTypes = DOMAIN_EVENT_TYPE_REGISTRY.map((e) => e.eventType);

async function fixtures() {
  return {
    provisional: await load(PROVISIONAL_ASYNCAPI_PATH),
    live: await load("asyncapi/awcms-domain-events.asyncapi.yaml")
  };
}

function problemsOf(input: {
  provisional: unknown;
  live: unknown;
  registryTypes?: readonly string[];
}): string[] {
  return collectProvisionalProblems({
    registryTypes,
    ...input
  });
}

describe("asyncapi provisional check", () => {
  test("the committed document passes", async () => {
    expect(problemsOf(await fixtures())).toEqual([]);
  });

  test("carries the 22 settled event names", async () => {
    const { provisional } = await fixtures();
    const names = Object.keys(provisional.channels);

    expect(names).toHaveLength(22);
    for (const verb of [
      "created",
      "held",
      "confirmed",
      "rescheduled",
      "cancelled",
      "checked_in",
      "completed",
      "no_show",
      "expired"
    ]) {
      expect(names).toContain(`awcms.booking.reservation.${verb}`);
    }
    for (const name of [
      "attendance.recorded",
      "shift.assigned",
      "commission.accrued",
      "commission.approved",
      "payroll.finalized",
      "payroll.reversed"
    ]) {
      expect(names).toContain(`awcms.hr.${name}`);
    }
  });

  test("rejects a badly named channel", async () => {
    const input = await fixtures();
    input.provisional.channels["booking.reservation.created"] = {
      ...input.provisional.channels["awcms.booking.reservation.created"],
      address: "booking.reservation.created"
    };

    expect(problemsOf(input).join("\n")).toContain(
      'Channel "booking.reservation.created" does not match'
    );
  });

  test("rejects a name that is already a live channel", async () => {
    const input = await fixtures();
    const liveName = Object.keys(input.live.channels)[0]!;
    input.provisional.channels[liveName] = {
      ...input.provisional.channels["awcms.hr.shift.assigned"],
      address: liveName
    };

    expect(problemsOf(input).join("\n")).toContain("already live");
  });

  test("rejects a name already in DOMAIN_EVENT_TYPE_REGISTRY", async () => {
    const input = await fixtures();

    expect(
      problemsOf({
        ...input,
        registryTypes: [...registryTypes, "awcms.hr.shift.assigned"]
      }).join("\n")
    ).toContain("already in DOMAIN_EVENT_TYPE_REGISTRY");
  });

  test("rejects a forked envelope", async () => {
    const input = await fixtures();
    input.provisional.components.schemas.DomainEventEnvelope.required.pop();

    expect(problemsOf(input).join("\n")).toContain("must not fork");
  });

  test("rejects a dangling $ref and an unpinned eventType", async () => {
    const input = await fixtures();
    input.provisional.channels[
      "awcms.hr.shift.assigned"
    ].messages.HrShiftAssigned.$ref = "#/components/messages/Nope";
    input.provisional.components.messages.HrPayrollReversed.payload.allOf[1].properties.eventType.const =
      "awcms.hr.other.thing";

    const text = problemsOf(input).join("\n");
    expect(text).toContain("does not resolve");
    expect(text).toContain("must pin eventType");
  });

  test("rejects an amount or personal-data property and an open payload", async () => {
    const input = await fixtures();
    const schemas = input.provisional.components.schemas;
    schemas.HrPayrollFinalizedPayload.properties.grossAmount = {
      type: "string"
    };
    schemas.BookingReservationPayload.properties.paymentState = {
      type: "string"
    };
    schemas.WhatsappMessagePayload.properties.phoneNumber = { type: "string" };
    delete schemas.HrCommissionApprovedPayload.additionalProperties;

    const text = problemsOf(input).join("\n");
    expect(text).toContain('"grossAmount"');
    expect(text).toContain('"paymentState"');
    expect(text).toContain('"phoneNumber"');
    expect(text).toContain("additionalProperties: false");
  });

  test("rejects a document that is not marked provisional", async () => {
    const input = await fixtures();
    delete input.provisional.info["x-awcms-status"];
    input.provisional.info["x-awcms-emitted-by-code"] = true;

    const text = problemsOf(input).join("\n");
    expect(text).toContain("x-awcms-status");
    expect(text).toContain("x-awcms-emitted-by-code");
  });
});
