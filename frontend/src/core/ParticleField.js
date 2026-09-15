/**
 * The particle field: the single visual that carries the whole site.
 *
 * It has two formations and blends between them:
 *   - GALAXY, a spiral accretion disc, shown on the mission-select screen
 *   - WAVE, a slow drifting dust lane, shown behind a project's content
 *
 * Every particle is generated once with a home position in each formation.
 * After that the CPU only writes uniforms: the morph amount, the cursor
 * position, the tint. Twenty-six thousand particles cost nothing per frame.
 *
 * The disc rotates differentially -- inner orbits are faster than outer ones,
 * following a Keplerian falloff. Rigid rotation looks like a spinning texture;
 * this looks like a galaxy.
 */
import * as THREE from 'three';
import { FIELD_VERT, FIELD_FRAG } from './fieldShaders.js';
import { mulberry32, lerp } from '../lib/math.js';
import { VIEW } from '../lib/viewConfig.js';

const COUNT = 34000;

/* Colour ramp from the hot core outward. Reads cyan -> blue -> indigo -> magenta,
   which is what gives the disc its depth; a single hue looks flat. */
const RAMP = [
  { at: 0.00, c: [0.62, 0.99, 1.00] },
  { at: 0.16, c: [0.34, 0.78, 1.00] },
  { at: 0.40, c: [0.13, 0.38, 0.98] },
  { at: 0.66, c: [0.32, 0.17, 0.86] },
  { at: 0.85, c: [0.70, 0.16, 0.72] },
  { at: 1.00, c: [0.38, 0.10, 0.48] },
];

function sampleRamp(t) {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i].at) {
      const a = RAMP[i - 1], b = RAMP[i];
      const k = (t - a.at) / (b.at - a.at);
      return [lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k), lerp(a.c[2], b.c[2], k)];
    }
  }
  return RAMP[RAMP.length - 1].c;
}

