/**
 * Tiny, dependency-free 3D math for the Mission Control renderer (Issue
 * ahliweb/omes#265). Pure functions only — everything here is unit-tested
 * without a browser (`tests/mission-control-math.test.ts`). Matrices are
 * column-major `Float32Array(16)`, matching WebGL.
 */
export type V3 = readonly [number, number, number];

export type Camera = {
  /** Orbit target. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
};

export const FOV = 0.8;

export function perspective(
  fovy: number,
  aspect: number,
  near: number,
  far: number,
  out: Float32Array = new Float32Array(16)
): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function normalize(v: V3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: V3, b: V3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function sub(a: V3, b: V3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Camera basis: forward, right, up (all unit length). */
export function basis(eye: V3, target: V3, up: V3 = [0, 1, 0]) {
  const f = normalize(sub(target, eye));
  const r = normalize(cross(f, up));
  const u = cross(r, f);
  return { f, r, u };
}

export function lookAt(
  eye: V3,
  target: V3,
  up: V3 = [0, 1, 0],
  out: Float32Array = new Float32Array(16)
): Float32Array {
  const { f, r, u } = basis(eye, target, up);
  out[0] = r[0];
  out[1] = u[0];
  out[2] = -f[0];
  out[3] = 0;
  out[4] = r[1];
  out[5] = u[1];
  out[6] = -f[1];
  out[7] = 0;
  out[8] = r[2];
  out[9] = u[2];
  out[10] = -f[2];
  out[11] = 0;
  out[12] = -dot(r, eye);
  out[13] = -dot(u, eye);
  out[14] = dot(f, eye);
  out[15] = 1;
  return out;
}

/** `out = a * b` (apply `b` first). `out` must not alias `a` or `b`. */
export function multiply(
  a: Float32Array,
  b: Float32Array,
  out: Float32Array = new Float32Array(16)
): Float32Array {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++)
        s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function cameraEye(c: Camera): [number, number, number] {
  const cp = Math.cos(c.pitch);
  return [
    c.x + c.dist * cp * Math.sin(c.yaw),
    c.y + c.dist * Math.sin(c.pitch),
    c.z + c.dist * cp * Math.cos(c.yaw)
  ];
}

/** World-space ray through an NDC point (x, y in [-1, 1]; y up). */
export function screenRay(
  c: Camera,
  ndcX: number,
  ndcY: number,
  aspect: number,
  fovy: number = FOV
): { o: [number, number, number]; d: [number, number, number] } {
  const o = cameraEye(c);
  const { f, r, u } = basis(o, [c.x, c.y, c.z]);
  const t = Math.tan(fovy / 2);
  const d = normalize([
    f[0] + r[0] * ndcX * t * aspect + u[0] * ndcY * t,
    f[1] + r[1] * ndcX * t * aspect + u[1] * ndcY * t,
    f[2] + r[2] * ndcX * t * aspect + u[2] * ndcY * t
  ]);
  return { o, d };
}

/** Distance along the ray to the sphere, or -1 when it misses / is behind. */
export function raySphere(o: V3, d: V3, center: V3, radius: number): number {
  const m = sub(o, center);
  const b = dot(m, d);
  const cc = dot(m, m) - radius * radius;
  if (cc > 0 && b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : 0;
}

/** Clip-space `[x, y, w]` of a world point under view-projection `vp`. */
export function project(vp: Float32Array, p: V3): [number, number, number] {
  const g = (i: number) => vp[i] as number;
  return [
    g(0) * p[0] + g(4) * p[1] + g(8) * p[2] + g(12),
    g(1) * p[0] + g(5) * p[1] + g(9) * p[2] + g(13),
    g(3) * p[0] + g(7) * p[1] + g(11) * p[2] + g(15)
  ];
}

/** Frustum-ish visibility: in front of the camera and roughly on screen. */
export function inView(vp: Float32Array, p: V3, margin = 1.25): boolean {
  const [x, y, w] = project(vp, p);
  return w > 0 && Math.abs(x) <= w * margin && Math.abs(y) <= w * margin;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Cubic ease-in-out on [0, 1]. */
export function ease(t: number): number {
  const k = clamp(t, 0, 1);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const l = (p: number, q: number) => p + (q - p) * t;
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    yaw: l(a.yaw, b.yaw),
    pitch: l(a.pitch, b.pitch),
    dist: l(a.dist, b.dist)
  };
}
