/**
 * THE VOLUME
 * ==========
 * What a `.vtk` timestep looks like on the way through the pipeline, as an
 * object you can take apart: turn it, scrub it through the event, cut it open,
 * strip out the wind to see the ejecta, and point at a cell to read it.
 *
 * Every cell of a 42^3 lattice inside the spherical domain is uploaded once.
 * Which of them are drawn, how bright, and where, is decided per frame in the
 * vertex shader from a handful of uniforms -- see volumeShaders.js. Nothing
 * here is rebuilt after construction.
 *
 * The field is synthetic and meant to be. Parsing a hundred megabytes of PLUTO
 * output in a browser tab to decorate a form would be absurd, and the real
 * occupancy comes back from the worker after conversion. What is faithful is
 * the SHAPE: a radial wind thinning from the Sun, and the ejection as a flux
 * rope rather than a blob, which is why the picture matches the finished
 * render. The probe says "model" on it for the same reason.
 */
import * as THREE from 'three';
import { mulberry32, clamp, damp } from '../../../lib/math.js';
import {
  VOLUME_VERT, VOLUME_FRAG, SLICE_VERT, SLICE_FRAG, GLOW_VERT, GLOW_FRAG,
} from './volumeShaders.js';

/** Cells along one edge of the visible lattice. The real resample is 256^3. */
const GRID = 42;

const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The CPU twin of `fieldParts` in volumeShaders.js. The probe reads values
 * back through this, so the two must stay line-for-line identical.
 * @returns {[number, number]} [wind, ejecta]
 */
export function fieldParts(x, y, z, strength) {
  const r = Math.hypot(x, y, z);
  if (r > 1 || r < 0.14) return [0, 0];

  const phi = Math.atan2(z, y + 1e-6);
  const ang = Math.acos(clamp(x / r, -1, 1));

  const streamer = 0.74 + 0.26 * Math.sin(phi * 5 + ang * 3.5) * Math.sin(phi * 2.3 - ang * 2.1);
  const wind = 0.55 * Math.pow(0.16 / r, 0.75) * streamer;

  const front = mix(0.30, 0.80, strength);
  const thick = mix(0.05, 0.13, strength);
  const shell = Math.exp(-((r - front) ** 2) / (2 * thick * thick));

  const ringAng = mix(0.30, 0.72, strength);
  const ringW = mix(0.16, 0.30, strength);
  const ring = Math.exp(-((ang - ringAng) ** 2) / (2 * ringW * ringW));

  const s = 0.5 + 0.5 * Math.sin(phi * 3 + r * 9 - ang * 4);
  let cme = shell * ring * (0.34 + 0.66 * s * s) * (0.5 + 1.1 * strength) * 2.1;
  cme *= smooth(0, 0.02, strength);

  return [wind, cme];
}

