/**
 * THE EQUIRECTANGULAR SHADER
 * ==========================
 * Every render is a 4096x2048 equirectangular projection: the full sphere of
 * directions around one planet, unrolled into a rectangle. Longitude runs along
 * the width, latitude along the height. Flat on screen it looks like a smeared
 * mess; it only reads correctly when it is wrapped back onto a sphere and
 * viewed from the middle.
 *
 * So the fragment shader does the inverse of the projection. It takes the
 * direction the fragment lies in and converts that direction back into a
 * longitude and a latitude, which are the texture coordinates.
 *
 * The obvious alternative is to let three.js do it -- assign the video to
 * `scene.background` with EquirectangularReflectionMapping and write no shader
 * at all. Three reasons this is done by hand instead:
 *
 *   1. `uOffset` rotates the mapping. The Blender cameras carry a Track To
 *      constraint aimed at the domain centre, which puts the Sun at the exact
 *      centre of every frame, so the mapping has to be aligned to make "looking
 *      straight ahead" mean "looking at the Sun". That has to be dialled in
 *      against the real asset, not assumed.
 *   2. The CME set and the magnetic field line set are two complete renders of
 *      the same 201 timesteps. `uBlend` and the second sampler are what let one
 *      dissolve into the other, which a background texture cannot do.
 *   3. No pinching at the poles, because the mapping never touches the sphere's
 *      own UV seam.
 */
import * as THREE from 'three';

export const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Object space position doubles as the view direction: the sphere is
    // centred on the viewer and never rotated, so a point on it IS a bearing.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform float uBlend;     // 0 = A only, 1 = B only
  uniform float uOffset;    // rotates the mapping, in turns
  uniform float uExposure;
  uniform float uFade;      // entrance veil: 0 = black, 1 = fully visible

  varying vec3 vDir;

  const float TWO_PI = 6.283185307179586;
  const float PI = 3.141592653589793;

  void main() {
    vec3 d = normalize(vDir);

    // Longitude, measured so that looking down -Z lands on the centre column
    // of the image and turning right walks rightward across it.
    float u = fract(0.5 + atan(d.x, -d.z) / TWO_PI + uOffset);
    // Latitude. asin, not acos, because the vertical axis of an equirectangular
    // image is latitude itself and not the angle from the pole.
    float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;

    vec2 uv = vec2(u, v);
    vec3 col = mix(texture2D(uTexA, uv).rgb, texture2D(uTexB, uv).rgb, uBlend);

    gl_FragColor = vec4(col * uExposure * uFade, 1.0);
  }
`;

/**
 * The sphere you sit inside.
 *
 * Radius 200 rather than something small: in a headset the image is
 * monoscopic, so the sphere has to be far enough away that both eyes see
 * essentially the same thing. Put it close and the scene reads as a painted
 * room you could reach out and touch.
 */
export function createSkySphere() {
  const geometry = new THREE.SphereGeometry(200, 64, 48);

  const uniforms = {
    uTexA: { value: null },
    uTexB: { value: null },
    uBlend: { value: 0 },
    uOffset: { value: 0 },
    uExposure: { value: 1 },
    uFade: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,   // we are on the inside looking out
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;    // always the backdrop, whatever gets added later
  return { mesh, uniforms, geometry, material };
}

/**
 * A video, wrapped for use as a texture.
 *
 * No mipmaps, and that is deliberate rather than an oversight. The longitude
 * comes out of an `atan`, which jumps by a full turn at the seam behind you.
 * The GPU picks a mipmap level from how fast the coordinate is changing between
 * neighbouring pixels, so at that seam it sees an enormous jump, decides the
 * texture is being minified enormously, and draws a blurred vertical stripe
 * down the middle of the view. Linear filtering with no mipmaps has no level to
 * pick and no stripe to draw.
 */
export function videoTexture(video) {
  const tex = new THREE.VideoTexture(video);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;   // the seam wraps instead of clamping
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
