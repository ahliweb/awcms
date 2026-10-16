/**
 * The pure geofence evaluator (Issue #970, ADR-0138 section 1).
 *
 * Pure geometry against stored geofences: no provider call, no database, no
 * clock, no logging. A sample goes in; a verdict and two coarse bands come out;
 * the sample is not returned and is not kept. That is what lets the caller
 * discard the coordinates the moment it has this result.
 *
 * Rules (rule version 1):
 *   * no sample                      -> `not_provided`;
 *   * reported accuracy worse than the tenant's ceiling -> `not_provided`
 *     (NEVER `inside`), and no distance is computed from a fix that coarse;
 *   * no geofence for the office     -> `not_provided` (nothing to compare);
 *   * the sample is inside ANY geofence -> `inside` (that geofence);
 *   * otherwise                      -> `outside`, against the NEAREST geofence.
 * The distance band is the distance to the nearest geofence BOUNDARY, so a
 * sample 10 m outside a fence is `lt_250m`, never an exact figure.
 *
 * The earth is treated as a sphere (haversine) for a circle, and as a local
 * flat plane around the sample for a polygon: both are exact enough for the few
 * kilometres a work site spans, and a coarse band hides the residual.
 */
import {
  GEO_ACCURACY_EDGES,
  GEO_DISTANCE_EDGES,
  type GeoAccuracyBand,
  type GeoDistanceBand,
  type GeoEvaluation,
  type Geofence,
  type PositionSample
} from "./hr-geolocation-types";

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Projects `[lat, lon]` to metres east/north of the origin (local plane). */
function toLocalMeters(
  originLat: number,
  originLon: number,
  lat: number,
  lon: number
): [number, number] {
  // Wrap the longitude difference into [-180, 180) so a fence across the
  // antimeridian still projects next to the sample.
  const dLon = ((((lon - originLon) % 360) + 540) % 360) - 180;

  return [
    dLon * DEG * Math.cos(originLat * DEG) * EARTH_RADIUS_METERS,
    (lat - originLat) * DEG * EARTH_RADIUS_METERS
  ];
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)
        );

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ray casting from the origin (the sample) in a local plane. */
function originInsidePolygon(points: [number, number][]): boolean {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;

    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

export type FenceMeasure = { inside: boolean; boundaryMeters: number };

/** Whether the sample is inside the fence, and its distance to the boundary (0 when inside). */
export function measureAgainstGeofence(
  sample: Pick<PositionSample, "latitude" | "longitude">,
  fence: Geofence
): FenceMeasure | null {
  if (fence.shape === "circle") {
    if (
      fence.latitude === null ||
      fence.longitude === null ||
      fence.radiusMeters === null
    ) {
      return null;
    }

    const centre = haversineMeters(
      sample.latitude,
      sample.longitude,
      fence.latitude,
      fence.longitude
    );

    return centre <= fence.radiusMeters
      ? { inside: true, boundaryMeters: 0 }
      : { inside: false, boundaryMeters: centre - fence.radiusMeters };
  }

  if (!fence.vertices || fence.vertices.length < 3) {
    return null;
  }

  const points = fence.vertices.map(([lat, lon]) =>
    toLocalMeters(sample.latitude, sample.longitude, lat, lon)
  );

  if (originInsidePolygon(points)) {
    return { inside: true, boundaryMeters: 0 };
  }

  let nearest = Number.POSITIVE_INFINITY;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j]!;
    const [bx, by] = points[i]!;

    nearest = Math.min(nearest, distanceToSegment(0, 0, ax, ay, bx, by));
  }

  return { inside: false, boundaryMeters: nearest };
}

export function distanceBandOf(
  inside: boolean,
  boundaryMeters: number
): GeoDistanceBand {
  if (inside) return "within";
  if (boundaryMeters < GEO_DISTANCE_EDGES.near) return "lt_250m";
  if (boundaryMeters < GEO_DISTANCE_EDGES.mid) return "lt_1km";

  return "gte_1km";
}

export function accuracyBandOf(accuracyMeters: number): GeoAccuracyBand {
  if (accuracyMeters < GEO_ACCURACY_EDGES.fine) return "lt_25m";
  if (accuracyMeters < GEO_ACCURACY_EDGES.good) return "lt_100m";
  if (accuracyMeters < GEO_ACCURACY_EDGES.coarse) return "lt_500m";

  return "gte_500m";
}

const NOT_PROVIDED: GeoEvaluation = {
  verdict: "not_provided",
  distanceBand: null,
  accuracyBand: null,
  geofenceId: null
};

/**
 * Evaluates one sample. `sample` is `null` for a declined / absent fix. The
 * result carries no coordinate and no raw accuracy.
 */
export function evaluatePositionSample(
  sample: PositionSample | null,
  geofences: readonly Geofence[],
  accuracyCeilingMeters: number
): GeoEvaluation {
  if (sample === null) {
    return NOT_PROVIDED;
  }

  const accuracyBand = accuracyBandOf(sample.accuracyMeters);

  // Never counted as inside, and no distance is derived from a fix this coarse.
  if (sample.accuracyMeters > accuracyCeilingMeters) {
    return { ...NOT_PROVIDED, accuracyBand };
  }

  let best: { fence: Geofence; measure: FenceMeasure } | null = null;

  for (const fence of geofences) {
    const measure = measureAgainstGeofence(sample, fence);

    if (!measure) continue;

    // Inside beats outside; among equals, the nearer boundary; ties by id so
    // the result does not depend on the order rows came back in.
    const better =
      best === null ||
      (measure.inside && !best.measure.inside) ||
      (measure.inside === best.measure.inside &&
        (measure.boundaryMeters < best.measure.boundaryMeters ||
          (measure.boundaryMeters === best.measure.boundaryMeters &&
            fence.id < best.fence.id)));

    if (better) {
      best = { fence, measure };
    }
  }

  if (!best) {
    return { ...NOT_PROVIDED, accuracyBand };
  }

  return {
    verdict: best.measure.inside ? "inside" : "outside",
    distanceBand: distanceBandOf(
      best.measure.inside,
      best.measure.boundaryMeters
    ),
    accuracyBand,
    geofenceId: best.fence.id
  };
}
