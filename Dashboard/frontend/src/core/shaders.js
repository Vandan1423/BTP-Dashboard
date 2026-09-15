/** GLSL shared by the core visuals. Kept as strings so there is no build step
 *  beyond Vite, and so a teammate can read the maths next to the JS that drives it. */

/* ---------------------------------------------------------------- starfield */
export const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute vec3  aColor;

  uniform float uTime;
  uniform float uPixelRatio;

  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Twinkle: each star gets its own phase from aSeed so they never pulse together.
    float twinkle = 0.62 + 0.38 * sin(uTime * 1.4 + aSeed * 6.2831853);
    vAlpha = twinkle;
    vColor = aColor;

    gl_PointSize = aSize * uPixelRatio * (46.0 / max(-mv.z, 0.001));
  }
`;

export const STAR_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, pow(core, 2.4) * vAlpha);
  }
`;

/* ------------------------------------------------------------------- nebula */
export const NEBULA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const NEBULA_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uSeed;
  varying vec2  vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float falloff = smoothstep(1.0, 0.02, r);
    float n = fbm(vUv * 3.2 + vec2(uSeed, uSeed * 0.63) + uTime * 0.010);
    float d = falloff * (0.28 + 0.9 * n);
    gl_FragColor = vec4(uColor * d, d * uOpacity);
  }
`;
