// Instanced low-poly trees drawn as a MapLibre custom layer in raw WebGL2.
// Each JMC spot gets a small grove; every tree colours itself from that spot's dates.

import { MercatorCoordinate } from 'maplibre-gl';

// Tree colours by phase value (see phaseValue in data.js): [v, r, g, b] in 0..1.
const TREE_RAMPS = {
  sakura: [
    [0.0, 0.47, 0.39, 0.34], [0.7, 0.55, 0.40, 0.38], [1.0, 0.82, 0.55, 0.60], [1.6, 0.95, 0.62, 0.74],
    [2.0, 0.97, 0.66, 0.79], [2.7, 0.99, 0.80, 0.87], [3.3, 0.72, 0.74, 0.50], [4.0, 0.38, 0.56, 0.30],
  ],
  ginkgo: [
    [0.0, 0.30, 0.47, 0.22], [0.8, 0.50, 0.58, 0.20], [1.0, 0.80, 0.74, 0.22], [1.6, 0.95, 0.80, 0.16],
    [2.1, 0.99, 0.78, 0.10], [2.8, 0.96, 0.70, 0.08], [3.4, 0.62, 0.52, 0.26], [4.0, 0.45, 0.38, 0.33],
  ],
  koyo: [
    [0.0, 0.27, 0.45, 0.24], [0.8, 0.40, 0.52, 0.22], [1.0, 0.70, 0.62, 0.20], [1.6, 0.90, 0.66, 0.18],
    [2.1, 0.90, 0.38, 0.13], [2.8, 0.74, 0.17, 0.13], [3.4, 0.52, 0.31, 0.19], [4.0, 0.45, 0.38, 0.33],
  ],
};

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_day;
uniform float u_size;
uniform float u_exag;
uniform int u_kind;
uniform vec4 u_ramp[8];
in vec3 a_pos;
in vec3 a_normal;
in float a_part;
in vec2 a_merc;
in float a_mpm;
in float a_elev;
in vec4 a_dates;
in vec2 a_rand;
out vec3 v_color;

float phase(vec4 d, float day) {
  if (day < d.x) return 0.0;
  if (day < d.y) return (day - d.x) / max(1.0, d.y - d.x);
  if (day < d.z) return 1.0 + (day - d.y) / max(1.0, d.z - d.y);
  if (day < d.w) return 2.0 + (day - d.z) / max(1.0, d.w - d.z);
  return min(4.0, 3.0 + (day - d.w) / 10.0);
}

vec3 ramp(float v) {
  vec3 c = u_ramp[0].yzw;
  for (int i = 1; i < 8; i++) {
    float t = clamp((v - u_ramp[i - 1].x) / max(0.001, u_ramp[i].x - u_ramp[i - 1].x), 0.0, 1.0);
    if (v >= u_ramp[i - 1].x) c = mix(u_ramp[i - 1].yzw, u_ramp[i].yzw, t);
  }
  return c;
}