/** Box-Muller, for the soft-edged clustering that makes arms look natural. */
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class ParticleField {
  constructor({ pixelRatio = 1, seed = 90902026 } = {}) {
    const rng = mulberry32(seed);

    const galaxy = new Float32Array(COUNT * 3);
    const wave   = new Float32Array(COUNT * 3);
    const color  = new Float32Array(COUNT * 3);
    const size   = new Float32Array(COUNT);
    const seeds  = new Float32Array(COUNT);

    const ARMS = 3;
    const TWIST = 2.4;           // radians of sweep per unit log-radius
    const R_OUT = 16.0;          // outer edge, used to normalise the colour ramp

    for (let i = 0; i < COUNT; i++) {
      /* ---------------- galaxy formation ----------------
         Three populations rather than one smooth disc. A single radial
         distribution gives an even smudge; the bright core / dark gap / dense
         ring separation is what makes it read as a real disc. */
      const roll = rng();
      let r, theta, thickness;

      if (roll < 0.12) {                       // bulge: small, dense, hot
        // Spread a little wider than looks right on paper: packed tighter, the
        // additive blending saturates into a flat white slab instead of a glow.
        r = 0.25 + Math.pow(rng(), 0.8) * 2.2;
        theta = rng() * Math.PI * 2;
        thickness = 0.95;
      } else if (roll < 0.60) {                // main ring, where the arms live
        // Tight radial spread keeps the arms coherent -- a wide one smears them
        // into a uniform smudge, because the twist turns radius into angle.
        r = Math.max(4.0, 6.3 + gauss(rng) * 1.25);
        theta = Math.floor(rng() * ARMS) * ((Math.PI * 2) / ARMS)
              + Math.log(1 + r) * TWIST + gauss(rng) * 0.38;
        thickness = 0.42;
      } else {                                 // outer halo, diffuse
        r = 7.5 + Math.pow(rng(), 0.7) * 8.5;
        theta = rng() < 0.5
          ? Math.floor(rng() * ARMS) * ((Math.PI * 2) / ARMS)
            + Math.log(1 + r) * TWIST + gauss(rng) * 0.9
          : rng() * Math.PI * 2;
        thickness = 0.9;
      }

      const y = gauss(rng) * thickness * 0.5;
      galaxy[i * 3]     = Math.cos(theta) * r;
      galaxy[i * 3 + 1] = y;
      galaxy[i * 3 + 2] = Math.sin(theta) * r;

      const t = Math.min(1, r / R_OUT);

      /* ---------------- wave formation ----------------
         A wide band sweeping across frame, sitting low so content clears it. */
      // A thin ribbon, not a slab. The gaussian term is the band's thickness --
      // widen it and the wave stops reading as a surface and fills the frame.
      const wx = (rng() - 0.5) * 84;
      const wz = (rng() - 0.5) * 28 - 8;
      wave[i * 3]     = wx;
      wave[i * 3 + 1] = Math.sin(wx * 0.115 + wz * 0.07) * 3.6
                      + Math.sin(wx * 0.042 + 1.7) * 2.4
                      + gauss(rng) * 0.6 - 9.5;
      wave[i * 3 + 2] = wz;

      /* ---------------- shading ---------------- */
      const shade = Math.min(1, t + Math.abs(gauss(rng)) * 0.10);
      const c = sampleRamp(shade);
      // A few particles burn white, which is what makes the core sparkle.
      const hot = rng() > 0.99 ? 1 : 0;
      const b = hot ? 1.0 : 0.60 + Math.pow(rng(), 1.4) * 0.40;
      color[i * 3]     = lerp(c[0] * b, 1.0, hot * 0.7);
      color[i * 3 + 1] = lerp(c[1] * b, 1.0, hot * 0.7);
      color[i * 3 + 2] = lerp(c[2] * b, 1.0, hot * 0.7);

      size[i] = (hot ? 2.6 : 0.55 + Math.pow(rng(), 2.4) * 1.9) * lerp(1.2, 0.8, t);
      seeds[i] = rng();
    }

    const g = new THREE.BufferGeometry();
    // `position` is unused by the shader but three needs it to size the draw call.
    g.setAttribute('position', new THREE.BufferAttribute(galaxy, 3));
    g.setAttribute('aGalaxy',  new THREE.BufferAttribute(galaxy, 3));
    g.setAttribute('aWave',    new THREE.BufferAttribute(wave, 3));
    g.setAttribute('aColor',   new THREE.BufferAttribute(color, 3));
    g.setAttribute('aSize',    new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 90);

    this.material = new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        uTime:          { value: 0 },
        uMorph:         { value: 0 },
        uSpin:          { value: 0.30 },
        uTilt:          { value: VIEW.discTilt }, // ellipse aspect = |sin(tilt)|
        uPointerNdc:    { value: new THREE.Vector2(0, 0) },
        uPointerAmp:    { value: 0 },
        // In NDC, 1.0 is half the viewport height. 0.09 is a circle about 38px
        // across on an 840px-tall window -- deliberately smaller than a planet,
        // so the cursor never looks like a bigger object than the things it
        // is pointing at.
        uPointerRadius: { value: 0.09 },
        uAspect:        { value: 1 },
        uFocus:         { value: new THREE.Vector3() },
        uFocusAmt:      { value: 0 },
        uFocusRadius:   { value: 4.4 },
        uFocusRing:     { value: 1.15 },
        uPixelRatio:    { value: pixelRatio },
        uOpacity:       { value: 0 },
        uTint:          { value: new THREE.Color(0x4da3ff) },
        uTintAmount:    { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;

    this._pointerTarget = new THREE.Vector2();
    this._ampTarget = 0;
    this._focusTarget = new THREE.Vector3();
    this._focusAmtTarget = 0;
    this._focusHeld = false;
  }

  get object() { return this.points; }
  get uniforms() { return this.material.uniforms; }

  /**
   * Cursor position in normalised device coords (-1..1), which is what
   * `stage.pointer` already holds. `active` false lets the field relax back.
   */
  setPointer(ndc, active) {
    this._pointerTarget.copy(ndc);
    this._ampTarget = active ? 0.048 : 0;   // shove distance, in NDC
  }

  /**
   * Draw the field in around a point and dim the rest -- used when a planet is
   * hovered. Pass `null` to release it.
   * @param {THREE.Vector3|null} worldPos
   */
  setFocus(worldPos) {
    if (worldPos) {
      this._focusTarget.copy(worldPos);
      this._focusHeld = true;
      this._focusAmtTarget = 1;
    } else {
      this._focusHeld = false;
      this._focusAmtTarget = 0;
    }
  }

  /** Blends the field's colour toward a section's accent. */
  setTint(hex, amount = 0.55) {
    this.uniforms.uTint.value.set(hex);
    this._tintTarget = amount;
  }

  update(dt, elapsed, camera) {
    const u = this.uniforms;
    if (camera) u.uAspect.value = camera.aspect;
    u.uTime.value = elapsed;
    // Read live so the dev tuner (and a hot reload) take effect immediately.
    u.uTilt.value = VIEW.discTilt;

    // Smooth the pointer so a fast flick does not tear a hole in the field.
    u.uPointerNdc.value.lerp(this._pointerTarget, Math.min(1, dt * 12));
    u.uPointerAmp.value += (this._ampTarget - u.uPointerAmp.value) * Math.min(1, dt * 5);

    // While held, track the planet as it orbits. While releasing, leave the
    // point where it was so the halo relaxes outward instead of sliding away.
    if (this._focusHeld) u.uFocus.value.copy(this._focusTarget);
    u.uFocusAmt.value += (this._focusAmtTarget - u.uFocusAmt.value) * Math.min(1, dt * 4.5);

    if (this._tintTarget !== undefined) {
      u.uTintAmount.value += (this._tintTarget - u.uTintAmount.value) * Math.min(1, dt * 2.2);
    }
  }

  setPixelRatio(r) { this.uniforms.uPixelRatio.value = r; }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.parent?.remove(this.points);
  }
}
