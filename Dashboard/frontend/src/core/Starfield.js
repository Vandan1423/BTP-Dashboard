/**
 * The background: three parallax star layers and a few nebula clouds.
 *
 * Depth comes from moving the layers at different rates against the cursor.
 * The near layer swings noticeably, the far layer barely at all, which is what
 * sells the sense of space more than any single effect here.
 */
import * as THREE from 'three';
import { STAR_VERT, STAR_FRAG, NEBULA_VERT, NEBULA_FRAG } from './shaders.js';
import { mulberry32, lerp } from '../lib/math.js';

const LAYERS = [
  { count: 2400, zNear: -190, zFar: -110, size: [1.4, 3.4], parallax: 0.20, spread: 210 },
  { count: 1300, zNear: -95,  zFar: -50,  size: [1.8, 4.0], parallax: 0.55, spread: 130 },
  { count: 420,  zNear: -38,  zFar: -18,  size: [2.2, 5.0], parallax: 1.15, spread: 70  },
];

// Real starlight skews blue-white with a warm minority. Pure white looks flat.
const PALETTE = [
  [0.78, 0.85, 1.00],
  [0.90, 0.94, 1.00],
  [1.00, 1.00, 1.00],
  [1.00, 0.90, 0.78],
  [0.72, 0.88, 1.00],
];

const NEBULAE = [
  { color: 0x3b2f8a, x: -26, y:  14, z: -80, size: 120, opacity: 0.10, seed: 1.7 },
  { color: 0x1c6f8c, x:  30, y: -12, z: -66, size: 100, opacity: 0.09, seed: 4.3 },
  { color: 0x7a2f6e, x:   6, y: -22, z: -54, size:  86, opacity: 0.07, seed: 9.1 },
];

export class Starfield {
  constructor({ pixelRatio = 1, seed = 20260909 } = {}) {
    this.group = new THREE.Group();
    this.layers = [];
    this.nebulae = [];

    const rng = mulberry32(seed);

    for (const cfg of LAYERS) {
      const { count } = cfg;
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const seedA = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        pos[i * 3]     = (rng() - 0.5) * cfg.spread * 2;
        pos[i * 3 + 1] = (rng() - 0.5) * cfg.spread * 1.3;
        pos[i * 3 + 2] = lerp(cfg.zNear, cfg.zFar, rng());

        const c = PALETTE[(rng() * PALETTE.length) | 0];
        // Bias toward dim: a few bright stars read better than a uniform wash.
        const b = 0.45 + Math.pow(rng(), 2.2) * 0.55;
        col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;

        size[i] = lerp(cfg.size[0], cfg.size[1], Math.pow(rng(), 2));
        seedA[i] = rng();
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor',   new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize',    new THREE.BufferAttribute(size, 1));
      g.setAttribute('aSeed',    new THREE.BufferAttribute(seedA, 1));

      const m = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(g, m);
      points.frustumCulled = false;
      points.userData.parallax = cfg.parallax;
      this.group.add(points);
      this.layers.push(points);
    }

    for (const n of NEBULAE) {
      const m = new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        uniforms: {
          uTime:    { value: 0 },
          uColor:   { value: new THREE.Color(n.color) },
          uOpacity: { value: n.opacity },
          uSeed:    { value: n.seed },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(n.size, n.size), m);
      mesh.position.set(n.x, n.y, n.z);
      mesh.userData.drift = (n.seed % 1) * 0.02 + 0.006;
      this.group.add(mesh);
      this.nebulae.push(mesh);
    }
  }

  update(dt, elapsed, pointer) {
    for (const layer of this.layers) {
      layer.material.uniforms.uTime.value = elapsed;
      const p = layer.userData.parallax;
      layer.position.x = -pointer.x * p * 2.6;
      layer.position.y = -pointer.y * p * 1.8;
      layer.rotation.z = elapsed * 0.0035 * p;
    }
    for (const n of this.nebulae) {
      n.material.uniforms.uTime.value = elapsed;
      n.rotation.z += dt * n.userData.drift * 0.12;
    }
  }

  setPixelRatio(r) {
    for (const l of this.layers) l.material.uniforms.uPixelRatio.value = r;
  }
}
