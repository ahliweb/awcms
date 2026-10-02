/**
 * Hand-written WebGL2 renderer for the 3D Mission Control workspace (Issue
 * ahliweb/omes#265, ADR-0031). No dependency, one shader program, instanced
 * low-poly meshes plus GL_LINES for relations.
 *
 * This is a DECORATIVE mirror of the accessible object list (the canvas region
 * is `aria-hidden`): shape is the kind, and the visual state is carried by the
 * list text as well as by colour. Stale/unknown objects are additionally drawn
 * hatched, and nothing pulses for them — only `in_progress` pulses, and only
 * when the viewer has not asked for reduced motion. Animation never changes a
 * visual state.
 *
 * Rendering is on demand: a frame is requested only while the camera animates
 * or a pulse is active, and never while `document.hidden`.
 */
import type {
  MissionControlKind,
  MissionControlVisualState
} from "../../../modules/omes-control/domain/mission-control-types";
import {
  FOV,
  cameraEye,
  clamp,
  ease,
  inView,
  lerpCamera,
  lookAt,
  multiply,
  perspective,
  raySphere,
  screenRay,
  type Camera,
  type V3
} from "./math";

export class MissionControlRendererUnavailable extends Error {
  override name = "MissionControlRendererUnavailable";
}

export type DrawItem = {
  /** Caller-owned handle returned by `pick`. */
  id: number;
  p: V3;
  kind: MissionControlKind;
  state: MissionControlVisualState;
};

export type MissionControlRenderer = {
  setData(
    items: DrawItem[],
    lines: number[],
    min: V3,
    max: V3,
    selectedId: number
  ): void;
  setSelected(id: number): void;
  pick(clientX: number, clientY: number): number;
  flyTo(p: V3): void;
  reset(): void;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
};

/** mesh (0 box, 1 octahedron) and non-uniform scale per kind. */
const SHAPE: Record<MissionControlKind, [number, V3]> = {
  server: [0, [1.3, 1.3, 1.3]],
  deployment: [0, [0.8, 0.8, 0.8]],
  backup: [0, [0.95, 0.5, 0.95]],
  health_report: [0, [0.5, 0.5, 0.5]],
  job: [0, [0.9, 0.35, 0.6]],
  hermes_subagent: [1, [0.9, 0.9, 0.9]],
  architecture_plane: [0, [1.6, 0.14, 1.6]],
  capability: [0, [1.1, 0.12, 1.1]],
  repository_milestone: [0, [1.3, 0.12, 0.8]],
  approval_item: [1, [0.7, 1.3, 0.7]],
  ai_privacy_posture: [1, [1.1, 0.5, 1.1]]
};

/** CSS custom property (design token) per visual state. */
const STATE_TOKEN: Record<MissionControlVisualState, string> = {
  ok: "--color-success",
  in_progress: "--color-primary",
  pending: "--color-info",
  warning: "--color-warning",
  failed: "--color-danger",
  cancelled: "--color-text-faint",
  informational: "--color-text-muted",
  stale: "--color-text-faint",
  unknown: "--color-text-faint"
};

// Whitespace-free on purpose: template literals are not minified, and every
// byte of this file counts against the client asset budget.
const VERT = `#version 300 es
layout(location=0)in vec3 aPos;layout(location=1)in vec3 aNor;layout(location=2)in vec3 iPos;layout(location=3)in vec3 iScl;layout(location=4)in vec3 iCol;layout(location=5)in vec3 iMeta;
uniform mat4 uVP;uniform float uT,uOut;uniform vec3 uAcc;
out vec3 vC;out float vH;
void main(){float s=(1.+iMeta.z*.1*sin(uT*3.))*(1.+iMeta.y*.1+uOut*.2);
float l=.55+.45*max(dot(normalize(aNor),normalize(vec3(.4,.8,.5))),0.);
vC=mix(iCol*l,uAcc,uOut);vH=iMeta.x*(1.-uOut);
gl_Position=uVP*vec4(aPos*iScl*s+iPos,1.);}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vC;in float vH;out vec4 o;
void main(){if(vH>.5&&mod(floor(gl_FragCoord.x+gl_FragCoord.y),4.)<2.)discard;o=vec4(vC,1.);}`;

/** Flat-shaded unit box, CCW outward. Interleaved position + normal. */
function boxMesh(): number[] {
  const out: number[] = [];
  const quad = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ] as const;
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3]
      ]) {
        for (const q of s > 0 ? tri : [...tri].reverse()) {
          const v = [0, 0, 0];
          const n = [0, 0, 0];
          v[a] = s * 0.5;
          v[b] = (quad[q as number]?.[0] ?? 0) * 0.5;
          v[c] = (quad[q as number]?.[1] ?? 0) * 0.5;
          n[a] = s;
          out.push(...v, ...n);
        }
      }
    }
  }
  return out;
}

function octaMesh(): number[] {
  const out: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const k = Math.sqrt(3);
        const corners: V3[] = [
          [sx * 0.5, 0, 0],
          [0, sy * 0.5, 0],
          [0, 0, sz * 0.5]
        ];
        for (const v of sx * sy * sz > 0 ? corners : [...corners].reverse()) {
          out.push(...v, sx / k, sy / k, sz / k);
        }
      }
    }
  }
  return out;
}

