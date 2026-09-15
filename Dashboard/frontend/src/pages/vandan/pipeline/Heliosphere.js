/**
 * WHERE THE CAMERAS GO
 * ====================
 * Step two of a job is `GetPlanetsPositions.py`: ask Solar-MACH where Mercury,
 * Venus, Earth and Mars actually were on the timestep's date, and put a camera
 * at each one. This draws that.
 *
 * The positions are not decorative. They are read from the same
 * `camera_positions.csv` the viewer's orbital map reads, which is the same file
 * whose numbers were typed into the Blender cameras -- so a planet's dot here
 * and the viewpoint you stand at inside the finished sphere are literally the
 * same coordinate.
 *
 * Only the geometry lives in 3D: the Sun, the orbits, the planets and the
 * beams. Everything that has to be read -- names, distances, render progress --
 * is HTML pinned to the projected positions (ViewpointMarkers.js). Billboard
 * rings in world space grew with perspective until they swallowed the Sun and
 * sat on top of each other's labels; a ring drawn in CSS pixels cannot.
 *
 * Positions arrive in AU with the ecliptic in the x-y plane. Three.js has y up,
 * so the ecliptic is laid into the world's x-z plane.
 */
import * as THREE from 'three';
import { GLOW_VERT, GLOW_FRAG, BEAM_VERT, BEAM_FRAG } from './volumeShaders.js';
import { damp } from '../../../lib/math.js';

/** World units per astronomical unit. Mars at 1.6 AU lands at about 6.7. */
export const AU = 4.2;

/** One colour per viewpoint, matching the cards in the 360 section. */
export const BODY_COLOR = {
  Mercury: 0xc9bda8,
  Venus:   0xf0c98a,
  Earth:   0x7fb6ff,
  Mars:    0xe08a5a,
};

/** Planet radius in CSS pixels. Held constant whatever the camera does. */
const PLANET_PX = { Mercury: 3.6, Venus: 4.6, Earth: 4.8, Mars: 4.1 };

/** AU -> world. The ecliptic goes flat, and +z is chosen so the map is not mirrored. */
export const toWorld = (p, out = new THREE.Vector3()) =>
  out.set(p.x * AU, p.z * AU, -p.y * AU);

export class Heliosphere {
  constructor({ bodies }) {
    this.bodies = bodies;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.reveal = 0;
    this._revealTarget = 0;
    this.selected = new Set(bodies);
    this.active = null;
    this.hovered = null;

    this._scratch = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildSun();
    this.entries = new Map();
    for (const body of bodies) this.entries.set(body, this._buildBody(body));
  }

