/**
 * THE VOLUME'S GLSL
 * =================
 * One point system plays every part of the conversion: the unstructured cells
 * that come out of the `.vtk`, the 256^3 lattice they are resampled onto, and
 * the collapse into the Sun once the volume is in place and the cameras take
 * over.
 *
 * The density field itself is evaluated here, per point, on the GPU. That is
 * what makes the volume something you can handle rather than something you
 * watch: scrubbing the timestep, cutting it open, isolating the wind from the
 * ejecta and lighting up the cells under the pointer are all uniforms, so every
 * one of them is free to change sixty times a second. When the field lived on
 * the CPU, changing the timestep meant rebuilding forty thousand points.
 *
 * `fieldParts` below has a twin in VolumeCloud.js, which the probe uses to read
 * a value back out under the cursor. The two must stay identical.
 */

export const FIELD_GLSL = /* glsl */ `
  // Returns (wind, ejecta) at a point in normalised grid space, -1..1.
  vec2 fieldParts(vec3 p, float strength) {
    float r = length(p);
    if (r > 1.0 || r < 0.14) return vec2(0.0);

    float phi = atan(p.z, p.y + 1e-6);
    float ang = acos(clamp(p.x / r, -1.0, 1.0));

    // The ambient wind: a shallow power law with radial streamers through it.
    float streamer = 0.74 + 0.26 * sin(phi * 5.0 + ang * 3.5) * sin(phi * 2.3 - ang * 2.1);
    float wind = 0.55 * pow(0.16 / r, 0.75) * streamer;

    // The ejection, as a torus: a shell for how far the front has travelled,
    // a ring for the angle off the propagation axis, strands for the twist.
    float front = mix(0.30, 0.80, strength);
    float thick = mix(0.05, 0.13, strength);
    float shell = exp(-((r - front) * (r - front)) / (2.0 * thick * thick));

    float ringAng = mix(0.30, 0.72, strength);
    float ringW = mix(0.16, 0.30, strength);
    float ring = exp(-((ang - ringAng) * (ang - ringAng)) / (2.0 * ringW * ringW));

    float s = 0.5 + 0.5 * sin(phi * 3.0 + r * 9.0 - ang * 4.0);
    float cme = shell * ring * (0.34 + 0.66 * s * s) * (0.5 + 1.1 * strength) * 2.1;
    cme *= smoothstep(0.0, 0.02, strength);

    return vec2(wind, cme);
  }
`;

