/**
 * FOUR VIEWPOINTS, ONE TIMESTEP
 * =============================
 * The same instant of the same simulation, seen from Mercury, Venus, Earth and
 * Mars at once. Step a frame and all four move together, which is the only way
 * to see that the front reaches Mercury while Mars is still quiet.
 *
 * How it draws four 360 views without four renderers: one scene holds four
 * spheres, each assigned to its own render layer, and four cameras each set to
 * see only its own layer. The frame callback then draws the scene four times
 * through a scissored viewport per quadrant. The Stage hands the renderer over
 * for that, so it is still one WebGL context and one animation loop.
 *
 * It opens paused, because comparing frame by frame is what it is for.
 *
 * The panes read from 1024x512 proxies rather than the full renders. With four
 * streams the per-frame texture upload is what costs, not the drawing -- the
 * full-resolution version measured 22 to 38 ms a frame, well past the budget,
 * and dropping the canvas resolution did not help at all because pixels were
 * never the bottleneck. A pane is about 640 pixels wide, so the extra detail
 * had nowhere to go. See gridVideoUrl in lib/media.js.
 */
import * as THREE from 'three';
import { BODIES, gridVideoUrl } from '../../../lib/media.js';
import { LAST_FRAME, timeToFrame, frameToTime } from '../data/timing.js';
import { createSkySphere, videoTexture } from './sphereShader.js';
import { ViewerState } from './ViewerState.js';
import { LookControls } from './LookControls.js';
import { createControlPanel, ICONS } from './ControlPanel.js';
import { clamp } from '../../../lib/math.js';
import { loadEphemeris } from '../data/ephemeris.js';


/** Gutter between panes, in CSS pixels. The clear colour shows through it. */
const GUTTER = 10;
/** How far a pane may drift from the requested frame before it is nudged. */
const DRIFT_FRAMES = 3;

export class CompareGrid {
  /**
   * @param {object} [opts.initial]  frame, speed, playing, locked, and per-body
   *   looks -- whatever the section remembered from last time.
   */
  constructor({ stage, layer = 'cme', initial = {}, onExit }) {
    this.stage = stage;
    this.onExit = onExit;
    this._initial = initial;

    /* The one state every pane obeys: frame, playing, speed. Look direction is
       per pane, because unlocking it is the point of the lock toggle. */
    this.state = new ViewerState({
      layer,
      playing: !!initial.playing,
      frame: initial.frame ?? 0,
      speed: initial.speed ?? 1,
    });
    this.locked = initial.locked ?? true;

    this._size = new THREE.Vector2();
    this._buildDom();
    this.panesEl = this.element.querySelector('.cmp__panes');
    this._buildScene();

    this.restoreView = stage.setView((renderer) => this._render(renderer));
    stage.onViewResize(() => this._layout());
    this.stopFrame = stage.onFrame((dt) => this._frame(dt));

    this._unsubscribe = this.state.subscribe((s, changed) => this._onState(s, changed));
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);

    this._layout();
    // The AU figure is what makes the four panes mean something: the same
    // instant looks different because the planets are at different distances.
    loadEphemeris().then(({ byBody }) => this._setDistances(byBody)).catch(() => {});