void main() {
  float v = phase(a_dates, u_day);
  // Bare sakura and bare maples carry a thin crown; leaves and blossom fill it out.
  float crown = u_kind == 0 ? mix(0.62, 1.0, smoothstep(0.2, 1.2, v)) : mix(1.0, 0.6, smoothstep(3.3, 4.0, v));
  vec3 p = a_pos;
  vec3 n = a_normal;
  if (a_part > 0.5) {
    p.xy *= crown;
    p.z = 0.33 + (p.z - 0.33) * crown;
  }
  float h = u_size * (0.75 + a_rand.x * 0.5);
  float w = h * 0.95;
  vec3 world = vec3(a_merc.x + p.x * w * a_mpm, a_merc.y - p.y * w * a_mpm, (a_elev * u_exag + p.z * h) * a_mpm);
  gl_Position = u_matrix * vec4(world, 1.0);

  vec3 base = a_part > 0.5 ? ramp(v + (a_rand.y - 0.5) * 0.25) : vec3(0.33, 0.25, 0.2);
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float diff = max(dot(normalize(n), L), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  float ao = a_part > 0.5 ? mix(0.8, 1.05, smoothstep(0.25, 0.85, p.z)) : 0.85;
  v_color = base * (0.6 + 0.16 * sky + 0.42 * diff) * ao;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 fragColor;
void main() { fragColor = vec4(v_color, 1.0); }`;

function treeGeometry() {
  const out = [];
  const push = (p, n, part) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
  // Trunk: hexagonal prism.
  const seg = 6;
  const r = 0.07;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const n = [Math.cos(am), Math.sin(am), 0];
    const p00 = [Math.cos(a0) * r, Math.sin(a0) * r, 0];
    const p10 = [Math.cos(a1) * r, Math.sin(a1) * r, 0];
    const p01 = [Math.cos(a0) * r, Math.sin(a0) * r, 0.42];
    const p11 = [Math.cos(a1) * r, Math.sin(a1) * r, 0.42];
    push(p00, n, 0); push(p10, n, 0); push(p11, n, 0);
    push(p00, n, 0); push(p11, n, 0); push(p01, n, 0);
  }
  // Crown: once-subdivided icosahedron, flat shaded, squashed and lifted.
  const t = (1 + Math.sqrt(5)) / 2;
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const mid = (a, b) => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const tris = [];
  for (const [a, b, c] of faces) {
    const ab = mid(verts[a], verts[b]); const bc = mid(verts[b], verts[c]); const ca = mid(verts[c], verts[a]);
    tris.push([verts[a], ab, ca], [verts[b], bc, ab], [verts[c], ca, bc], [ab, bc, ca]);
  }
  const sx = 0.4; const sz = 0.38; const cz = 0.6;
  for (const tri of tris) {
    // Small per-vertex wobble keeps the crowns from looking machine-made.
    const pts = tri.map((v) => {
      const k = 1 + 0.08 * Math.sin(v[0] * 7.1 + v[1] * 5.3 + v[2] * 3.7);
      return [v[0] * sx * k, v[1] * sx * k, cz + v[2] * sz * k];
    });
    const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    let n = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    const c = [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3, (pts[0][2] + pts[1][2] + pts[2][2]) / 3 - cz];
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0) n = [-n[0], -n[1], -n[2]];
    for (const p of pts) push(p, n, 1);
  }
  return new Float32Array(out);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Grove of trees around each spot, offsets in metres.
export function placeTrees(spots, perSpot = 7) {
  const R = rng(20260326);
  const trees = [];
  spots.forEach((s, si) => {
    for (let i = 0; i < perSpot; i++) {
      const a = R() * Math.PI * 2;
      const d = i === 0 ? 0 : 200 + R() * 1300;
      const lat = s.lat + (Math.sin(a) * d) / 111320;
      const lon = s.lon + (Math.cos(a) * d) / (111320 * Math.cos((s.lat * Math.PI) / 180));
      trees.push({ lon, lat, spot: si, r0: R(), r1: R() });
    }
  });
  return trees;
}

export class TreeLayer {
  constructor(id = 'trees', ramp = null) {
    this.id = id;
    this.ramp = ramp;
    this.type = 'custom';
    this.renderingMode = '3d';
    this.day = 0;
    this.size = 400;
    this.kind = 'sakura';
    this.count = 0;
    this.visible = true;
    this.exag = 1;
  }

  // All GL work happens inside render(): MapLibre caches GL bindings and only resets its cache
  // around custom-layer render calls, so touching buffers elsewhere corrupts its state.
  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
  }

  init(gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = {};
    for (const n of ['u_matrix', 'u_day', 'u_size', 'u_kind', 'u_ramp', 'u_exag']) this.u[n] = gl.getUniformLocation(prog, n);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const geom = treeGeometry();
    this.vertCount = geom.length / 7;
    this.geomBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geomBuf);
    gl.bufferData(gl.ARRAY_BUFFER, geom, gl.STATIC_DRAW);
    const attr = (name, size, stride, offset, divisor) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(loc, divisor);
    };
    attr('a_pos', 3, 7, 0, 0);
    attr('a_normal', 3, 7, 3, 0);
    attr('a_part', 1, 7, 6, 0);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    attr('a_merc', 2, 9, 0, 1);
    attr('a_mpm', 1, 9, 2, 1);
    attr('a_dates', 4, 9, 3, 1);
    attr('a_rand', 2, 9, 7, 1);
    this.elevBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.elevBuf);
    attr('a_elev', 1, 1, 0, 1);
    gl.bindVertexArray(null);
    this.ready = true;
  }

  // dates are relative to `origin` so float32 keeps whole-day precision comfortably.
  setTrees(trees, spots, kind, origin) {
    this.kind = kind;
    this.trees = trees;
    this.origin = origin;
    const data = new Float32Array(trees.length * 9);
    trees.forEach((t, i) => {
      const m = MercatorCoordinate.fromLngLat([t.lon, t.lat]);
      const d = spots[t.spot].dates;
      data.set([m.x, m.y, m.meterInMercatorCoordinateUnits(), d[0] - origin, d[1] - origin, d[2] - origin, d[3] - origin, t.r0, t.r1], i * 9);
    });
    this.instData = data;
    this.elev = new Float32Array(trees.length);
    this.instDirty = true;
    this.count = 0;
    this.map?.triggerRepaint();
  }

  // Ask MapLibre for the drawn terrain height under every tree. Returns true if any moved.
  refreshElevation() {
    if (!this.map || !this.trees || !this.elev) return false;
    let changed = false;
    const map = this.map;
    const terrain = map.terrain;
    // Store ground height without exaggeration; the shader applies the current value.
    const k = terrain ? terrain.exaggeration || 1 : 1;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const e = terrain ? (map.queryTerrainElevation([t.lon, t.lat]) ?? 0) / k : 0;
      const v = Math.max(0, e);
      if (Math.abs(v - this.elev[i]) > 1) { this.elev[i] = v; changed = true; }
    }
    if (changed) {
      this.elevDirty = true;
      map.triggerRepaint();
    }
    return changed;
  }

  render(gl, args) {
    if (!this.ready) this.init(gl);
    if (this.instDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.instData, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.elevBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.elev, gl.DYNAMIC_DRAW);
      this.count = this.trees.length;
      this.instDirty = false;
      this.elevDirty = false;
    }
    if (this.elevDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.elevBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.elev);
      this.elevDirty = false;
    }
    if (!this.visible || !this.count) return;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.u_matrix, false, new Float32Array(args.defaultProjectionData.mainMatrix));
    gl.uniform1f(this.u.u_day, this.day - this.origin);
    gl.uniform1f(this.u.u_size, this.size);
    gl.uniform1f(this.u.u_exag, this.map.terrain ? this.map.terrain.exaggeration || 1 : 0);
    gl.uniform1i(this.u.u_kind, this.kind === 'sakura' ? 0 : 1);
    gl.uniform4fv(this.u.u_ramp, TREE_RAMPS[this.ramp || this.kind].flat());
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertCount, this.count);
    gl.bindVertexArray(null);
  }

  onRemove(map, gl) {
    if (!this.ready) return;
    gl.deleteBuffer(this.geomBuf); gl.deleteBuffer(this.instBuf); gl.deleteBuffer(this.elevBuf);
    gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog);
  }
}