/** The slice normals, in grid space. */
const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export class VolumeCloud {
  constructor({ pixelRatio = 1, seed = 20260911 } = {}) {
    this.group = new THREE.Group();

    /* ------------------------------------------------------------ points */
    const geometry = this._build(mulberry32(seed));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VOLUME_VERT,
      fragmentShader: VOLUME_FRAG,
      uniforms: {
        uTime:        { value: 0 },
        uStrength:    { value: 0.55 },
        uForm:        { value: 0 },
        uScan:        { value: 0 },
        uScanWidth:   { value: 0.06 },
        uCollapse:    { value: 0 },
        uThreshold:   { value: 0.10 },
        uOpacity:     { value: 0 },
        uHot:         { value: 0 },
        uPixelRatio:  { value: pixelRatio },
        uWind:        { value: 1 },
        uCme:         { value: 1 },
        uSliceOn:     { value: 0 },
        uSliceN:      { value: AXES.z.clone() },
        uSlicePos:    { value: 0 },
        uProbe:       { value: new THREE.Vector3(9, 9, 9) },
        uProbeAmt:    { value: 0 },
        uProbeRadius: { value: 0.11 },
        uFocusDist:   { value: 6 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this._buildBounds();
    this._buildSlice();
    this._buildProbe();
    this._buildSun();

    /* What the controls ask for. The uniforms ease toward these every frame,
       so a click on "ejecta only" dissolves rather than blinks. */
    this.target = {
      strength: 0.55, wind: 1, cme: 1, sliceOn: 0, slicePos: 0, threshold: 0.10,
      probe: 0, bounds: 1,
    };
    this.sliceAxis = 'z';
  }

  get object() { return this.group; }
  get uniforms() { return this.material.uniforms; }

  _build(rng) {
    const pos = [];
    const jitter = [];
    const seeds = [];
    const keeps = [];
    const sizes = [];
    const step = 2 / (GRID - 1);

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        for (let k = 0; k < GRID; k++) {
          const x = -1 + i * step;
          const y = -1 + j * step;
          const z = -1 + k * step;
          const r = Math.hypot(x, y, z);
          if (r > 1.02 || r < 0.12) continue;

          pos.push(x, y, z);
          // The raw cells sit where the simulation put them, not on any grid:
          // most of a cell width off, which is the error the resample removes.
          jitter.push((rng() - 0.5) * step * 2.2, (rng() - 0.5) * step * 2.2, (rng() - 0.5) * step * 2.2);
          seeds.push(rng());
          keeps.push(rng());
          sizes.push(0.85 + Math.pow(rng(), 2.4) * 1.6);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    const f32 = (a) => new Float32Array(a);
    g.setAttribute('position', new THREE.BufferAttribute(f32(pos), 3));
    g.setAttribute('aJitter', new THREE.BufferAttribute(f32(jitter), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(f32(seeds), 1));
    g.setAttribute('aKeep', new THREE.BufferAttribute(f32(keeps), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(f32(sizes), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.8);
    this.count = seeds.length;
    return g;
  }

  /**
   * The edges of the pinned grid. Mostly there so that a rotating cloud has
   * something rigid to read the rotation against, but it is also literally the
   * box every uploaded file is resampled into.
   */
  _buildBounds() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
    this.boundsMat = new THREE.LineBasicMaterial({
      color: 0x8fb4ff, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bounds = new THREE.LineSegments(edges, this.boundsMat);

    // Short brackets at each corner, brighter than the edges, so the box reads
    // as a frame and not as a wireframe cube competing with the data.
    const L = 0.16;
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      pts.push(sx, sy, sz, sx - sx * L, sy, sz);
      pts.push(sx, sy, sz, sx, sy - sy * L, sz);
      pts.push(sx, sy, sz, sx, sy, sz - sz * L);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.cornerMat = new THREE.LineBasicMaterial({
      color: 0xffc38a, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.corners = new THREE.LineSegments(cg, this.cornerMat);
    this.group.add(this.bounds, this.corners);
  }

  _buildSlice() {
    this.sliceUniforms = {
      uColor: { value: new THREE.Color(0xffb46e) },
      uOpacity: { value: 0 },
      uPos: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG,
      uniforms: this.sliceUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.slice = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    this.slice.visible = false;
    this.group.add(this.slice);
  }

  /** A small three-axis cross that sits on the probed cell. */
  _buildProbe() {
    const L = 0.07;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0, 0, 0, -L, 0, 0, L], 3));
    this.probeMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    });
    this.probeMark = new THREE.LineSegments(g, this.probeMat);
    this.probeMark.renderOrder = 5;
    this.group.add(this.probeMark);
  }

  /** The inner boundary of the domain, where the Sun sits. */
  _buildSun() {
    this.sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true }),
    );
    this.sunGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(0xffa24d) },
          uIntensity: { value: 0.6 },
          uTime: { value: 0 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.sunGlow.frustumCulled = false;
    this.group.add(this.sunCore, this.sunGlow);
  }

  /* ---------------------------------------------------------------- tools */

  /**
   * Apply the inspector's settings.
   * @param {{ wind?: boolean, cme?: boolean, slice?: 'off'|'x'|'y'|'z',
   *           slicePos?: number, threshold?: number }} t
   */
  setTools(t) {
    if (t.wind !== undefined) this.target.wind = t.wind ? 1 : 0;
    if (t.cme !== undefined) this.target.cme = t.cme ? 1 : 0;
    if (t.threshold !== undefined) this.target.threshold = t.threshold;
    if (t.slicePos !== undefined) this.target.slicePos = t.slicePos;
    if (t.slice !== undefined) {
      this.target.sliceOn = t.slice === 'off' ? 0 : 1;
      if (t.slice !== 'off' && t.slice !== this.sliceAxis) {
        this.sliceAxis = t.slice;
        this.uniforms.uSliceN.value.copy(AXES[t.slice]);
        this._orientSlice();
      }
    }
  }

  _orientSlice() {
    const s = this.slice;
    s.rotation.set(0, 0, 0);
    if (this.sliceAxis === 'x') s.rotation.y = Math.PI / 2;
    if (this.sliceAxis === 'y') s.rotation.x = -Math.PI / 2;
  }

  setStrength(s) { this.target.strength = clamp(s, 0, 1); }

  /** Jump straight to the current strength -- for a restore, not a scrub. */
  snapStrength(s) {
    this.target.strength = clamp(s, 0, 1);
    this.uniforms.uStrength.value = this.target.strength;
  }

  /**
   * Point at a cell.
   * @param {THREE.Vector3|null} gridPoint in grid space, or null to release
   */
  setProbe(gridPoint) {
    if (gridPoint) {
      this.uniforms.uProbe.value.copy(gridPoint);
      this.probeMark.position.copy(gridPoint);
      this.target.probe = 1;
    } else {
      this.target.probe = 0;
    }
  }

  /**
   * March a ray through the domain and return the densest visible cell on it.
   *
   * Densest rather than first-hit, because the wind fills the whole sphere: a
   * first-hit probe would only ever report the outer skin. Taking the maximum
   * along the ray lets you point THROUGH the wind at the rope behind it, which
   * is the thing people actually want to read.
   *
   * @param {THREE.Ray} ray in grid space
   */
  sample(ray) {
    const o = ray.origin;
    const d = ray.direction;
    const b = o.dot(d);
    const c = o.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;

    const sq = Math.sqrt(disc);
    const t0 = Math.max(0, -b - sq);
    const t1 = -b + sq;
    if (t1 <= t0) return null;

    const u = this.uniforms;
    const strength = u.uStrength.value;
    const wOn = this.target.wind;
    const cOn = this.target.cme;
    const sliceOn = this.target.sliceOn > 0.5;
    const n = AXES[this.sliceAxis];
    const thr = this.target.threshold;

    const STEPS = 64;
    let best = null;
    let bestD = thr + 0.05;
    for (let i = 0; i <= STEPS; i++) {
      const t = t0 + ((t1 - t0) * i) / STEPS;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (sliceOn && x * n.x + y * n.y + z * n.z - this.target.slicePos > 0) continue;
      const [wind, cme] = fieldParts(x, y, z, strength);
      const dens = Math.min(1, wind * wOn + cme * cOn);
      if (dens > bestD) {
        bestD = dens;
        best = { x, y, z, density: dens, wind: wind * wOn, cme: cme * cOn, r: Math.hypot(x, y, z) };
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ per frame */

  update(dt, elapsed, cameraDistance) {
    const u = this.uniforms;
    const t = this.target;
    u.uTime.value = elapsed;
    u.uFocusDist.value = cameraDistance;

    u.uStrength.value = damp(u.uStrength.value, t.strength, 5, dt);
    u.uWind.value = damp(u.uWind.value, t.wind, 6, dt);
    u.uCme.value = damp(u.uCme.value, t.cme, 6, dt);
    u.uThreshold.value = damp(u.uThreshold.value, t.threshold, 8, dt);
    u.uSliceOn.value = damp(u.uSliceOn.value, t.sliceOn, 6, dt);
    u.uSlicePos.value = damp(u.uSlicePos.value, t.slicePos, 10, dt);
    u.uProbeAmt.value = damp(u.uProbeAmt.value, t.probe, t.probe ? 10 : 5, dt);

    /* The furniture fades with the collapse: the box, the slice face, the
       probe and the inner Sun all belong to the volume, not the heliosphere. */
    const solid = 1 - u.uCollapse.value;
    const show = solid * u.uOpacity.value * t.bounds;

    this.boundsMat.opacity = 0.09 * show * 1.8;
    this.cornerMat.opacity = 0.40 * show * 1.8;

    this.slice.visible = u.uSliceOn.value > 0.01 && solid > 0.05;
    this.sliceUniforms.uOpacity.value = u.uSliceOn.value * solid;
    this.sliceUniforms.uPos.value = u.uSlicePos.value;
    const sp = u.uSlicePos.value;
    this.slice.position.set(
      this.sliceAxis === 'x' ? sp : 0,
      this.sliceAxis === 'y' ? sp : 0,
      this.sliceAxis === 'z' ? sp : 0,
    );

    this.probeMat.opacity = u.uProbeAmt.value * 0.9 * solid;
    this.probeMark.rotation.y = elapsed * 0.8;

    this.sunCore.material.opacity = solid;
    this.sunCore.visible = solid > 0.02;
    this.sunGlow.visible = solid > 0.02;
    this.sunGlow.material.uniforms.uTime.value = elapsed;
    this.sunGlow.material.uniforms.uIntensity.value = 0.55 * solid * Math.min(1, u.uOpacity.value * 2);
  }

  setPixelRatio(r) { this.uniforms.uPixelRatio.value = r; }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}
