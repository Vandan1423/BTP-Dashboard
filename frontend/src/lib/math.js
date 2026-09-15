/** Small maths helpers shared across pages. No three.js dependency on purpose. */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);

/** Maps v from one range to another and clamps the result. */
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v), 0, 1));

/** Frame-rate independent smoothing. `speed` is roughly "per second". */
export const damp = (a, b, speed, dt) => lerp(a, b, 1 - Math.exp(-speed * dt));

export const easeOutCubic  = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint  = (t) => 1 - Math.pow(1 - t, 5);
export const easeInCubic   = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack   = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/** Deterministic RNG so a reload reproduces the same starfield. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniformly distributed point on a unit sphere. */
export function randomOnSphere(rng, out = [0, 0, 0]) {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  out[0] = r * Math.cos(th); out[1] = r * Math.sin(th); out[2] = u;
  return out;
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