    if (import.meta.env.DEV) window.__compare = this;
  }

  /* ================================================================== dom */

  _buildDom() {
    this.element = document.createElement('div');
    this.element.className = 'cmp';
    this.element.innerHTML = `
      <div class="cmp__panes">
        ${BODIES.map((b) => `
          <div class="cmp__pane" data-body="${b}">
            <div class="cmp__surface" tabindex="-1"></div>
            <div class="cmp__tag"><span class="cmp__dot" data-body="${b}"></span>${b}
              <span class="cmp__au"></span></div>
            <div class="cmp__load"><span class="cmp__spin"></span></div>
          </div>`).join('')}
      </div>`;

    this.panes = [...this.element.querySelectorAll('.cmp__pane')];

    // The same panel the single viewer uses, minus the viewpoint switcher --
    // all four viewpoints are already on screen -- plus a lock and a way out.
    this.panel = createControlPanel({
      state: this.state,
      extras: [
        { id: 'lock', label: this.locked ? 'Views locked' : 'Views free', dot: true, active: this.locked,
          onClick: () => this._toggleLock() },
        { id: 'exit', label: 'Exit compare', icon: ICONS.back,
          onClick: () => this.onExit?.() },
      ],
    });
    this.element.appendChild(this.panel.element);
  }

  _toggleLock() {
    this.locked = !this.locked;
    this.panel.setAction('lock', {
      active: this.locked,
      label: this.locked ? 'Views locked' : 'Views free',
    });
  }

  /* ================================================================ scene */

  _buildScene() {
    this.scene = new THREE.Scene();
    this.views = BODIES.map((body, i) => {
      // Layer i + 1: each camera sees only its own sphere, so one scene can
      // hold four completely different skies without them intersecting.
      const layerId = i + 1;

      const sky = createSkySphere();
      sky.mesh.layers.set(layerId);
      sky.uniforms.uFade.value = 1;
      this.scene.add(sky.mesh);

      const rig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
      camera.layers.set(layerId);
      rig.add(camera);
      this.scene.add(rig);

      const video = this._createVideo(body, i);
      const texture = videoTexture(video);
      sky.uniforms.uTexA.value = texture;
      sky.uniforms.uTexB.value = texture;

      const paneEl = this.panes[i];
      // Its own little state object: LookControls writes yaw, pitch and fov,
      // and four instances sharing one would overwrite each other.
      const saved = this._initial.looks?.[body];
      const look = new ViewerState({ yaw: saved?.yaw ?? 0, pitch: saved?.pitch ?? 0, fov: saved?.fov ?? 78 });
      const controls = new LookControls({
        surface: paneEl.querySelector('.cmp__surface'),
        rig, camera, state: look,
      });

      return { body, layerId, sky, rig, camera, video, texture, controls, paneEl,
               loadEl: paneEl.querySelector('.cmp__load'), ready: false,
               viewport: [0, 0, 1, 1] };
    });
  }

  _createVideo(body, i) {
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.loop = false;
    v.preload = 'auto';
    v.style.display = 'none';
    v.addEventListener('canplay', () => {
      const view = this.views?.[i];
      if (!view) return;
      view.ready = true;
      view.loadEl.classList.add('is-done');
      // The panel stays invisible until the state says ready, and only the
      // individual panes were tracking that -- so the controls never appeared.
      if (this.views.every((x) => x.ready)) this.state.patch({ ready: true });
      // Land on whatever timestep the grid is already showing.
      v.currentTime = frameToTime(this.state.value.frame);
      v.playbackRate = this.state.value.speed;
      if (this.state.value.playing) v.play().catch(() => {});
    });
    v.addEventListener('seeked', () => { this.views?.[i] && (this.views[i].texture.needsUpdate = true); });
    v.src = gridVideoUrl(body);
    v.load();
    return v;
  }

  /* =============================================================== layout */

  /**
   * Work out each pane's rectangle in renderer coordinates.
   *
   * Two things to get right. The renderer's origin is the BOTTOM left while the
   * DOM's is the top left, so the flip has to be against the renderer's own
   * height -- not `window.innerHeight`, which can still read zero on the frame
   * a page is being restored and would silently push every pane off-canvas.
   *
   * And it runs every frame rather than only on resize. It is one
   * getBoundingClientRect and it exits immediately when nothing has moved, but
   * it means the grid cannot get stuck at its starting size if it happens to be
   * measured before the browser has laid it out.
   */
  _layout() {
    const rect = this.panesEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const key = `${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
    if (key === this._layoutKey) return;
    this._layoutKey = key;

    this.stage.renderer.getSize(this._size);
    const canvasH = this._size.y;

    const w = (rect.width - GUTTER) / 2;
    const h = (rect.height - GUTTER) / 2;

    this.views.forEach((view, i) => {
      const col = i % 2;
      const row = (i / 2) | 0;
      const topPx = rect.top + row * (h + GUTTER);
      view.viewport = [
        rect.left + col * (w + GUTTER),
        canvasH - topPx - h,          // flip into renderer coordinates
        w, h,
      ];
      view.camera.aspect = w / h;
      view.camera.updateProjectionMatrix();
    });
  }

  _render(renderer) {
    renderer.setScissorTest(true);
    const full = this._size;
    for (const view of this.views) {
      const [x, y, w, h] = view.viewport;
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.render(this.scene, view.camera);
    }
    renderer.setScissorTest(false);
    // Hand the renderer back the way it was found; the next page to draw
    // assumes a full-canvas viewport.
    renderer.setViewport(0, 0, full.x, full.y);
  }

  /* ================================================================ state */

  _step(d) {
    this.state.patch({
      playing: false,
      frame: clamp(this.state.value.frame + d, 0, LAST_FRAME),
    });
  }

  _onState(s, changed) {
    if (changed.speed) {
      for (const view of this.views) view.video.playbackRate = s.speed;
    }

    if (changed.playing) {
      for (const view of this.views) {
        if (!view.ready) continue;
        if (s.playing) {
          if (view.video.ended) view.video.currentTime = 0;
          view.video.play().catch(() => {});
        } else {
          view.video.pause();
        }
      }
    }

    if (changed.frame) {
      // Same guard as the single viewer: only chase a frame a control asked
      // for, never one playback just reported, or the seek fights the decoder.
      if (!this._fromPlayback) {
        const t = frameToTime(s.frame);
        for (const view of this.views) {
          if (view.ready) view.video.currentTime = t;
        }
      }
    }
  }

  _key(e) {
    if (e.target?.matches?.('input, textarea, [contenteditable]')) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === ' ') { e.preventDefault(); this.state.patch({ playing: !this.state.value.playing }); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this._step(-step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this._step(step); }
    else if (e.key === 'l' || e.key === 'L') this._toggleLock();
  }

  /* ================================================================ frame */

  _frame(dt) {
    this._layout();
    this.panel.tick(dt);
    const presenting = this.stage.renderer.xr.isPresenting;

    // Whichever pane is being dragged leads; the others follow while locked.
    const leader = this.locked ? this.views.find((v) => v.controls.dragging) : null;
    for (const view of this.views) {
      if (leader && view !== leader) {
        view.controls.yaw = leader.controls.yaw;
        view.controls.pitch = leader.controls.pitch;
        view.controls.velYaw = leader.controls.velYaw;
        view.controls.velPitch = leader.controls.velPitch;
      }
      view.controls.update(dt, presenting);
    }

    // One pane is the clock. The others are nudged only when they fall behind,
    // because seeking a video that is merely a frame out costs more than the
    // error does.
    const lead = this.views.find((v) => v.ready);
    if (lead && this.state.value.playing) {
      const n = timeToFrame(lead.video.currentTime);
      this._fromPlayback = true;
      this.state.patch({ frame: n });
      this._fromPlayback = false;

      for (const view of this.views) {
        if (!view.ready || view === lead || view.video.seeking) continue;
        if (Math.abs(timeToFrame(view.video.currentTime) - n) > DRIFT_FRAMES) {
          view.video.currentTime = lead.video.currentTime;
        }
      }
    }

    if (import.meta.env.DEV) this._diagnostics(dt);
  }

  _diagnostics(dt) {
    this._acc = (this._acc || 0) + dt;
    this._ticks = (this._ticks || 0) + 1;
    if (this._acc < 1) return;
    const dropped = this.views.reduce(
      (n, v) => n + (v.video.getVideoPlaybackQuality?.()?.droppedVideoFrames || 0), 0);
    this.panel.setDiagnostics(
      `${(this._ticks / this._acc).toFixed(0)} fps · 4 streams · ${dropped} dropped`);
    this._acc = 0;
    this._ticks = 0;
  }

  _setDistances(byBody) {
    if (!this.views) return;
    for (const view of this.views) {
      const p = byBody?.[view.body]?.[this.state.value.frame] ?? byBody?.[view.body]?.[0];
      if (p) view.paneEl.querySelector('.cmp__au').textContent = `${p.r.toFixed(2)} AU`;
    }
  }

  /* ============================================================= teardown */

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    this.stopFrame?.();
    this.restoreView?.();
    this._unsubscribe?.();
    this.panel.destroy();

    for (const view of this.views) {
      view.controls.destroy();
      view.video.pause();
      view.video.removeAttribute('src');
      view.video.load();
      view.texture.dispose();
      view.sky.geometry.dispose();
      view.sky.material.dispose();
      this.scene.remove(view.sky.mesh, view.rig);
    }
    this.views = null;
    this.element.remove();
  }
}
