/**
 * THE WORLD THE WHOLE SECTION LIVES IN
 * ====================================
 * One continuous scene carries every step of a job, and the forms and readouts
 * float over it. A file lands and the cells rush in; the resampling plane
 * sweeps through them; the block falls into the Sun and the heliosphere opens
 * out around it; a beam reaches each camera in turn as its frame renders.
 *
 * It borrows the renderer from the shared Stage -- `stage.setView` -- which is
 * the same contract the 360 viewer uses. Still one renderer, one loop.
 *
 * Handling it:
 *   drag         orbit, and a flick keeps turning until friction stops it
 *   wheel/pinch  dolly
 *   double-click reset the framing
 *   hover        on the volume, reads the densest cell under the pointer;
 *                on the heliosphere, highlights a viewpoint
 *   click        on a planet with a finished frame, opens it
 *
 * Left alone for a few seconds, the camera goes back to drifting on its own.
 */
import * as THREE from 'three';
import { clamp, damp, mulberry32, lerp, prefersReducedMotion } from '../../../lib/math.js';
import { VolumeCloud } from './VolumeCloud.js';
import { Heliosphere } from './Heliosphere.js';
import { ViewpointMarkers } from './ViewpointMarkers.js';
import { ALL_BODIES } from './api.js';

/**
 * Where the camera sits, and what the volume is doing, in each phase.
 *
 *   r      distance from the focus point
 *   phi    elevation, 0 is edge on to the ecliptic
 *   offX   how far the subject is pushed left, as a fraction of r, so the
 *          panel on the right never sits on top of it
 *   drift  radians per second of automatic turn once the visitor lets go
 *   vol    the volume's own targets; `form` and `thr` are overridden by the
 *          inspector on the phases where the inspector is shown
 */
const PHASES = {
  idle:      { r: 5.4,  phi: 0.32, offX: 0.10, drift: 0.07, fov: 46, probe: true,
               vol: { form: 0.00, collapse: 0, opacity: 0.50, hot: 0.20 }, helio: 0 },
  ingest:    { r: 4.4,  phi: 0.22, offX: 0.10, drift: 0.12, fov: 50, probe: false,
               vol: { form: 0.00, collapse: 0, opacity: 0.62, hot: 0.45 }, helio: 0 },
  configure: { r: 5.6,  phi: 0.30, offX: 0.12, drift: 0.05, fov: 46, probe: true,
               vol: { form: 0.00, collapse: 0, opacity: 0.52, hot: 0.40 }, helio: 0 },
  convert:   { r: 4.6,  phi: 0.12, offX: 0.24, drift: 0.02, fov: 48, probe: false,
               vol: { form: 0.00, collapse: 0, opacity: 0.54, hot: 0.55, thr: 0.08 }, helio: 0 },
  place:     { r: 19.0, phi: 0.92, offX: 0.18, drift: 0.035, fov: 44, probe: false,
               vol: { form: 1.00, collapse: 1, opacity: 0.38, hot: 0.70, thr: 0.08 }, helio: 1 },
  render:    { r: 18.0, phi: 0.88, offX: 0.18, drift: 0.03, fov: 44, probe: false,
               vol: { form: 1.00, collapse: 1, opacity: 0.34, hot: 0.65, thr: 0.08 }, helio: 1 },
  done:      { r: 18.0, phi: 0.90, offX: 0.20, drift: 0.03, fov: 44, probe: false,
               vol: { form: 1.00, collapse: 1, opacity: 0.34, hot: 0.55, thr: 0.08 }, helio: 1 },
};

/** The volume block's size in world units, before it collapses. */
const VOLUME_SCALE = 1.45;

/** Radians of turn per pixel dragged, and how fast a flick runs out. */
const DRAG_RATE = 0.0050;
const FRICTION = 3.4;
/** Radians per second a flick may carry. */
const MAX_SPIN = 3.2;
/** Seconds of stillness before the automatic drift eases back in. */
const IDLE_RESUME = 3.0;

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  void main() {
    vTwinkle = 0.62 + 0.38 * sin(uTime * 0.7 + aSeed * 31.4);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (150.0 / max(-mv.z, 1.0));
  }
