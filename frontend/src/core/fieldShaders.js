/**
 * GLSL for the particle field.
 *
 * Every particle carries two home positions -- one in the galaxy disc, one in
 * the dust wave -- and the vertex shader blends between them. Motion, cursor
 * repulsion and colour all happen on the GPU, so the CPU never touches a
 * particle after it is created.
 */

export const FIELD_VERT = /* glsl */ `
  attribute vec3  aGalaxy;    // home position in the disc
  attribute vec3  aWave;      // home position in the dust wave
  attribute vec3  aColor;
  attribute float aSize;
  attribute float aSeed;

  uniform float uTime;
  uniform float uMorph;       // 0 = galaxy, 1 = wave
  uniform float uSpin;
  uniform float uTilt;      // inclination of the disc, radians
  uniform vec2  uPointerNdc;  // cursor in normalised device coords, -1..1
  uniform float uPointerAmp;  // 0 when the cursor is not over the canvas
  uniform float uPointerRadius;
  uniform float uAspect;
  uniform vec3  uFocus;         // world position of a hovered planet
  uniform float uFocusAmt;      // 0 = nobody hovered, 1 = fully focused
  uniform float uFocusRadius;   // how much of the field gets drawn in
  uniform float uFocusRing;     // radius of the halo they settle onto
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3  uTint;
  uniform float uTintAmount;

  varying vec3  vColor;
  varying float vAlpha;

  vec2 rot(vec2 v, float a) {
    float s = sin(a), c = cos(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  void main() {
    // --- galaxy: differential rotation ------------------------------------
    // Inner particles orbit faster than outer ones, the way real discs do.
    // A rigid rotation reads as a spinning texture; this reads as a galaxy.
    vec3 g = aGalaxy;
    float r = length(g.xz);
    float omega = uSpin / (0.45 + pow(r, 1.35) * 0.10);
    g.xz = rot(g.xz, uTime * omega);
    g.y += sin(uTime * 0.45 + aSeed * 6.2831) * 0.10;

    // Incline the disc after spinning it, so we see an ellipse rather than the
    // edge-on line a flat XZ disc would give from this camera. Tilting only the
    // galaxy leaves the dust wave level.
    float ct = cos(uTilt), st = sin(uTilt);
    g.yz = vec2(g.y * ct - g.z * st, g.y * st + g.z * ct);

    // --- wave: a slow travelling swell ------------------------------------
    vec3 w = aWave;
    w.y += sin(uTime * 0.42 + w.x * 0.16 + w.z * 0.11) * 0.75;
    w.x += cos(uTime * 0.24 + w.z * 0.08) * 0.35;

    float m = smoothstep(0.0, 1.0, uMorph);
    vec3 pos = mix(g, w, m);

    // --- hover focus ------------------------------------------------------
    // Particles near the hovered planet are drawn onto a halo around it and
    // keep their brightness; everything else is dimmed away. That contrast is
    // the whole effect -- dimming alone just looks like the page fading out.
    float focus = 0.0;
    if (uFocusAmt > 0.001) {
      vec3 fd = pos - uFocus;
      float fdist = length(fd);
      focus = 1.0 - smoothstep(uFocusRadius * 0.25, uFocusRadius, fdist);
      vec3 halo = uFocus + normalize(fd + vec3(1e-4)) * uFocusRing;
      pos = mix(pos, halo, focus * uFocusAmt * 0.92);
    }

    vec4 mv   = modelViewMatrix * vec4(pos, 1.0);
    vec4 clip = projectionMatrix * mv;

    // --- cursor repulsion, in SCREEN space ---------------------------------
    // This used to measure distance in world space from a point on the z = 0
    // plane. The disc is tilted, so its outer regions sit well off that plane
    // and never felt the cursor even when it was directly over them -- the
    // effect only worked near the middle. Comparing positions after projection
    // makes the influence uniform everywhere on screen, whatever the depth.
    float boost = 0.0;
    if (uPointerAmp > 0.001 && clip.w > 0.0) {
      vec2 ndc = clip.xy / clip.w;
      // Scale x by aspect so the region of influence is a circle, not an oval.
      vec2 d = (ndc - uPointerNdc) * vec2(uAspect, 1.0);
      float f = 1.0 - smoothstep(0.0, uPointerRadius, length(d));
      f *= f;
      vec2 dir  = normalize(d + vec2(1e-5));
      vec2 tang = vec2(-dir.y, dir.x);          // swirl, so it is not a plain dent
      vec2 push = (dir + tang * 0.42) * f * uPointerAmp;
      // Multiplying by w keeps the shove a constant number of pixels at any depth.
      clip.xy += vec2(push.x / uAspect, push.y) * clip.w;
      boost = f;
    }

    gl_Position = clip;

    float focusBoost = focus * uFocusAmt;
    vec3 col = mix(aColor, uTint, uTintAmount);
    vColor = mix(col, vec3(1.0), boost * 0.55 + focusBoost * 0.20);

    // Fade the far side so the disc has depth instead of reading as a flat ring.
    float depthFade = smoothstep(-95.0, -8.0, mv.z);
    // The wave sits behind body copy, so it is held a little softer than the disc.
    vAlpha = uOpacity * mix(0.30, 1.0, depthFade) * (0.85 + boost * 0.9)
           * mix(1.0, 0.72, m)
           * mix(1.0, 0.10, uFocusAmt * (1.0 - focus))   // dim everything else
           * (1.0 + focusBoost * 0.55);

    // 80, not 300: with 26k additive points a larger constant blows the whole
    // disc out to flat white long before the structure reads.
    gl_PointSize = aSize * (1.0 + boost * 0.9 + focusBoost * 0.25) * uPixelRatio
                 * (80.0 / max(-mv.z, 0.001));
  }
`;

export const FIELD_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, pow(core, 2.2) * vAlpha);
  }
`;
