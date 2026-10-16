/**
 * Request validation for `hr_workforce` (Issue #945, ADR-0132). Pure: no
 * database. The point of the strict bodies is minimisation — an employment
 * REFERENCES a person and a client can never assert a personal field or the
 * derived end date.
 */
import { describe, expect, test } from "bun:test";

import {
  isCalendarDate,
  validateAssignAccount,
  validateChangeTerms,
  validateCreateEmployment,
  validateEmptyBody,
  validateReason,
  validateSettings
} from "../src/modules/hr-workforce/domain/hr-workforce-validation";
import { hrWorkforceModule } from "../src/modules/hr-workforce/module";

const PROFILE = "11111111-1111-4111-8111-111111111111";

const valid = {
  profileId: PROFILE,
  employeeNo: "E-1",
  hiredOn: "2026-01-05",
  employmentType: "permanent",
  status: "active"
};

function fields(result: { valid: boolean; errors?: { field: string }[] }) {
  return result.valid ? [] : result.errors!.map((e) => e.field);
}

describe("validateCreateEmployment", () => {
  test("accepts a minimal body and defaults the optional terms to null", () => {
    const result = validateCreateEmployment(valid);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.value.terms).toEqual({
        officeId: null,
        managerEmploymentId: null,
        jobTitle: null,
        employmentType: "permanent",
        status: "active"
      });
    }
  });

  test("rejects every personal, photo, biometric, device or derived field by name", () => {
    for (const extra of [
      "displayName",
      "legalName",
      "email",
      "phone",
      "address",
      "birthDate",
      "nik",
      "npwp",
      "photo",
      "faceTemplate",
      "deviceId",
      "terminatedOn",
      "tenantUserId"
    ]) {
      const result = validateCreateEmployment({ ...valid, [extra]: "x" });

      expect(fields(result)).toContain(extra);
    }
  });

  test("a new employment cannot start terminated", () => {
    expect(
      fields(validateCreateEmployment({ ...valid, status: "terminated" }))
    ).toContain("status");
  });

  test("checks identifiers, dates and enums", () => {
    expect(
      fields(
        validateCreateEmployment({
          ...valid,
          profileId: "nope",
          employeeNo: "-bad",
          hiredOn: "2026-02-30",
          employmentType: "volunteer",
          officeId: "x",
          jobTitle: ""
        })
      ).sort()
    ).toEqual(
      [
        "profileId",
        "employeeNo",
        "hiredOn",
        "employmentType",
        "officeId",
        "jobTitle"
      ].sort()
    );
  });

  test("rejects a non-object body", () => {
    expect(fields(validateCreateEmployment(null))).toEqual(["body"]);
    expect(fields(validateCreateEmployment([]))).toEqual(["body"]);
  });
});

describe("validateChangeTerms", () => {
  test("a terminated term is allowed here and needs effectiveFrom", () => {
    expect(
      validateChangeTerms({
        effectiveFrom: "2026-06-01",
        employmentType: "permanent",
        status: "terminated"
      }).valid
    ).toBe(true);
    expect(
      fields(
        validateChangeTerms({ employmentType: "permanent", status: "active" })
      )
    ).toContain("effectiveFrom");
  });

  test("refuses fields that are derived or belong to the header", () => {
    expect(
      fields(
        validateChangeTerms({
          effectiveFrom: "2026-06-01",
          employmentType: "permanent",
          status: "active",
          effectiveTo: "2026-07-01",
          employeeNo: "E-9",
          hiredOn: "2020-01-01"
        })
      ).sort()
    ).toEqual(["effectiveTo", "employeeNo", "hiredOn"].sort());
  });
});

