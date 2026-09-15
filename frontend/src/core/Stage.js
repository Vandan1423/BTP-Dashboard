/**
 * The shared WebGL stage.
 *
 * One renderer, one scene, one camera and one animation loop for the whole
 * dashboard. Pages add objects to `stage.scene` and register a per-frame
 * callback; they never create their own renderer or loop.
 *
 *   const stop = stage.onFrame((dt, elapsed) => { ... });
 *   stop();   // in unmount()
 *
 * `stage.pointerWorld` is the mouse projected onto the z = 0 plane, which is
 * where most of the scene lives, so pages can react to the cursor in world units.
 *
 * A page that needs a world of its own -- a 360 viewer, a VR scene -- can take
 * over what gets drawn without building a second renderer or a second loop:
 *
 *   const restore = stage.setView(myScene, myCamera);
 *   restore();   // in unmount()
 */
import * as THREE from 'three';
import { damp } from '../lib/math.js';

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x03050d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Headset support is switched on from the very first frame, not retrofitted.
    // Outside a session this changes nothing about how the scene draws; it only
    // means the renderer is willing to accept one when a session is requested.
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x03050d, 0.0125);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(0, 0, 16);

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.running = false;

    /** Mouse in normalised device coords, -1..1. */
    this.pointer = new THREE.Vector2(0, 0);
    /** Same, but smoothed -- use this for parallax so motion never jitters. */
    this.pointerSmooth = new THREE.Vector2(0, 0);
    /** Mouse projected onto the z = 0 plane, in world units. */
    this.pointerWorld = new THREE.Vector3();
    this.pointerActive = false;

    this._callbacks = new Set();
    /** Set by setView() when a page draws its own scene instead of the shared one. */
    this._view = null;
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._scratch = new THREE.Vector3();

    this._onResize = () => this.resize();
    this._onPointer = (e) => this._trackPointer(e);
    this._onLeave = () => { this.pointerActive = false; };
    this._onVisibility = () => {
      // Reset the clock on return so a backgrounded tab does not produce one
      // enormous dt that teleports every animation.
      if (!document.hidden) this.clock.getDelta();
    };

    window.addEventListener('resize', this._onResize);
    window.addEventListener('pointermove', this._onPointer, { passive: true });
    window.addEventListener('pointerdown', this._onPointer, { passive: true });
    document.addEventListener('pointerleave', this._onLeave);
    document.addEventListener('visibilitychange', this._onVisibility);

    this.resize();
  }

  _trackPointer(e) {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.pointerActive = true;
  }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, 2); }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    // Both cameras, because a page's own camera has to survive a resize too.
    // A custom render view owns its own cameras and their aspects, so it is
    // told about the resize and left to work them out itself.
    for (const cam of new Set([this.camera, this.activeCamera])) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this._view?.onResize?.(w, h);
  }

  /** Returns an unsubscribe function. Always call it in unmount(). */
  onFrame(fn) {
    this._callbacks.add(fn);
    return () => this._callbacks.delete(fn);
  }

  /**
   * Draw `scene` through `camera` instead of the shared scene, until restored.
   *
   * Sitting still inside a 360 sphere is the exact opposite of what the shared
   * camera does -- a project page flies it along the dust wave with pointer
   * parallax every frame -- so the viewer needs a world it fully controls. This
   * is how it gets one while the rule that matters is kept: still one renderer,
   * one scene graph traversal, one animation loop for the whole site.
   *
   * The frame callbacks all still run, so ambient work keeps ticking.
   *
   * A page that needs to draw more than once per frame -- a split screen, a
   * grid of viewports -- can pass a function instead, and take the renderer
   * over completely for the duration:
   *
   *   const restore = stage.setView((renderer) => {
   *     for (const pane of panes) {
   *       renderer.setViewport(...pane); renderer.setScissor(...pane);
   *       renderer.render(scene, pane.camera);
   *     }
   *   });
   *
   * Anything you switch on in there (scissor test, viewport) is yours to switch
   * off again before you return.
   *
   * @returns {() => void} restore. Always call it in unmount().
   */
  setView(scene, camera) {
    this._view = typeof scene === 'function'
      ? { render: scene }
      : { scene, camera };
    this.resize();
    const mine = this._view;
    return () => {
      if (this._view === mine) this.clearView();
    };
  }

  /** Go back to drawing the shared scene through the shared camera. */
  clearView() {
    this._view = null;
    this.resize();
  }

  /** The camera currently being drawn through -- a page's, or the shared one. */
  get activeCamera() { return this._view?.camera || this.camera; }

  /** Let a custom render view hear about resizes. */
  onViewResize(fn) { if (this._view) this._view.onResize = fn; }

  /** World-space height and width visible at a given depth. Handy for layout. */
  viewportAt(z = 0) {
    const dist = Math.abs(this.camera.position.z - z);
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * dist;
    return { height, width: height * this.camera.aspect };
  }

  /**
   * The loop goes through `renderer.setAnimationLoop`, not requestAnimationFrame.
   *
   * Outside a headset the two are the same thing. Inside one they are not:
   * a WebXR session drives its own frame callback at the headset's refresh
   * rate, and requestAnimationFrame simply stops being called. Using
   * setAnimationLoop from the start means entering VR is a session request and
   * nothing else -- no second loop, no rewrite.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => {
      if (!this.running) return;
      // Cap dt so a hitch cannot fling particles across the scene.
      this.step(Math.min(this.clock.getDelta(), 1 / 20));
    });
  }

  /**
   * Advance the scene by exactly `dt` seconds and render one frame.
   *
   * The animation loop calls this with the real frame delta. Tests and the
   * console can call it directly to step the scene deterministically, which is
   * the only way to inspect a specific moment when requestAnimationFrame is
   * throttled (a background tab, or a hidden preview pane).
   */
  step(dt) {
    this.elapsed += dt;

    this.pointerSmooth.x = damp(this.pointerSmooth.x, this.pointer.x, 6, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, this.pointer.y, 6, dt);
    this._raycaster.setFromCamera(this.pointer, this.camera);
    if (this._raycaster.ray.intersectPlane(this._plane, this._scratch)) {
      this.pointerWorld.copy(this._scratch);
    }

    for (const fn of this._callbacks) fn(dt, this.elapsed);

    const view = this._view;
    if (view?.render) view.render(this.renderer);
    else if (view) this.renderer.render(view.scene, view.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointer);
    window.removeEventListener('pointerdown', this._onPointer);
    document.removeEventListener('pointerleave', this._onLeave);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.renderer.dispose();
  }
}

/** Frees geometry and material for every descendant, then detaches the root. */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
  root.parent?.remove(root);
}
