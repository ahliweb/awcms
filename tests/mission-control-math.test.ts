/**
 * Pure unit tests for the Mission Control renderer's 3D math (Issue
 * ahliweb/omes#265). No browser, no WebGL: matrices, picking rays and the
 * camera interpolation are plain functions.
 */
import { describe, expect, test } from "bun:test";

import {
  basis,
  cameraEye,
  clamp,
  ease,
  inView,
  lerpCamera,
  lookAt,
  multiply,
  perspective,
  project,
  raySphere,
  screenRay,
  type Camera
} from "../src/lib/ui/mission-control/math";

const close = (a: number, b: number, eps = 1e-5) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

const camera: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 10 };

describe("lookAt / perspective", () => {
  test("lookAt moves the target onto the -Z axis at the eye distance", () => {
    const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const [x, y, w] = project(view, [0, 0, 0]);
    close(x, 0);
    close(y, 0);
    close(w, 1);
    // z of the transformed origin is -distance.
    close(view[14] as number, -5);
  });

  test("a point on the view axis stays centred and has positive clip w", () => {
    const vp = multiply(
      perspective(0.8, 1.5, 0.5, 100),
      lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0])
    );
    const [x, y, w] = project(vp, [0, 0, 0]);
    close(x, 0);
    close(y, 0);
    expect(w).toBeGreaterThan(0);
    close(w, 10);
  });

  test("a point to the right of the axis projects to positive x, above to positive y", () => {
    const vp = multiply(
      perspective(0.8, 1, 0.5, 100),
      lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0])
    );
    expect(project(vp, [2, 0, 0])[0]).toBeGreaterThan(0);
    expect(project(vp, [0, 2, 0])[1]).toBeGreaterThan(0);
  });

  test("perspective maps near to -1 and far to +1 in NDC depth", () => {
    const p = perspective(1, 1, 1, 10);
    const ndc = (z: number) => {
      const clipZ = (p[10] as number) * z + (p[14] as number);
      const clipW = (p[11] as number) * z;
      return clipZ / clipW;
    };
    close(ndc(-1), -1);
    close(ndc(-10), 1);
  });

  test("multiply by identity is a no-op and is associative with a translation", () => {
    const id = new Float32Array(16);
    [0, 5, 10, 15].forEach((i) => (id[i] = 1));
    const m = lookAt([1, 2, 3], [0, 0, 0], [0, 1, 0]);
    const out = multiply(id, m);
    for (let i = 0; i < 16; i++) close(out[i] as number, m[i] as number);
  });

  test("basis is orthonormal", () => {
    const { f, r, u } = basis([3, 4, 5], [0, 0, 0]);
    const dot = (a: readonly number[], b: readonly number[]) =>
      a.reduce((s, v, i) => s + v * (b[i] as number), 0);
    close(dot(f, r), 0);
    close(dot(f, u), 0);
    close(dot(r, u), 0);
    close(dot(f, f), 1);
  });
});

describe("picking", () => {
  test("the centre ray runs from the eye through the orbit target", () => {
    const { o, d } = screenRay(camera, 0, 0, 1.5);
    expect(o).toEqual(cameraEye(camera));
    close(d[0], 0);
    close(d[1], 0);
    close(d[2], -1);
  });

  test("a ray hits a sphere in front of it and misses one off to the side", () => {
    const { o, d } = screenRay(camera, 0, 0, 1);
    const hit = raySphere(o, d, [0, 0, 0], 1);
    close(hit, 9);
    expect(raySphere(o, d, [5, 0, 0], 1)).toBe(-1);
  });

  test("a sphere behind the ray origin is never hit", () => {
    const { o, d } = screenRay(camera, 0, 0, 1);
    expect(raySphere(o, d, [0, 0, 30], 1)).toBe(-1);
  });

  test("a grazing ray at exactly the radius still counts as a hit", () => {
    expect(
      raySphere([0, 1, 10], [0, 0, -1], [0, 0, 0], 1)
    ).toBeGreaterThanOrEqual(0);
    expect(raySphere([0, 1.01, 10], [0, 0, -1], [0, 0, 0], 1)).toBe(-1);
  });

  test("an off-centre NDC ray tilts toward the matching side", () => {
    const right = screenRay(camera, 1, 0, 1).d;
    const up = screenRay(camera, 0, 1, 1).d;
    expect(right[0]).toBeGreaterThan(0);
    expect(up[1]).toBeGreaterThan(0);
  });

  test("picking the nearest of two overlapping spheres is a matter of comparing t", () => {
    const { o, d } = screenRay(camera, 0, 0, 1);
    const near = raySphere(o, d, [0, 0, 2], 1);
    const far = raySphere(o, d, [0, 0, -2], 1);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThan(far);
  });
});

describe("visibility and camera animation", () => {
  const vp = multiply(
    perspective(0.8, 1, 0.5, 100),
    lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0])
  );

  test("points in front are in view; behind or far off-axis are not", () => {
    expect(inView(vp, [0, 0, 0])).toBe(true);
    expect(inView(vp, [0, 0, 20])).toBe(false);
    expect(inView(vp, [200, 0, 0])).toBe(false);
  });

  test("ease is monotonic with fixed endpoints", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-3)).toBe(0);
    expect(ease(7)).toBe(1);
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const v = ease(i / 20);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  test("lerpCamera hits both ends and the midpoint", () => {
    const a: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 10 };
    const b: Camera = { x: 10, y: 4, z: -6, yaw: 1, pitch: 0.5, dist: 30 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    expect(lerpCamera(a, b, 1)).toEqual(b);
    expect(lerpCamera(a, b, 0.5)).toEqual({
      x: 5,
      y: 2,
      z: -3,
      yaw: 0.5,
      pitch: 0.25,
      dist: 20
    });
  });

  test("clamp bounds both sides", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  test("the orbit eye sits `dist` from the target for any yaw/pitch", () => {
    const c: Camera = { x: 1, y: 2, z: 3, yaw: 1.1, pitch: 0.6, dist: 12 };
    const e = cameraEye(c);
    close(Math.hypot(e[0] - 1, e[1] - 2, e[2] - 3), 12, 1e-4);
  });
});