function parseColor(raw: string, fallback: V3): V3 {
  const s = raw.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h =
      (m[1] as string).length === 3
        ? (m[1] as string).replace(/./g, "$&$&")
        : (m[1] as string);
    return [0, 2, 4].map(
      (i) => parseInt(h.slice(i, i + 2), 16) / 255
    ) as unknown as V3;
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return fallback;
}

const INSTANCE_FLOATS = 12;
/** Global object size multiplier (the layout spacing is tuned against it). */
const UNIT = 1.3;

export function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { reducedMotion: boolean; onLost: () => void }
): MissionControlRenderer {
  const context = canvas.getContext("webgl2", {
    antialias: true,
    powerPreference: "low-power"
  });
  if (!context) {
    throw new MissionControlRendererUnavailable("WebGL2 is not available");
  }
  const gl: WebGL2RenderingContext = context;

  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type);
    if (!sh) throw new MissionControlRendererUnavailable("shader");
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new MissionControlRendererUnavailable("shader compile failed");
    }
    return sh;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new MissionControlRendererUnavailable("program link failed");
  }
  gl.useProgram(program);
  const uVP = gl.getUniformLocation(program, "uVP");
  const uT = gl.getUniformLocation(program, "uT");
  const uOut = gl.getUniformLocation(program, "uOut");
  const uAcc = gl.getUniformLocation(program, "uAcc");

  const css = getComputedStyle(canvas);
  const token = (name: string, fallback: V3): V3 =>
    parseColor(css.getPropertyValue(name), fallback);
  const GREY: V3 = [0.6, 0.65, 0.7];
  const palette = {} as Record<MissionControlVisualState, V3>;
  for (const [state, name] of Object.entries(STATE_TOKEN)) {
    palette[state as MissionControlVisualState] = token(name, GREY);
  }
  const accent = token("--color-focus", [0.37, 0.78, 0.84]);
  const lineColor = token("--color-border-strong", [0.42, 0.46, 0.51]);

  const meshes = [boxMesh(), octaMesh()].map((verts) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    return { buf, count: verts.length / 6 };
  });

  /** One VAO over (mesh vertices, a dedicated instance buffer). */
  const vao = (geom: WebGLBuffer | null, inst: WebGLBuffer | null) => {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, geom);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    if (inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(2 + i);
        gl.vertexAttribPointer(
          2 + i,
          3,
          gl.FLOAT,
          false,
          INSTANCE_FLOATS * 4,
          i * 12
        );
        gl.vertexAttribDivisor(2 + i, 1);
      }
    }
    return v;
  };
  const layers = meshes.map((m) => {
    const mainBuf = gl.createBuffer();
    const outBuf = gl.createBuffer();
    return {
      ...m,
      mainBuf,
      outBuf,
      mainVao: vao(m.buf, mainBuf),
      outVao: vao(m.buf, outBuf),
      mainCount: 0,
      outCount: 0
    };
  });
  const lineBuf = gl.createBuffer();
  const lineVao = (() => {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    return v;
  })();
  let lineCount = 0;

  let items: DrawItem[] = [];
  let selected = -1;
  let pulsing = false;
  let reduced = opts.reducedMotion;
  let bounds: [V3, V3] | null = null;
  let cam: Camera = { x: 0, y: 0, z: 0, yaw: 0.5, pitch: 0.7, dist: 30 };
  let anim: { from: Camera; to: Camera; t0: number; dur: number } | null = null;
  let raf = 0;
  let lastDraw = 0;
  let disposed = false;
  let lost = false;
  const vp = new Float32Array(16);
  const proj = new Float32Array(16);
  const view = new Float32Array(16);

  const radius = (kind: MissionControlKind): number => {
    const s = SHAPE[kind][1];
    return Math.max(s[0], s[1], s[2]) * 0.6 * UNIT;
  };

  function upload(): void {
    const main: number[][] = [[], []];
    const outline: number[][] = [[], []];
    pulsing = false;
    for (const it of items) {
      const [mesh, scale] = SHAPE[it.kind];
      const color = palette[it.state] ?? GREY;
      const hatch = it.state === "stale" || it.state === "unknown" ? 1 : 0;
      const pulse = it.state === "in_progress" && !reduced ? 1 : 0;
      if (pulse) pulsing = true;
      const sel = it.id === selected ? 1 : 0;
      const row = [
        ...it.p,
        ...scale.map((v) => v * UNIT),
        ...color,
        hatch,
        sel,
        pulse
      ];
      (main[mesh] as number[]).push(...row);
      if (sel) (outline[mesh] as number[]).push(...row);
    }
    layers.forEach((l, i) => {
      const m = main[i] as number[];
      const o = outline[i] as number[];
      gl.bindBuffer(gl.ARRAY_BUFFER, l.mainBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, l.outBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o), gl.DYNAMIC_DRAW);
      l.mainCount = m.length / INSTANCE_FLOATS;
      l.outCount = o.length / INSTANCE_FLOATS;
    });
  }

  function size(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(now: number): void {
    size();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    perspective(FOV, canvas.width / canvas.height, 0.5, 2000, proj);
    lookAt(cameraEye(cam), [cam.x, cam.y, cam.z], [0, 1, 0], view);
    multiply(proj, view, vp);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uVP, false, vp);
    gl.uniform1f(uT, reduced ? 0 : now / 1000);
    gl.uniform3f(uAcc, accent[0], accent[1], accent[2]);
    gl.uniform1f(uOut, 0);
    gl.disable(gl.CULL_FACE);
    if (lineCount > 0) {
      gl.vertexAttrib3f(1, 0, 1, 0);
      gl.vertexAttrib3f(2, 0, 0, 0);
      gl.vertexAttrib3f(3, 1, 1, 1);
      gl.vertexAttrib3f(4, lineColor[0], lineColor[1], lineColor[2]);
      gl.vertexAttrib3f(5, 0, 0, 0);
      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, lineCount);
    }
    gl.enable(gl.CULL_FACE);
    for (const l of layers) {
      if (l.mainCount > 0) {
        gl.cullFace(gl.BACK);
        gl.uniform1f(uOut, 0);
        gl.bindVertexArray(l.mainVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, l.count, l.mainCount);
      }
      if (l.outCount > 0) {
        // Inverted hull: the selected object, enlarged, back faces only.
        gl.cullFace(gl.FRONT);
        gl.uniform1f(uOut, 1);
        gl.bindVertexArray(l.outVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, l.count, l.outCount);
      }
    }
  }

  function frame(now: number): void {
    raf = 0;
    if (disposed || lost || document.hidden) return;
    if (anim) {
      const k = (now - anim.t0) / anim.dur;
      if (k >= 1) {
        cam = anim.to;
        anim = null;
      } else {
        cam = lerpCamera(anim.from, anim.to, ease(k));
      }
    }
    // A pulse alone is throttled to ~30 fps; a camera move runs at full rate.
    if (anim || now - lastDraw >= 33) {
      lastDraw = now;
      draw(now);
    }
    if (anim || pulsing) request();
  }

  function request(): void {
    if (raf || disposed || lost || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function go(to: Camera, dur = 450): void {
    if (reduced || dur <= 0) {
      cam = to;
      anim = null;
    } else {
      anim = { from: { ...cam }, to, t0: performance.now(), dur };
    }
    request();
  }

  /** Default view: the scene's bounding sphere fitted to the canvas. */
  const home = (): Camera => {
    const [lo, hi] = bounds ?? [
      [0, 0, 0],
      [0, 0, 0]
    ];
    const radius =
      Math.max(
        (Math.hypot(hi[0] - lo[0], hi[2] - lo[2]) / 2) * 0.85 + (hi[1] - lo[1]),
        4
      ) + 1.5;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const half = Math.atan(Math.tan(FOV / 2) * Math.min(1, aspect || 1));
    return {
      x: (lo[0] + hi[0]) / 2,
      y: (lo[1] + hi[1]) / 2,
      z: (lo[2] + hi[2]) / 2,
      yaw: 0.45,
      pitch: 0.75,
      dist: clamp(radius / Math.sin(half), 10, 800)
    };
  };
  const range = () => home().dist;
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    opts.onLost();
  };
  const onVisible = (): void => request();
  const observer = new ResizeObserver(() => request());
  observer.observe(canvas);
  canvas.addEventListener("webglcontextlost", onLost);
  document.addEventListener("visibilitychange", onVisible);

  return {
    setData(next, lines, min, max, selectedId) {
      items = next;
      selected = selectedId;
      lineCount = lines.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      const first = bounds === null;
      bounds = [min, max];
      if (first) cam = home();
      upload();
      request();
    },
    setSelected(id) {
      selected = id;
      upload();
      request();
    },
    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return -1;
      const aspect = rect.width / rect.height;
      const { o, d } = screenRay(
        cam,
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2,
        aspect
      );
      perspective(FOV, aspect, 0.5, 2000, proj);
      lookAt(o, [cam.x, cam.y, cam.z], [0, 1, 0], view);
      multiply(proj, view, vp);
      let best = -1;
      let bestT = Infinity;
      for (const it of items) {
        if (!inView(vp, it.p)) continue;
        const t = raySphere(o, d, it.p, radius(it.kind));
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = it.id;
        }
      }
      return best;
    },
    flyTo(p) {
      go({
        ...cam,
        x: p[0],
        y: p[1],
        z: p[2],
        dist: Math.min(cam.dist, Math.max(8, range() * 0.4))
      });
    },
    reset() {
      go(home());
    },
    orbit(dx, dy) {
      anim = null;
      cam = {
        ...cam,
        yaw: cam.yaw - dx * 0.006,
        pitch: clamp(cam.pitch + dy * 0.006, 0.1, 1.45)
      };
      request();
    },
    zoom(factor) {
      anim = null;
      cam = {
        ...cam,
        dist: clamp(cam.dist * factor, range() * 0.12, range() * 2.5)
      };
      request();
    },
    setReducedMotion(value) {
      reduced = value;
      upload();
      request();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", onVisible);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}
