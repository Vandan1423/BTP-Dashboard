/**
 * The three project planets and their orbit rings.
 *
 * Everything lives in one group tilted to the same inclination as the particle
 * disc, so the orbits sit in the plane of the galaxy rather than floating in
 * front of it.
 *
 * The planets do move, but slowly -- a full lap takes several minutes. Fast
 * orbits would keep sliding the labels around and make the screen unreadable.
 */
import * as THREE from 'three';
import { PROJECTS, ORBIT } from '../../lib/projects.js';
import { VIEW } from '../../lib/viewConfig.js';

/** One shared radial-gradient sprite, generated rather than loaded. */
function glowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d').createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringGeometry(radius, segments = 220) {
  const pts = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts[i * 3] = Math.cos(a) * radius;
    pts[i * 3 + 1] = 0;
    pts[i * 3 + 2] = Math.sin(a) * radius;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  return g;
}

export class Planets {
  constructor() {
    this.group = new THREE.Group();
    this.group.rotation.x = VIEW.discTilt;  // same plane as the disc
    this.glow = glowTexture();
    this.items = [];

    // Dim key light so the spheres get a terminator instead of reading as flat
    // discs. Ambient alone would lose the roundness entirely.
    this.lights = new THREE.Group();
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-3, 5, 6);
    this.lights.add(new THREE.AmbientLight(0x223055, 1.4), key);

    // Planets sharing a radius share one ring. Drawing three identical rings on
    // top of each other just triples its brightness.
    this.rings = new Map();
    const ringFor = (radius) => {
      let ring = this.rings.get(radius);
      if (!ring) {
        ring = new THREE.LineLoop(
          ringGeometry(radius),
          new THREE.LineBasicMaterial({
            color: new THREE.Color(0x8fb4ff), transparent: true, opacity: 0.09,
            blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
          }),
        );
        this.rings.set(radius, ring);
        this.group.add(ring);
      }
      return ring;
    };

    // Evenly spaced by construction: each planet's angle comes from its index,
    // so the gaps are identical however many projects the registry holds.
    const step = (Math.PI * 2) / PROJECTS.length;
    const { radius, speed } = ORBIT;

    PROJECTS.forEach((p, i) => {
      const size = p.planetSize;
      const color = new THREE.Color(p.accent);
      const ring = ringFor(radius);

      const body = new THREE.Mesh(
        new THREE.SphereGeometry(size, 32, 24),
        new THREE.MeshStandardMaterial({
          color, roughness: 0.78, metalness: 0.05,
          emissive: color, emissiveIntensity: 0.35,
        }),
      );

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glow, color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      }));
      halo.scale.setScalar(size * 4.5);

      const node = new THREE.Group();
      node.add(body, halo);
      this.group.add(node);

      this.items.push({
        project: p, node, body, halo,
        radius, angle: ORBIT.phase0 + i * step, speed, size,
        hover: 0, hoverTarget: 0,
      });
    });

    this._v = new THREE.Vector3();
    this._opacity = 1;
  }

  get objects() { return [this.group, this.lights]; }

  setHover(id, on) {
    const it = this.items.find((i) => i.project.id === id);
    if (it) it.hoverTarget = on ? 1 : 0;
  }

  update(dt, elapsed) {
    this.group.rotation.x = VIEW.discTilt;   // stay in the disc's plane
    let anyHover = 0;
    for (const it of this.items) {
      it.angle += dt * it.speed;
      it.node.position.set(
        Math.cos(it.angle) * it.radius,
        0,
        Math.sin(it.angle) * it.radius,
      );
      it.body.rotation.y += dt * 0.25;

      it.hover += (it.hoverTarget - it.hover) * Math.min(1, dt * 8);
      const h = it.hover;
      it.node.scale.setScalar(1 + h * 0.28);
      it.halo.material.opacity = 0.85 + h * 0.9;
      it.body.material.emissiveIntensity = 0.35 + h * 0.8;
      anyHover = Math.max(anyHover, h);
    }
    // The ring is shared, so it brightens for whichever planet is hovered.
    for (const ring of this.rings.values()) {
      ring.material.opacity = (0.09 + anyHover * 0.26) * this._opacity;
    }
  }

  /** World position of a planet, for the field's hover focus. */
  worldPosition(id, out) {
    const it = this.items.find((i) => i.project.id === id);
    return it ? it.node.getWorldPosition(out) : null;
  }

  /**
   * Screen position of a planet, in CSS pixels.
   * @returns {{x:number,y:number,visible:boolean}}
   */
  screenPosition(index, camera, width, height) {
    const it = this.items[index];
    it.node.getWorldPosition(this._v);
    this._v.project(camera);
    return {
      x: (this._v.x * 0.5 + 0.5) * width,
      y: (-this._v.y * 0.5 + 0.5) * height,
      visible: this._v.z < 1,
    };
  }

  setOpacity(v) {
    this._opacity = v;
    for (const it of this.items) {
      it.node.visible = v > 0.01;
      it.halo.material.opacity = (0.85 + it.hover * 0.9) * v;
      it.body.material.opacity = v;
      it.body.material.transparent = v < 1;
    }
    for (const ring of this.rings.values()) {
      ring.visible = v > 0.01;
      ring.material.opacity = 0.09 * v;
    }
  }

  dispose() {
    this.glow.dispose();
    for (const o of [this.group, this.lights]) {
      o.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) n.material.dispose();
      });
      o.parent?.remove(o);
    }
  }
}