export const VOLUME_VERT = /* glsl */ `
  precision highp float;

  // position is the cell's home on the resampled lattice, in grid space.
  attribute vec3  aJitter;     // how far the raw cell sits from that home
  attribute float aSeed;
  attribute float aKeep;       // which cells survive at a given density
  attribute float aSize;

  uniform float uTime;
  uniform float uStrength;     // 0 = quiet wind, 1 = the peak of the event
  uniform float uForm;         // 0 = raw cells, 1 = on the lattice
  uniform float uScan;         // 0..1, the resampling plane's position
  uniform float uScanWidth;
  uniform float uCollapse;     // 0..1, everything falls into the Sun
  uniform float uThreshold;    // the density floor
  uniform float uOpacity;
  uniform float uHot;
  uniform float uPixelRatio;

  uniform float uWind;         // isolate: how much of each component to draw
  uniform float uCme;

  uniform float uSliceOn;
  uniform vec3  uSliceN;
  uniform float uSlicePos;

  uniform vec3  uProbe;        // grid space
  uniform float uProbeAmt;
  uniform float uProbeRadius;

  uniform float uFocusDist;    // camera distance to the volume centre

  varying vec3  vColor;
  varying float vAlpha;
  varying float vCore;

  const float PI2 = 6.28318530718;

  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  ${FIELD_GLSL}

  // Cool at the edges, hot where the tracer is -- the pipeline's own ramp.
  vec3 ramp(float t) {
    vec3 c0 = vec3(0.07, 0.11, 0.34);
    vec3 c1 = vec3(0.13, 0.36, 0.86);
    vec3 c2 = vec3(0.28, 0.76, 1.00);
    vec3 c3 = vec3(0.86, 0.72, 0.72);
    vec3 c4 = vec3(1.00, 0.58, 0.20);
    vec3 c5 = vec3(1.00, 0.78, 0.42);
    if (t < 0.20) return mix(c0, c1, t / 0.20);
    if (t < 0.42) return mix(c1, c2, (t - 0.20) / 0.22);
    if (t < 0.62) return mix(c2, c3, (t - 0.42) / 0.20);
    if (t < 0.80) return mix(c3, c4, (t - 0.62) / 0.18);
    return mix(c4, c5, (t - 0.80) / 0.20);
  }

  void main() {
    vec3 g = position;
    float r = length(g);

    vec2 parts = fieldParts(g, uStrength);
    float d = min(1.0, parts.x * uWind + parts.y * uCme);

    // A cell is drawn when the density clears its own random bar. The number
    // of cells, not their brightness, is what carries density: scaling both
    // makes a dense region stack twenty deep and saturate to flat white.
    float keepP = 0.24 + min(d, 0.5) * 0.64;
    float keep = smoothstep(aKeep - 0.04, aKeep + 0.04, keepP)
               * step(0.14, r) * step(r, 1.0);

    /* --- resample ---------------------------------------------------- */
    float lx = g.x * 0.5 + 0.5;
    float conv = smoothstep(uScan + uScanWidth, uScan - uScanWidth, lx);
    float form = max(uForm, conv);

    // The raw cells breathe; the resampled ones are perfectly still. That
    // stillness is the whole visual argument for the grid.
    vec3 drift = vec3(
      sin(uTime * 0.42 + aSeed * PI2),
      sin(uTime * 0.37 + aSeed * PI2 * 1.7),
      cos(uTime * 0.31 + aSeed * PI2 * 2.3)
    ) * 0.018 * (1.0 - form);

    vec3 p = mix(g + aJitter, g, form) + drift;

    /* --- collapse ---------------------------------------------------- */
    p.xz = rot(uCollapse * (2.6 + aSeed * 2.0)) * p.xz;
    p *= mix(1.0, 0.05 + aSeed * 0.04, uCollapse);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    /* --- what lights a cell up --------------------------------------- */
    float scanning = step(0.001, uScan) * (1.0 - step(0.999, uScan));
    float flash = exp(-pow((lx - uScan) / max(uScanWidth, 0.001), 2.0)) * scanning;

    // The slice keeps the half behind the plane and makes the cut face glow.
    float sd = dot(g, uSliceN) - uSlicePos;
    float cut = mix(1.0, smoothstep(0.015, -0.015, sd), uSliceOn);
    float face = exp(-(sd * sd) / 0.0018) * uSliceOn;

    float pd = length(g - uProbe);
    float probe = exp(-(pd * pd) / (uProbeRadius * uProbeRadius)) * uProbeAmt;

    float visible = smoothstep(uThreshold, uThreshold + 0.16, d);
    float hot = smoothstep(0.55, 1.0, d);

    // Cells nearer the camera than the centre are brighter, which is most of
    // what makes a point cloud read as a solid object while it turns.
    float depth = clamp(1.0 + (uFocusDist + mv.z) * 0.16, 0.5, 1.15);

    float bright = 0.5 + pow(fract(aSeed * 7.13), 1.6) * 0.42;
    vec3 col = ramp(min(1.0, d * 1.15)) * bright;
    col += vec3(0.45, 0.30, 0.12) * flash;
    col += vec3(0.18, 0.08, 0.00) * hot * uHot;
    col += vec3(0.22, 0.17, 0.10) * face;
    col = mix(col, vec3(1.0, 0.96, 0.88), probe * 0.5);

    vColor = col;
    vCore = hot;

    float a = uOpacity * keep * cut
            * (0.05 + visible * 0.95)
            * (0.55 + 0.45 * form)
            * (1.0 + flash * 1.6 + face * 1.5 + probe * 1.3)
            // Packing the cells into a twentieth of the radius multiplies how
            // many overlap per pixel by roughly the cube of that. Fading in
            // proportion keeps the brightness level as it falls in, instead of
            // flaring into a white ball on top of the Sun halfway through.
            * pow(1.0 - uCollapse, 3.0)
            * depth;
    vAlpha = a;

    float size = (aSize + d * 1.1)
               * (1.0 + flash * 1.3 + hot * 0.25 + face * 0.7 + probe * 1.0)
               * (1.0 - uCollapse * 0.6);
    // A cell that is not drawn costs nothing: zero size skips the fragments.
    gl_PointSize = size * uPixelRatio * (38.0 / max(-mv.z, 0.6)) * step(0.002, a);
  }
`;