  _buildSun() {
    this.sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe6b8 }),
    );
    this.sunGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(0xffa84f) },
          uIntensity: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.sunGlow.frustumCulled = false;
    this.group.add(this.sunCore, this.sunGlow);
  }

  _buildBody(body) {
    const color = new THREE.Color(BODY_COLOR[body]);

    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        uniforms: {
          uColor: { value: color.clone() },
          uIntensity: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    glow.frustumCulled = false;

    /* The orbit, circular at the body's radius for that timestep. The real
       track wobbles by well under a pixel at this scale, and a clean ring reads
       as a reference line rather than as data with noise in it. */
    const SEG = 256;
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    og.setDrawRange(0, 0);
    const orbit = new THREE.Line(og, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    orbit.frustumCulled = false;

    /* The beam, from the Sun out to this camera, while it renders. Wide at the
       source, narrow at the camera; uv.y runs source to camera. */
    const bg = new THREE.CylinderGeometry(0.03, 0.42, 1, 36, 1, true);
    bg.translate(0, 0.5, 0);
    const beamUniforms = {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uOpacity: { value: 0 },
    };
    const beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: beamUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    beam.visible = false;
    beam.frustumCulled = false;

    this.group.add(orbit, beam, planet, glow);

    return {
      body, color, planet, glow, orbit, beam, beamUniforms,
      segments: SEG, orbitRadius: -1,
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      placed: false,
      radiusAU: 0,
      progress: 0, progressTarget: 0,
    };
  }

  /* ---------------------------------------------------------------- state */

  /** Place every camera from the ephemeris at one timestep. */
  setPositions(byBody, index) {
    for (const [body, e] of this.entries) {
      const track = byBody?.[body];
      const p = track?.[Math.max(0, Math.min(track.length - 1, index))];
      if (!p) continue;
      toWorld(p, e.target);
      e.radiusAU = Math.hypot(p.x, p.y, p.z);
      if (!e.placed) {
        // Arrive from further out along the same bearing, so placement reads
        // as the camera flying to its position rather than blinking in.
        e.position.copy(e.target).multiplyScalar(1.7);
        e.placed = true;
      }
      this._writeOrbit(e, e.radiusAU * AU);
    }
  }

  _writeOrbit(e, radius) {
    if (Math.abs(e.orbitRadius - radius) < 1e-4) return;
    e.orbitRadius = radius;
    const arr = e.orbit.geometry.attributes.position.array;
    for (let i = 0; i <= e.segments; i++) {
      const a = (i / e.segments) * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * radius;
      arr[i * 3 + 1] = 0;
      arr[i * 3 + 2] = Math.sin(a) * radius;
    }
    e.orbit.geometry.attributes.position.needsUpdate = true;
  }

  setSelected(bodies) { this.selected = new Set(bodies); }
  setActive(body) { this.active = body; }
  setHovered(body) { this.hovered = body; }

  setProgress(body, p) {
    const e = this.entries.get(body);
    if (e) e.progressTarget = Math.max(0, Math.min(1, p));
  }

  setReveal(t) {
    this._revealTarget = t;
    if (t > 0) this.group.visible = true;
  }

  /* ----------------------------------------------------------- per frame */

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} viewH  canvas height in CSS pixels, for constant-size planets
   */
  update(dt, elapsed, camera, viewH) {
    this.reveal = damp(this.reveal, this._revealTarget, 2.2, dt);
    if (this.reveal < 0.002 && this._revealTarget === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // World units per CSS pixel at unit distance, for this camera.
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewH);

    const sunDist = camera.position.length();
    this.sunCore.scale.setScalar(Math.max(0.12, 7.5 * perPx * sunDist) * this.reveal);
    this.sunGlow.material.uniforms.uTime.value = elapsed;
    this.sunGlow.material.uniforms.uIntensity.value = this.reveal * 0.9;

    for (const e of this.entries.values()) {
      const chosen = this.selected.has(e.body);
      const isActive = this.active === e.body;
      const isHover = this.hovered === e.body;

      e.position.lerp(e.target, Math.min(1, dt * 2.4));
      e.planet.position.copy(e.position);
      e.glow.position.copy(e.position);

      const dist = camera.position.distanceTo(e.position);
      const px = PLANET_PX[e.body] * (isHover ? 1.25 : 1);
      e.planet.scale.setScalar(px * perPx * dist * this.reveal);
      e.planet.material.opacity = chosen ? 1 : 0.45;

      // The glow quad is in view units, so its size is set in pixels too.
      e.glow.scale.setScalar(px * 9 * perPx * dist);
      const g = e.glow.material.uniforms;
      g.uTime.value = elapsed;
      g.uIntensity.value = this.reveal * (chosen ? (isActive ? 1.0 : 0.45) : 0.12);

      // Orbits draw themselves in. The active one is brightest, chosen ones
      // next, and the rest stay as faint reference lines.
      const grow = Math.max(0, Math.min(1, this.reveal * 1.3 - (chosen ? 0 : 0.2)));
      e.orbit.geometry.setDrawRange(0, Math.round(grow * (e.segments + 1)));
      const want = isActive ? 0.42 : isHover ? 0.34 : chosen ? 0.18 : 0.06;
      e.orbit.material.opacity = damp(e.orbit.material.opacity, want * this.reveal, 4, dt);

      e.progress = damp(e.progress, e.progressTarget, 6, dt);
      this._updateBeam(e, isActive, elapsed, dt);
    }
  }

  _updateBeam(e, isActive, elapsed, dt) {
    const u = e.beamUniforms;
    u.uOpacity.value = damp(u.uOpacity.value, (isActive ? 1 : 0) * this.reveal, 3.2, dt);
    u.uTime.value = elapsed;
    u.uProgress.value = e.progress;

    if (u.uOpacity.value < 0.005) { e.beam.visible = false; return; }
    e.beam.visible = true;

    const dir = this._scratch.copy(e.position);
    const len = dir.length() || 1;
    e.beam.scale.set(1, len, 1);
    e.beam.quaternion.setFromUnitVectors(this._up, dir.normalize());
  }

  /** Screen position of a world point, in CSS pixels. */
  projectPoint(v, camera, width, height, out) {
    const p = this._scratch.copy(v).project(camera);
    out.x = (p.x * 0.5 + 0.5) * width;
    out.y = (-p.y * 0.5 + 0.5) * height;
    out.visible = p.z < 1;
    return out;
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
    this.group.parent?.remove(this.group);
  }
}
