/**
 * Geolocation attendance evidence vocabulary (Issue #970, ADR-0138). Pure.
 *
 * Verdict-only: the server evaluates one position sample in the request and
 * keeps ONLY a verdict and coarse bands. Nothing in this file, nor in any table
 * it maps to, can hold a coordinate that belongs to a person; the only
 * coordinates in the whole feature are those of a tenant's own WORK SITE
 * (`Geofence`), which is a place of business, not personal data.
 */

export const GEO_VERDICTS = ["inside", "outside", "not_provided"] as const;
export type GeoVerdict = (typeof GEO_VERDICTS)[number];

export const GEO_DISTANCE_BANDS = [
  "within",
  "lt_250m",
  "lt_1km",
  "gte_1km"
] as const;
export type GeoDistanceBand = (typeof GEO_DISTANCE_BANDS)[number];

export const GEO_ACCURACY_BANDS = [
  "lt_25m",
  "lt_100m",
  "lt_500m",
  "gte_500m"
] as const;
export type GeoAccuracyBand = (typeof GEO_ACCURACY_BANDS)[number];

/** The version of the evaluation rule (bands, ceiling semantics) stored with each verdict. */
export const GEO_RULE_VERSION = 1;

export const GEO_LIMITS = {
  /** A sample worse than the tenant's ceiling is `not_provided`. */
  defaultAccuracyCeilingMeters: 100,
  minAccuracyCeilingMeters: 10,
  maxAccuracyCeilingMeters: 500,
  /** Sanity bound on a reported accuracy; anything larger is a malformed sample. */
  maxReportedAccuracyMeters: 100_000,
  minRadiusMeters: 50,
  maxRadiusMeters: 5000,
  minVertices: 3,
  maxVertices: 32,
  /** A polygon must enclose at least a 50 m circle's worth of ground / 3, and span at most as far as the largest circle. */
  minPolygonAreaSquareMeters: 2500,
  maxPolygonExtentMeters: 10_000,
  maxFencesPerOffice: 10,
  labelMaxLength: 80,
  dpiaReferenceMaxLength: 200,
  noticeTextMaxLength: 4000,
  maxNoticeLocales: 10
} as const;

/** Band edges in metres, exclusive upper bounds. */
export const GEO_DISTANCE_EDGES = { near: 250, mid: 1000 } as const;
export const GEO_ACCURACY_EDGES = { fine: 25, good: 100, coarse: 500 } as const;

/**
 * One position sample as the client reports it. It exists ONLY in the memory of
 * the request that carried it: it is never persisted, logged, audited, queued,
 * cached or returned.
 */
export type PositionSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

export type GeofenceShape = "circle" | "polygon";

/** A tenant's authorised work site, attached to an office. */
export type Geofence = {
  id: string;
  officeId: string;
  label: string;
  shape: GeofenceShape;
  /** circle */
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  /** polygon: `[latitude, longitude]` pairs. */
  vertices: [number, number][] | null;
};

export type GeoEvaluation = {
  verdict: GeoVerdict;
  distanceBand: GeoDistanceBand | null;
  accuracyBand: GeoAccuracyBand | null;
  geofenceId: string | null;
};

/** Events that may carry a sample: the employee's own clock-in and clock-out, nothing else. */
export const GEO_ELIGIBLE_KINDS = ["clock_in", "clock_out"] as const;

export function isGeoEligibleEvent(kind: string, source: string): boolean {
  return (
    source === "self" &&
    (GEO_ELIGIBLE_KINDS as readonly string[]).includes(kind)
  );
}