export const VOLUME_FRAG = /* glsl */ `
  precision highp float;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vCore;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;

    float glow = pow(1.0 - r, 2.6);
    float core = pow(1.0 - r, 6.0) * (0.28 + vCore * 0.30);

    gl_FragColor = vec4(vColor * (glow + core), (glow + core) * vAlpha);
  }
`;

/**
 * The cut face of the slice: a disc where the plane meets the spherical
 * domain, with a faint grid across it and a bright rim. The rim radius is
 * worked out from the plane's offset, so the circle shrinks as the plane moves
 * toward the edge of the domain exactly as a real cross-section would.
 */
export const SLICE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SLICE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uPos;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float R = sqrt(max(0.0, 1.0 - uPos * uPos));

    vec2 cell = vUv * 18.0;
    vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
    float line = 1.0 - min(min(g.x, g.y), 1.0);

    float inside = smoothstep(R, R - 0.012, r);
    float rim = exp(-pow((r - R) / 0.012, 2.0));
    float frame = smoothstep(0.985, 1.0, max(abs(p.x), abs(p.y)));

    float a = (line * 0.09 * inside + inside * 0.02 + rim * 0.75 + frame * 0.10) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/**
 * A soft radial glow on a camera-facing quad. Drawn rather than textured,
 * because the site ships no image files.
 */
export const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // A billboard: offsets are added in view space so the quad always faces
    // the camera. The object's own scale is read back out of the model matrix
    // and applied by hand, because an offset added after the transform would
    // otherwise ignore it -- and the planets set their glow size every frame.
    float s = length(modelMatrix[0].xyz);
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * s;
    gl_Position = projectionMatrix * mv;
  }
`;

export const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;

    float halo = pow(max(0.0, 1.0 - r), 3.2);
    float core = pow(max(0.0, 1.0 - r), 14.0);
    float live = 1.0 + 0.06 * sin(uTime * 1.7) + 0.04 * sin(uTime * 2.9 + 1.3);

    float a = (halo * 0.85 + core) * uIntensity * live;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/**
 * The capture beam: what a camera is doing while it renders.
 *
 * A cone from the Sun out to the viewpoint, broken into lanes so it reads as a
 * bundle of separate rays travelling at their own speeds. One continuous band
 * just reads as a grey wedge.
 */
export const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uProgress;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float along = vUv.y;
    float lane = floor(vUv.x * 24.0);
    float seed = fract(sin(lane * 12.9898) * 43758.5453);

    float head = fract(uTime * (0.30 + seed * 0.55) + seed);
    float d = abs(fract(along - head + 0.5) - 0.5);
    float ray = exp(-d * 34.0) * (0.35 + 0.65 * uProgress) * step(0.35, seed);

    float edge = smoothstep(0.0, 0.14, along) * smoothstep(1.0, 0.80, along);
    float body = 0.012 + 0.03 * uProgress;

    float a = (body + ray * 0.75) * edge * uOpacity;
    gl_FragColor = vec4(uColor * (0.5 + ray * 1.3), a);
  }
`;