`;

const STAR_FRAG = /* glsl */ `
  precision mediump float;
  varying float vTwinkle;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    float a = pow(1.0 - r, 2.2) * vTwinkle;
    gl_FragColor = vec4(vec3(0.80, 0.87, 1.0) * a, a * 0.85);
  }
`;

/**
 * A shell of stars rather than the site's parallax slab: this camera orbits
 * all the way round, so the backdrop has to surround it.
 */
function starShell(pixelRatio) {
  const COUNT = 2600;
  const rng = mulberry32(77712026);
  const pos = new Float32Array(COUNT * 3);
  const size = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const R = 90 + rng() * 40;
    pos[i * 3] = Math.cos(th) * s * R;
    pos[i * 3 + 1] = u * R;
    pos[i * 3 + 2] = Math.sin(th) * s * R;
    size[i] = lerp(1.1, 4.2, Math.pow(rng(), 2.4));
    seed[i] = rng();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 140);
  const m = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return { points, material: m };
}

export class PipelineScene {
  /**
   * @param {object} opts
   * @param {import('../../../core/Stage.js').Stage} opts.stage
   * @param {(body: string) => void} [opts.onPick]     a planet was clicked
   * @param {() => DOMRect|null} [opts.getPanelRect]   where the side panel is
   */
  constructor({ stage, onPick, getPanelRect }) {
    this.stage = stage;
    this.onPick = onPick;
    this.getPanelRect = getPanelRect;
    this.phase = 'idle';
    this.calm = prefersReducedMotion();

    /* ------------------------------------------------------------ scene */
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);

    this.stars = starShell(stage.pixelRatio);
    this.scene.add(this.stars.points);

    this.volume = new VolumeCloud({ pixelRatio: stage.pixelRatio });
    this.volume.group.scale.setScalar(VOLUME_SCALE);
    this.scene.add(this.volume.group);

    this.helio = new Heliosphere({ bodies: ALL_BODIES });
    this.scene.add(this.helio.group);

    /* --------------------------------------------------------- camera */
    const p = PHASES.idle;
    this.cam = { r: p.r, theta: Math.PI / 2, phi: p.phi, offX: p.offX, offY: 0, fov: p.fov };
    this.camTarget = { r: p.r, phi: p.phi, offX: p.offX, fov: p.fov };
    this.drift = p.drift;

    // What the visitor has done to the framing, kept across phase changes.
    this.user = { theta: 0, phi: 0, zoom: 1, velTheta: 0, velPhi: 0 };
    this.idle = IDLE_RESUME;
    this._resetting = false;

    this.tools = { grid: 'raw', threshold: 0.10 };
    this.inspectorPhase = true;

    this._focus = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._gridRay = new THREE.Ray();
    this._inv = new THREE.Matrix4();
    this._ndc = new THREE.Vector2();
    this._probePoint = new THREE.Vector3();

    /* ------------------------------------------------------------- DOM */
    this.element = document.createElement('div');
    this.element.className = 'pscene';
    this.element.innerHTML = `
      <div class="pscene__markers" aria-hidden="true"></div>
      <div class="pprobe" aria-hidden="true">
        <div class="pprobe__head"><span>Cell</span><b data-cell></b><em>model</em></div>
        <div class="pprobe__row"><span>Radius</span><b data-r></b></div>
        <div class="pprobe__row"><span>Density</span><b data-d></b></div>
        <div class="pprobe__bar"><i data-bar-wind></i><i data-bar-cme></i></div>
        <div class="pprobe__legend"><span>wind <b data-w></b></span><span>ejecta <b data-c></b></span></div>
      </div>`;
    this.markerLayer = this.element.querySelector('.pscene__markers');
    this.markers = new ViewpointMarkers({ bodies: ALL_BODIES, layer: this.markerLayer });
    this._planetScreen = new Map(ALL_BODIES.map((b) => [b, { x: 0, y: 0, visible: false }]));
    this._sunScreen = { x: 0, y: 0, visible: false };

    this.probeEl = this.element.querySelector('.pprobe');
    this.probeFields = {
      cell: this.probeEl.querySelector('[data-cell]'),
      r: this.probeEl.querySelector('[data-r]'),
      d: this.probeEl.querySelector('[data-d]'),
      w: this.probeEl.querySelector('[data-w]'),
      c: this.probeEl.querySelector('[data-c]'),
      barW: this.probeEl.querySelector('[data-bar-wind]'),
      barC: this.probeEl.querySelector('[data-bar-cme]'),
    };
    this.pointer = { x: 0, y: 0, inside: false };

    this._bindPointer();

    this.restoreView = stage.setView(this.scene, this.camera);
    this._bindResize();
    this.stopFrame = stage.onFrame((dt, elapsed) => this._frame(dt, elapsed));

    this.setPhase('idle');
    if (import.meta.env.DEV) window.__pipeline = this;
  }

  _bindResize() {
    this.stage.onViewResize((w, h) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  /* ------------------------------------------------------------ controls */

  _bindPointer() {
    const el = this.element;
    const pointers = new Map();
    let drag = null;
    let pinch = 0;

    this._onDown = (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      capture(el, "set", e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      this.user.velTheta = 0;
      this.user.velPhi = 0;
      this._resetting = false;
      this.idle = 0;
      el.classList.add('is-dragging');
    };

    this._onMove = (e) => {
      const rect = el.getBoundingClientRect();
      this.pointer.x = e.clientX - rect.left;
      this.pointer.y = e.clientY - rect.top;
      this.pointer.inside = true;

      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.user.zoom = clamp(this.user.zoom * (pinch / d), 0.5, 2.2);
        pinch = d;
        this.idle = 0;
        return;
      }
      if (!drag) return;

      const now = performance.now();
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const dt = Math.max(1, now - drag.t) / 1000;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;

      this.user.theta -= dx * DRAG_RATE;
      this.user.phi = clamp(this.user.phi + dy * DRAG_RATE * 0.75, -0.55, 0.62);
      // A smoothed velocity, so letting go mid-flick carries on at the speed
      // the hand was moving rather than at whatever the last event happened
      // to measure.
      // Capped, so a hard flick spins the volume a turn or so rather than
      // sending it round and round until friction eventually wins.
      this.user.velTheta = clamp(lerp(this.user.velTheta, (-dx * DRAG_RATE) / dt, 0.45), -MAX_SPIN, MAX_SPIN);
      this.user.velPhi = clamp(lerp(this.user.velPhi, (dy * DRAG_RATE * 0.75) / dt, 0.45), -MAX_SPIN / 2, MAX_SPIN / 2);
      this.idle = 0;
    };

    this._onUp = (e) => {
      pointers.delete(e.pointerId);
      capture(el, "release", e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!drag) return;
      // If the hand stopped before it let go, there is no flick to carry.
      if (performance.now() - drag.t > 80) { this.user.velTheta = 0; this.user.velPhi = 0; }
      if (drag.moved < 6) this._click(e);
      drag = null;
      el.classList.remove('is-dragging');
    };

    this._onLeave = () => { this.pointer.inside = false; };

    this._onWheel = (e) => {
      e.preventDefault();
      this.user.zoom = clamp(this.user.zoom * Math.exp(e.deltaY * 0.0012), 0.5, 2.2);
      this._resetting = false;
      this.idle = 0;
    };

    this._onDbl = () => this.resetFraming();

    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointercancel', this._onUp);
    el.addEventListener('pointerleave', this._onLeave);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('dblclick', this._onDbl);
  }

  _click(e) {
    if (!this.onPick || this.helio.reveal < 0.5) return;
    const rect = this.element.getBoundingClientRect();
    const body = this.markers.pick(e.clientX - rect.left, e.clientY - rect.top, 26);
    if (body) this.onPick(body);
  }

  /**
   * Hand the renderer to something else for a moment, and take it back.
   *
   * `Stage.setView` has exactly one slot, so a second caller grabbing it
   * directly would leave nothing to restore. Accepts a scene and camera, or a
   * render function, exactly as setView does.
   *
   * @returns {() => void} give it back
   */
  takeView(sceneOrRender, camera) {
    this.stage.setView(sceneOrRender, camera);
    this.element.classList.add('is-lent');
    return () => {
      this.element.classList.remove('is-lent');
      this.restoreView = this.stage.setView(this.scene, this.camera);
      this._bindResize();
    };
  }

  /* -------------------------------------------------------------- state */

  setPhase(name) {
    const p = PHASES[name] ?? PHASES.idle;
    this.phase = name;
    Object.assign(this.camTarget, { r: p.r, phi: p.phi, offX: p.offX, fov: p.fov });
    this.drift = this.calm ? 0 : p.drift;
    this._volTarget = p.vol;
    this._probeAllowed = p.probe;
    this.helio.setReveal(p.helio);
    this.element.dataset.phase = name;
  }

  /**
   * Whether the inspector's settings apply.
   *
   * Off while a job runs: a volume left sliced in half, or with the wind
   * switched off, would make the conversion look like it lost half the data.
   * The settings are kept and put back when the inspector returns.
   */
  setInspectorActive(on) {
    this.inspectorPhase = on;
    this.volume.setTools(on ? this.tools : { wind: true, cme: true, slice: 'off' });
  }

  /** The inspector's settings. */
  setTools(tools) {
    this.tools = { ...tools };
    if (this.inspectorPhase) this.volume.setTools(tools);
  }

  /** Put the framing back to the phase default, smoothly. */
  resetFraming() {
    this._resetting = true;
    this.user.velTheta = 0;
    this.user.velPhi = 0;
  }

  setScan(t) { this._scanTarget = clamp(t, 0, 1); }
  setStrength(s) { this.volume.setStrength(s); }
  snapStrength(s) { this.volume.snapStrength(s); }
  setPositions(byBody, index) { this.helio.setPositions(byBody, index); }
  setSelected(bodies) { this.helio.setSelected(bodies); }
  setActive(body) { this.helio.setActive(body); }
  setProgress(body, p) { this.helio.setProgress(body, p); }

  /** @param {{ state, progress, text }} s  see ViewpointMarkers.set */
  setMarker(body, s) { this.markers.set(body, s); }

  /** A one-off shove on the volume, for the moment a file lands. */
  pulse() { this._pulse = 1; }

  /* ---------------------------------------------------------- per frame */

  _frame(dt, elapsed) {
    this.stars.material.uniforms.uTime.value = elapsed;

    this._frameVolume(dt, elapsed);
    this._frameCamera(dt);

    const w = this.element.clientWidth || window.innerWidth;
    const h = this.element.clientHeight || window.innerHeight;

    this.helio.update(dt, elapsed, this.camera, h);
    this._frameMarkers(dt, w, h);
    this._frameProbe(w, h);
  }

  _frameVolume(dt, elapsed) {
    const u = this.volume.uniforms;
    const t = this._volTarget ?? PHASES.idle.vol;
    const inspect = this.inspectorPhase && !t.thr;

    const form = inspect && this.tools.grid === 'grid' ? 1 : t.form;
    u.uForm.value = damp(u.uForm.value, form, 3.2, dt);
    u.uCollapse.value = damp(u.uCollapse.value, t.collapse, 1.7, dt);
    u.uHot.value = damp(u.uHot.value, t.hot, 2.0, dt);
    this.volume.target.threshold = inspect ? (this.tools.threshold ?? 0.10) : (t.thr ?? 0.10);

    this._pulse = Math.max(0, (this._pulse ?? 0) - dt * 1.6);
    u.uOpacity.value = damp(u.uOpacity.value, t.opacity, 2.2, dt) + this._pulse * 0.4;

    // The scan only runs while converting, and afterwards reads as complete.
    const before = this.phase === 'idle' || this.phase === 'ingest' || this.phase === 'configure';
    const scanWant = this.phase === 'convert' ? (this._scanTarget ?? 0) : before ? 0 : 1;
    u.uScan.value = damp(u.uScan.value, scanWant, 3.0, dt);
    u.uScanWidth.value = this.phase === 'convert' ? 0.055 : 0.14;

    this.volume.group.scale.setScalar(VOLUME_SCALE * (1 + this._pulse * 0.05));
    this.volume.update(dt, elapsed, this.camera.position.length());
  }

  _frameCamera(dt) {
    const c = this.cam;
    const tgt = this.camTarget;
    const u = this.user;

    /* The visitor's input: inertia first, then friction, then the reset. */
    if (!this.element.classList.contains('is-dragging')) {
      u.theta += u.velTheta * dt;
      u.phi = clamp(u.phi + u.velPhi * dt, -0.55, 0.62);
      const decay = Math.exp(-FRICTION * dt);
      u.velTheta *= decay;
      u.velPhi *= decay;
    }
    if (this._resetting) {
      u.phi = damp(u.phi, 0, 4, dt);
      u.zoom = damp(u.zoom, 1, 4, dt);
      if (Math.abs(u.phi) < 0.002 && Math.abs(u.zoom - 1) < 0.002) this._resetting = false;
    }
    this.idle += dt;

    const narrow = window.innerWidth < 1100;
    // A narrow window leaves the scene only the band above the sheet, so the
    // camera stands further back and the subject is lifted into that band.
    c.r = damp(c.r, tgt.r * u.zoom * (narrow ? 1.8 : 1), 2.2, dt);
    c.phi = damp(c.phi, tgt.phi, 2.2, dt);
    c.offX = damp(c.offX, narrow ? 0 : tgt.offX, 2.2, dt);
    c.offY = damp(c.offY, narrow ? 0.2 : 0, 2.2, dt);
    c.fov = damp(c.fov, tgt.fov, 2.2, dt);

    // The automatic turn eases back in after a few seconds of stillness,
    // rather than snapping on and yanking the view out of the visitor's hands.
    const resume = clamp((this.idle - IDLE_RESUME) / 2, 0, 1);
    c.theta += this.drift * resume * dt;

    const theta = c.theta + u.theta;
    const phi = clamp(c.phi + u.phi, -0.45, 1.38);

    this._eye.set(
      Math.cos(theta) * Math.cos(phi) * c.r,
      Math.sin(phi) * c.r,
      Math.sin(theta) * Math.cos(phi) * c.r,
    );

    // Slide the eye and what it looks at sideways together: the subject moves
    // across the frame, clear of the panel, without the projection skewing.
    this._right.set(Math.sin(theta), 0, -Math.cos(theta)).multiplyScalar(c.offX * c.r);
    this._right.y -= c.offY * c.r;
    this._look.copy(this._focus).add(this._right);
    this.camera.position.copy(this._eye).add(this._right);
    this.camera.lookAt(this._look);

    if (Math.abs(this.camera.fov - c.fov) > 0.01) {
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _frameMarkers(dt, w, h) {
    if (this.helio.reveal < 0.02) {
      this.markers.update(this._planetScreen, this._sunScreen, w, h, null, 0, dt);
      return;
    }
    this.helio.projectPoint(this._focus, this.camera, w, h, this._sunScreen);
    for (const [body, e] of this.helio.entries) {
      this.helio.projectPoint(e.position, this.camera, w, h, this._planetScreen.get(body));
    }

    // Labels stay clear of the top bar, the dock and the side panel.
    const panel = this.getPanelRect?.();
    const bounds = { left: 16, top: 120, right: w - 16, bottom: h - 110 };
    if (panel && panel.width && panel.left > w * 0.5) bounds.right = panel.left - 14;
    this.markers.update(this._planetScreen, this._sunScreen, w, h, bounds, this.helio.reveal, dt);

    // Hover a viewpoint on the map.
    const hovered = this.pointer.inside && !this.element.classList.contains('is-dragging')
      ? this.markers.pick(this.pointer.x, this.pointer.y, 26) : null;
    this.markers.setHovered(hovered);
    this.helio.setHovered(hovered);
    this.element.classList.toggle('is-over-planet', !!hovered);
  }

  /**
   * Read the densest cell under the pointer.
   *
   * The pointer ray is taken into the volume's own grid space by the inverse
   * of its world matrix, so the march runs in the same -1..1 coordinates the
   * shader evaluates the field in, and the answer lines up with what is drawn.
   */
  _frameProbe(w, h) {
    const allowed = this._probeAllowed && this.pointer.inside
      && !this.element.classList.contains('is-dragging')
      && this.volume.uniforms.uCollapse.value < 0.1;

    let hit = null;
    if (allowed) {
      this._ndc.set((this.pointer.x / w) * 2 - 1, -(this.pointer.y / h) * 2 + 1);
      this._ray.setFromCamera(this._ndc, this.camera);
      this.volume.group.updateMatrixWorld();
      this._inv.copy(this.volume.group.matrixWorld).invert();
      this._gridRay.copy(this._ray.ray).applyMatrix4(this._inv);
      this._gridRay.direction.normalize();
      hit = this.volume.sample(this._gridRay);
    }

    if (!hit) {
      this.volume.setProbe(null);
      this.probeEl.classList.remove('is-on');
      return;
    }

    this._probePoint.set(hit.x, hit.y, hit.z);
    this.volume.setProbe(this._probePoint);

    const cell = (v) => String(Math.round((v * 0.5 + 0.5) * 255)).padStart(3, '0');
    const f = this.probeFields;
    f.cell.textContent = `${cell(hit.x)} · ${cell(hit.y)} · ${cell(hit.z)}`;
    f.r.textContent = `${hit.r.toFixed(2)} R`;
    f.d.textContent = hit.density.toFixed(2);
    const total = hit.wind + hit.cme || 1;
    const wShare = hit.wind / total;
    f.w.textContent = `${Math.round(wShare * 100)}%`;
    f.c.textContent = `${Math.round((1 - wShare) * 100)}%`;
    f.barW.style.width = `${(wShare * hit.density * 100).toFixed(1)}%`;
    f.barC.style.width = `${((1 - wShare) * hit.density * 100).toFixed(1)}%`;

    // Beside the cursor, flipped to the other side before it would run under
    // the side panel or off the edge.
    const pw = 196, ph = 112;
    const panel = this.getPanelRect?.();
    const limit = panel && panel.width && panel.left > w * 0.5 ? panel.left - 12 : w - 16;
    const x = this.pointer.x + 18 + pw > limit ? this.pointer.x - 18 - pw : this.pointer.x + 18;
    const y = clamp(this.pointer.y - ph / 2, 90, h - ph - 110);
    this.probeEl.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
    this.probeEl.classList.add('is-on');
  }

  destroy() {
    this.stopFrame?.();
    this.restoreView?.();
    const el = this.element;
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointercancel', this._onUp);
    el.removeEventListener('pointerleave', this._onLeave);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('dblclick', this._onDbl);
    this.markers.destroy();
    this.volume.dispose();
    this.helio.dispose();
    this.stars.points.geometry.dispose();
    this.stars.material.dispose();
    el.remove();
    if (import.meta.env.DEV && window.__pipeline === this) delete window.__pipeline;
  }
}

/**
 * Pointer capture throws when the pointer is already gone -- a touch that was
 * cancelled, or a pen lifted mid-gesture. Losing capture is harmless; an
 * exception out of an event handler is not.
 */
function capture(el, verb, id) {
  try { el[`${verb}PointerCapture`](id); } catch { /* the pointer has already ended */ }
}
