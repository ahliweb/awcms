/**
 * Shape checks for a geofence polygon (Issue #970, ADR-0138). Pure.
 *
 * A fence is a tenant's work site, so it must be a real, small, simple area: a
 * degenerate polygon (a line, a bow-tie, a repeated point) or one that spans a
 * city would turn "was the check-in at an authorised site" into noise. The
 * vertices are projected to a local plane around their mean (metres), which is
 * exact enough for the few kilometres allowed.
 */
const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG = Math.PI / 180;

export type PolygonShape = {
  /** No repeated vertex, no zero-length edge, no two edges crossing. */
  simple: boolean;
  areaSquareMeters: number;
  /** The larger side of the bounding box, in metres. */
  extentMeters: number;
};

function project(vertices: readonly [number, number][]): [number, number][] {
  const lat0 = vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length;
  const lon0 = vertices[0]![1];

  return vertices.map(([lat, lon]) => [
    (((((lon - lon0) % 360) + 540) % 360) - 180) *
      DEG *
      Math.cos(lat0 * DEG) *
      EARTH_RADIUS_METERS,
    (lat - lat0) * DEG * EARTH_RADIUS_METERS
  ]);
}

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
): boolean {
  const d1 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d2 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  const d3 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d4 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);

  // Proper crossing, or a touch (a collinear / endpoint contact counts: a
  // simple polygon's non-adjacent edges share no point at all).
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;

  const on = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.min(p[0], q[0]) <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) &&
    Math.min(p[1], q[1]) <= r[1] &&
    r[1] <= Math.max(p[1], q[1]);

  return (
    (d1 === 0 && on(a, b, c)) ||
    (d2 === 0 && on(a, b, d)) ||
    (d3 === 0 && on(c, d, a)) ||
    (d4 === 0 && on(c, d, b))
  );
}

export function analysePolygon(
  vertices: readonly [number, number][]
): PolygonShape {
  const points = project(vertices);
  const count = points.length;
  let simple = true;

  // A repeated vertex (or a zero-length edge, which is the same thing).
  for (let i = 0; i < count && simple; i++) {
    for (let j = i + 1; j < count; j++) {
      if (
        Math.hypot(
          points[i]![0] - points[j]![0],
          points[i]![1] - points[j]![1]
        ) < 1
      ) {
        simple = false;
        break;
      }
    }
  }

  // Non-adjacent edges must not touch.
  for (let i = 0; i < count && simple; i++) {
    for (let j = i + 1; j < count; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);

      if (adjacent) continue;

      if (
        segmentsIntersect(
          points[i]!,
          points[(i + 1) % count]!,
          points[j]!,
          points[(j + 1) % count]!
        )
      ) {
        simple = false;
        break;
      }
    }
  }

  let twiceArea = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % count]!;

    twiceArea += x1 * y2 - x2 * y1;
    minX = Math.min(minX, x1);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y1);
    maxY = Math.max(maxY, y1);
  }

  return {
    simple,
    areaSquareMeters: Math.abs(twiceArea) / 2,
    extentMeters: Math.max(maxX - minX, maxY - minY)
  };
}