describe("validateAssignAccount", () => {
  test("accepts a uuid or an explicit null, and requires the key", () => {
    expect(validateAssignAccount({ tenantUserId: PROFILE }).valid).toBe(true);
    expect(validateAssignAccount({ tenantUserId: null }).valid).toBe(true);
    expect(fields(validateAssignAccount({}))).toContain("tenantUserId");
    expect(fields(validateAssignAccount({ tenantUserId: "x" }))).toContain(
      "tenantUserId"
    );
  });
});

describe("validateSettings", () => {
  test("bounds the skew, shapes the key, and has no evidence setting", () => {
    expect(validateSettings({ clockSkewSeconds: 0 }).valid).toBe(true);
    expect(validateSettings({ clockSkewSeconds: 3600 }).valid).toBe(true);
    expect(fields(validateSettings({ clockSkewSeconds: 3601 }))).toContain(
      "clockSkewSeconds"
    );
    expect(fields(validateSettings({ clockSkewSeconds: 1.5 }))).toContain(
      "clockSkewSeconds"
    );
    expect(
      fields(validateSettings({ correctionWorkflowKey: "Bad Key" }))
    ).toContain("correctionWorkflowKey");
    expect(fields(validateSettings({}))).toEqual(["body"]);

    for (const evidence of ["evidenceMode", "geolocation", "photoRequired"]) {
      expect(fields(validateSettings({ [evidence]: true }))).toContain(
        evidence
      );
    }
  });
});

describe("small validators", () => {
  test("reason is optional or required, bounded", () => {
    expect(validateReason(false)(undefined).valid).toBe(true);
    expect(fields(validateReason(true)({}))).toContain("reason");
    expect(
      fields(validateReason(false)({ reason: "x".repeat(501) }))
    ).toContain("reason");
  });

  test("an empty body takes no field", () => {
    expect(validateEmptyBody(undefined).valid).toBe(true);
    expect(fields(validateEmptyBody({ a: 1 }))).toEqual(["a"]);
  });

  test("isCalendarDate rejects impossible dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
    expect(isCalendarDate("1900-01-01")).toBe(true);
    expect(isCalendarDate("2200-12-31")).toBe(true);
    expect(isCalendarDate("1899-12-31")).toBe(false);
    expect(isCalendarDate("2201-01-01")).toBe(false);
    expect(isCalendarDate("0001-01-01")).toBe(false);
  });
});

describe("the descriptor", () => {
  test("is experimental (flag off) and depends only on tenant_admin, profile_identity and domain_event_runtime", () => {
    expect(hrWorkforceModule.status).toBe("experimental");
    expect([...hrWorkforceModule.dependencies].sort()).toEqual([
      "domain_event_runtime",
      "profile_identity",
      "tenant_admin"
    ]);
    expect(hrWorkforceModule.navigation ?? []).toEqual([]);
  });

  test("every table is registered with data_lifecycle and the person tables with subjectData", () => {
    const lifecycle = (hrWorkforceModule.dataLifecycle ?? []).map(
      (d) => d.tableName
    );
    const subject = (hrWorkforceModule.subjectData ?? []).map(
      (d) => d.tableName
    );

    expect(lifecycle.sort()).toEqual([
      "awcms_hr_attendance_corrections",
      "awcms_hr_attendance_events",
      "awcms_hr_attendance_location_evidence",
      "awcms_hr_employment_terms",
      "awcms_hr_employments",
      "awcms_hr_geofences",
      "awcms_hr_geolocation_notice_acknowledgements",
      "awcms_hr_geolocation_notices",
      "awcms_hr_geolocation_settings",
      "awcms_hr_shift_assignments",
      "awcms_hr_shift_templates",
      "awcms_hr_workforce_settings"
    ]);
    expect(subject.sort()).toEqual([
      "awcms_hr_attendance_corrections",
      "awcms_hr_attendance_events",
      "awcms_hr_attendance_location_evidence",
      "awcms_hr_employment_terms",
      "awcms_hr_employments",
      "awcms_hr_geolocation_notice_acknowledgements",
      "awcms_hr_shift_assignments"
    ]);
  });
});
