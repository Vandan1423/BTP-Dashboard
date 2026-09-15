/**
 * LOOKING AROUND
 * ==============
 * Drag to turn, release and it keeps drifting, wheel or pinch to zoom.
 *
 * Two decisions in here are worth knowing about.
 *
 * The first is that a drag is measured in pixels and converted to an angle
 * using the CURRENT field of view. Drag an inch across the screen and the thing
 * under your finger travels an inch, whether you are zoomed all the way in or
 * all the way out. Use a fixed radians-per-pixel instead and zooming in makes
 * the view feel like it is skidding.
 *
 * The second is that yaw and pitch are applied to two different objects. Yaw
 * turns a rig, and the camera is parented to that rig. Pitch tilts the camera
 * itself. That split is entirely about the headset: inside a WebXR session
 * three.js overwrites the camera's own position and rotation from the head
 * pose every frame, so anything written there is discarded -- but the rig is
 * left alone, so turning still works. Pitch is simply switched off in a
 * session, because tilting the horizon under someone wearing a headset is both
 * useless (they can look up themselves) and a reliable way to make them ill.
 */
import * as THREE from 'three';
import { clamp, damp } from '../../../lib/math.js';

const PITCH_LIMIT = Math.PI / 2 - 0.02;   // just short of the poles
const FOV_MIN = 30;
const FOV_MAX = 100;
const DRIFT_DECAY = 3.4;                  // how fast a flick runs out, per second
const IDLE_DRIFT = 0.006;                 // slow automatic turn when untouched

export class LookControls {
  /**
   * @param {object}  opts
   * @param {HTMLElement} opts.surface    element that receives the drags
   * @param {THREE.Object3D} opts.rig     yaw goes here
   * @param {THREE.PerspectiveCamera} opts.camera  pitch and fov go here
   * @param {import('./ViewerState.js').ViewerState} opts.state
   */
  constructor({ surface, rig, camera, state }) {
    this.surface = surface;
    this.rig = rig;
    this.camera = camera;
    this.state = state;

    this.yaw = state.value.yaw;
    this.pitch = state.value.pitch;
    this.fov = state.value.fov;
    this.targetFov = this.fov;

    this.velYaw = 0;
    this.velPitch = 0;
    this.dragging = false;
    this.everDragged = false;
    this.enabled = true;

    /** Active touches, so a two-finger pinch can be told from a one-finger drag. */
    this._points = new Map();
    this._pinchStart = 0;
    this._fovAtPinch = this.fov;
    this._last = { x: 0, y: 0, t: 0 };

    this._bind();
  }

  _bind() {
    const s = this.surface;
    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    this._onWheel = (e) => this._wheel(e);

    s.addEventListener('pointerdown', this._onDown);
    s.addEventListener('pointermove', this._onMove);
    s.addEventListener('pointerup', this._onUp);
    s.addEventListener('pointercancel', this._onUp);
    s.addEventListener('pointerleave', this._onUp);
    s.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /** Radians per pixel at the current zoom. */
  get _perPixel() {
    const h = this.surface.clientHeight || window.innerHeight;
    return THREE.MathUtils.degToRad(this.fov) / h;
  }

  _down(e) {
    if (!this.enabled) return;
    this.surface.setPointerCapture?.(e.pointerId);
    this._points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._points.size === 2) {
      this._pinchStart = this._pinchDistance();
      this._fovAtPinch = this.targetFov;
      this.dragging = false;
      return;
    }
    this.dragging = true;
    this.velYaw = this.velPitch = 0;
    this._last = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.surface.classList.add('is-grabbing');
  }

  _move(e) {
    if (!this._points.has(e.pointerId)) return;
    this._points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._points.size === 2) {
      const d = this._pinchDistance();
      if (this._pinchStart > 0) {
        this.targetFov = clamp(this._fovAtPinch * (this._pinchStart / d), FOV_MIN, FOV_MAX);
      }
      return;
    }
    if (!this.dragging) return;

    const dx = e.clientX - this._last.x;
    const dy = e.clientY - this._last.y;
    const k = this._perPixel;

    // Drag right and the sky travels right with your hand, which means you are
    // turning left. Same for dragging down and looking up.
    this.yaw += dx * k;
    this.pitch = clamp(this.pitch + dy * k, -PITCH_LIMIT, PITCH_LIMIT);

    const now = performance.now();
    const dt = Math.max(1, now - this._last.t) / 1000;
    // Blended so one jittery sample cannot fling the view on release.
    this.velYaw = this.velYaw * 0.6 + (dx * k / dt) * 0.4;
    this.velPitch = this.velPitch * 0.6 + (dy * k / dt) * 0.4;

    this._last = { x: e.clientX, y: e.clientY, t: now };
    this.everDragged = true;
  }

  _up(e) {
    this._points.delete(e.pointerId);
    if (this._points.size < 2) this._pinchStart = 0;
    if (this._points.size === 0) {
      this.dragging = false;
      this.surface.classList.remove('is-grabbing');
    }
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.targetFov = clamp(this.targetFov + e.deltaY * 0.05, FOV_MIN, FOV_MAX);
  }

  _pinchDistance() {
    const [a, b] = [...this._points.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  /** Point the view at a bearing, smoothly. Used by the tour in a later phase. */
  lookAt(yaw, pitch = 0) {
    this.targetYaw = yaw;
    this.targetPitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  update(dt, presenting = false) {
    if (!this.dragging) {
      // Carry the flick, then decay it. Once it is spent, an almost
      // imperceptible drift keeps the scene from ever looking frozen.
      this.yaw += this.velYaw * dt;
      this.pitch = clamp(this.pitch + this.velPitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
      const decay = Math.exp(-DRIFT_DECAY * dt);
      this.velYaw *= decay;
      this.velPitch *= decay;

      if (Math.abs(this.velYaw) < 0.002 && !presenting) this.yaw += IDLE_DRIFT * dt;

      if (this.targetYaw !== undefined) {
        this.yaw = damp(this.yaw, this.targetYaw, 3, dt);
        this.pitch = damp(this.pitch, this.targetPitch, 3, dt);
        if (Math.abs(this.yaw - this.targetYaw) < 0.002) this.targetYaw = undefined;
      }
    }

    this.fov = damp(this.fov, this.targetFov, 9, dt);

    this.rig.rotation.y = this.yaw;
    if (!presenting) {
      // Skipped in a headset: three.js is writing the camera's rotation from
      // the head pose, and the wearer's own neck does this job better.
      this.camera.rotation.x = this.pitch;
      if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    this.state.patch({
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      fov: Math.round(this.fov * 10) / 10,
    });
  }

  destroy() {
    const s = this.surface;
    s.removeEventListener('pointerdown', this._onDown);
    s.removeEventListener('pointermove', this._onMove);
    s.removeEventListener('pointerup', this._onUp);
    s.removeEventListener('pointercancel', this._onUp);
    s.removeEventListener('pointerleave', this._onUp);
    s.removeEventListener('wheel', this._onWheel);
    this._points.clear();
  }
}
