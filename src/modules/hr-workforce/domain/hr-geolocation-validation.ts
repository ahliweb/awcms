/**
 * Request validation for geolocation attendance evidence (Issue #970, ADR-0138).
 * Pure — no database, no config.
 *
 * **Strict bodies, and no value is ever echoed.** Every validator rejects a key
 * it does not know, and a refusal names the FIELD only, never the value: the
 * position sample is personal data and an error message is the likeliest place
 * for a value to leak into a log or a response. The sample accepts exactly three
 * numbers; an altitude, speed, heading, address or device value is refused, not
 * ignored.
 */
import { analysePolygon } from "./hr-geolocation-geometry";
import {
  GEO_LIMITS,
  type GeofenceShape,
  type PositionSample
} from "./hr-geolocation-types";
import {
  isCalendarDate,
  type Validated,
  type ValidationError
} from "./hr-workforce-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
// Control characters other than tab and newline.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

type Body = Record<string, unknown>;

function asBody(
  value: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): Body | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return null;
  }

  const body = value as Body;

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push({ field: key, message: `${key} is not an accepted field.` });
    }
  }

  return body;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

function uuidValue(
  body: Body,
  field: string,
  errors: ValidationError[],
  required: boolean
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    if (required) {
      errors.push({ field, message: `${field} is required.` });
    }

    return null;
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be a UUID.` });
    return null;
  }

  return value.toLowerCase();
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// --- The position sample (the only personal datum in the feature) ----------------

/**
 * The sample a clock event may carry: `{ latitude, longitude, accuracyMeters }`
 * and nothing else. Returns `null` for an absent / `null` sample (a declined
 * fix), a value for a well-formed one, or pushes an error naming ONLY the field.
 */
export function parsePositionSample(
  value: unknown,
  errors: ValidationError[]
): PositionSample | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push({
      field: "positionSample",
      message: "positionSample must be an object or null."
    });
    return null;
  }

  const sample = value as Body;
  let ok = true;

  for (const key of Object.keys(sample)) {
    if (!["latitude", "longitude", "accuracyMeters"].includes(key)) {
      errors.push({
        field: "positionSample",
        message:
          "positionSample accepts only latitude, longitude and accuracyMeters: no altitude, speed, heading, address, device or network value."
      });
      ok = false;
      break;
    }
  }

  const { latitude, longitude, accuracyMeters } = sample;

  if (!finiteNumber(latitude) || latitude < -90 || latitude > 90) {
    errors.push({
      field: "positionSample.latitude",
      message: "latitude must be a number from -90 to 90."
    });
    ok = false;
  }

  if (!finiteNumber(longitude) || longitude < -180 || longitude > 180) {
    errors.push({
      field: "positionSample.longitude",
      message: "longitude must be a number from -180 to 180."
    });
    ok = false;
  }

  if (
    !finiteNumber(accuracyMeters) ||
    accuracyMeters <= 0 ||
    accuracyMeters > GEO_LIMITS.maxReportedAccuracyMeters
  ) {
    errors.push({
      field: "positionSample.accuracyMeters",
      message: `accuracyMeters must be a number greater than 0 and at most ${GEO_LIMITS.maxReportedAccuracyMeters}.`
    });
    ok = false;
  }

  return ok
    ? {
        latitude: latitude as number,
        longitude: longitude as number,
        accuracyMeters: accuracyMeters as number
      }
    : null;
}

// --- Settings ----------------------------------------------------------------------

export type GeolocationSettingsInput = {
  enabled: boolean;
  accuracyCeilingMeters: number | null;
  /** `undefined` = keep; `null` = clear. */
  dpiaReference: string | null | undefined;
  dpiaRecordedOn: string | null | undefined;
  noticeId: string | null | undefined;
};

export function validateGeolocationSettings(
  raw: unknown
): Validated<GeolocationSettingsInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "enabled",
      "accuracyCeilingMeters",
      "dpiaReference",
      "dpiaRecordedOn",
      "noticeId"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  if (typeof body.enabled !== "boolean") {
    errors.push({
      field: "enabled",
      message: "enabled must be true or false."
    });
  }

  let accuracyCeilingMeters: number | null = null;

  if (body.accuracyCeilingMeters !== undefined) {
    const value = body.accuracyCeilingMeters;

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < GEO_LIMITS.minAccuracyCeilingMeters ||
      value > GEO_LIMITS.maxAccuracyCeilingMeters
    ) {
      errors.push({
        field: "accuracyCeilingMeters",
        message: `accuracyCeilingMeters must be an integer ${GEO_LIMITS.minAccuracyCeilingMeters}-${GEO_LIMITS.maxAccuracyCeilingMeters}.`
      });
    } else {
      accuracyCeilingMeters = value;
    }
  }

  let dpiaReference: string | null | undefined;

  if (body.dpiaReference !== undefined) {
    const value = body.dpiaReference;

    if (value === null) {
      dpiaReference = null;
    } else if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > GEO_LIMITS.dpiaReferenceMaxLength ||
      CONTROL_CHARACTERS.test(value)
    ) {
      errors.push({
        field: "dpiaReference",
        message: `dpiaReference must be a document reference of 1-${GEO_LIMITS.dpiaReferenceMaxLength} characters (the assessment itself is never stored).`
      });
    } else {
      dpiaReference = value.trim();
    }
  }

  let dpiaRecordedOn: string | null | undefined;

  if (body.dpiaRecordedOn !== undefined) {
    const value = body.dpiaRecordedOn;

    if (value === null) {
      dpiaRecordedOn = null;
    } else if (typeof value !== "string" || !isCalendarDate(value)) {
      errors.push({
        field: "dpiaRecordedOn",
        message: "dpiaRecordedOn must be a calendar date, YYYY-MM-DD."
      });
    } else {
      dpiaRecordedOn = value;
    }
  }

  let noticeId: string | null | undefined;

  if (body.noticeId !== undefined) {
    noticeId =
      body.noticeId === null ? null : uuidValue(body, "noticeId", errors, true);
  }

  return finish(errors, {
    enabled: body.enabled === true,
    accuracyCeilingMeters,
    dpiaReference,
    dpiaRecordedOn,
    noticeId
  });
}

// --- Geofences -----------------------------------------------------------------------

export type GeofenceInput = {
  officeId: string;
  label: string;
  shape: GeofenceShape;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  vertices: [number, number][] | null;
};

export function validateGeofence(raw: unknown): Validated<GeofenceInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "officeId",
      "label",
      "shape",
      "latitude",
      "longitude",
      "radiusMeters",
      "vertices"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const officeId = uuidValue(body, "officeId", errors, true);
  const labelRaw = body.label;
  let label = "";

  if (typeof labelRaw !== "string") {
    errors.push({ field: "label", message: "label is required." });
  } else {
    label = labelRaw.trim();

    if (
      label.length === 0 ||
      label.length > GEO_LIMITS.labelMaxLength ||
      CONTROL_CHARACTERS.test(label)
    ) {
      errors.push({
        field: "label",
        message: `label must be 1-${GEO_LIMITS.labelMaxLength} characters.`
      });
    }
  }

  const shape = body.shape;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let radiusMeters: number | null = null;
  let vertices: [number, number][] | null = null;

  if (shape === "circle") {
    if (
      !finiteNumber(body.latitude) ||
      body.latitude < -90 ||
      body.latitude > 90
    ) {
      errors.push({
        field: "latitude",
        message: "latitude must be a number from -90 to 90."
      });
    } else {
      latitude = body.latitude;
    }

    if (
      !finiteNumber(body.longitude) ||
      body.longitude < -180 ||
      body.longitude > 180
    ) {
      errors.push({
        field: "longitude",
        message: "longitude must be a number from -180 to 180."
      });
    } else {
      longitude = body.longitude;
    }

    if (
      typeof body.radiusMeters !== "number" ||
      !Number.isInteger(body.radiusMeters) ||
      body.radiusMeters < GEO_LIMITS.minRadiusMeters ||
      body.radiusMeters > GEO_LIMITS.maxRadiusMeters
    ) {
      errors.push({
        field: "radiusMeters",
        message: `radiusMeters must be an integer ${GEO_LIMITS.minRadiusMeters}-${GEO_LIMITS.maxRadiusMeters}.`
      });
    } else {
      radiusMeters = body.radiusMeters;
    }

    if (body.vertices !== undefined) {
      errors.push({
        field: "vertices",
        message: "vertices is only for shape polygon."
      });
    }
  } else if (shape === "polygon") {
    const list = body.vertices;

    if (
      !Array.isArray(list) ||
      list.length < GEO_LIMITS.minVertices ||
      list.length > GEO_LIMITS.maxVertices
    ) {
      errors.push({
        field: "vertices",
        message: `vertices must be a list of ${GEO_LIMITS.minVertices}-${GEO_LIMITS.maxVertices} [latitude, longitude] pairs.`
      });
    } else {
      const parsed: [number, number][] = [];
      let wellFormed = true;

      for (const pair of list) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !finiteNumber(pair[0]) ||
          !finiteNumber(pair[1]) ||
          pair[0] < -90 ||
          pair[0] > 90 ||
          pair[1] < -180 ||
          pair[1] > 180
        ) {
          wellFormed = false;
          break;
        }

        parsed.push([pair[0], pair[1]]);
      }

      if (wellFormed) {
        const shape = analysePolygon(parsed);

        if (!shape.simple) {
          errors.push({
            field: "vertices",
            message:
              "the polygon must be simple: no repeated vertex and no edge crossing another."
          });
        } else if (
          shape.areaSquareMeters < GEO_LIMITS.minPolygonAreaSquareMeters
        ) {
          errors.push({
            field: "vertices",
            message: `the polygon must enclose at least ${GEO_LIMITS.minPolygonAreaSquareMeters} square metres.`
          });
        } else if (shape.extentMeters > GEO_LIMITS.maxPolygonExtentMeters) {
          errors.push({
            field: "vertices",
            message: `the polygon may span at most ${GEO_LIMITS.maxPolygonExtentMeters} metres.`
          });
        } else {
          vertices = parsed;
        }
      } else {
        errors.push({
          field: "vertices",
          message:
            "every vertex must be a [latitude, longitude] pair within range."
        });
      }
    }

    for (const field of ["latitude", "longitude", "radiusMeters"]) {
      if (body[field] !== undefined) {
        errors.push({
          field,
          message: `${field} is only for shape circle.`
        });
      }
    }
  } else {
    errors.push({
      field: "shape",
      message: "shape must be circle or polygon."
    });
  }

  return finish(errors, {
    officeId: officeId ?? "",
    label,
    shape: shape as GeofenceShape,
    latitude,
    longitude,
    radiusMeters,
    vertices
  });
}

// --- Notice ----------------------------------------------------------------------------

export type NoticeInput = { texts: Record<string, string> };

export function validateNotice(raw: unknown): Validated<NoticeInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["texts"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const texts: Record<string, string> = {};
  const value = body.texts;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({
      field: "texts",
      message: "texts must be an object of locale -> notice text."
    });
  } else {
    const entries = Object.entries(value as Body);

    if (entries.length === 0 || entries.length > GEO_LIMITS.maxNoticeLocales) {
      errors.push({
        field: "texts",
        message: `texts must carry 1-${GEO_LIMITS.maxNoticeLocales} locales.`
      });
    }

    for (const [locale, text] of entries) {
      if (!LOCALE_PATTERN.test(locale)) {
        errors.push({
          field: "texts",
          message: "every locale key must be a language tag such as en or id."
        });
      } else if (
        typeof text !== "string" ||
        text.trim().length === 0 ||
        text.length > GEO_LIMITS.noticeTextMaxLength ||
        CONTROL_CHARACTERS.test(text)
      ) {
        errors.push({
          field: `texts.${locale}`,
          message: `the notice text must be 1-${GEO_LIMITS.noticeTextMaxLength} characters.`
        });
      } else {
        texts[locale] = text.trim();
      }
    }
  }

  return finish(errors, { texts });
}

export type AcknowledgeInput = { employmentId: string; noticeId: string };

export function validateAcknowledgement(
  raw: unknown
): Validated<AcknowledgeInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["employmentId", "noticeId"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const employmentId = uuidValue(body, "employmentId", errors, true);
  const noticeId = uuidValue(body, "noticeId", errors, true);

  return finish(errors, {
    employmentId: employmentId ?? "",
    noticeId: noticeId ?? ""
  });
}
