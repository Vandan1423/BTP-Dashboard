/**
 * THE 360 VIEWER
 * ==============
 * Puts you inside one of the renders. The video is wrapped onto the inside of a
 * sphere, you sit at its centre, and dragging turns your head.
 *
 * This is not a stylistic choice. `scripts/scene/BuildSpaceScene.py` sets every
 * Blender camera to PANO / EQUIRECTANGULAR, so each frame is the entire sphere
 * of directions around one planet flattened into a 4096x2048 rectangle. Play it
 * in an ordinary video tag and it looks broken. The sphere is what makes the
 * asset legible, and it is the same asset the Unity VR build uses.
 *
 * Everything it owns:
 *   - its own scene and camera, borrowed from the Stage via setView
 *   - a rig holding the camera, so a headset can take over the pose later
 *   - one video element, one texture, one sphere
 *   - a ViewerState that the overlay reads, and the overlay itself
 *
 * All of it comes back in destroy(). A detached video element carries on
 * decoding, which on a 4096x2048 stream is expensive and invisible.
 */
import * as THREE from 'three';
import { Timeline } from '../../../lib/tween.js';
import { easeOutCubic } from '../../../lib/math.js';
import { videoUrl, LAYERS, BODIES } from '../../../lib/media.js';
import { timeToFrame, frameToTime, LAST_FRAME } from '../data/timing.js';
import { createSkySphere, videoTexture } from './sphereShader.js';
import { ViewerState } from './ViewerState.js';
import { LookControls } from './LookControls.js';
import { createControlPanel, ICONS } from './ControlPanel.js';
import './viewer.css';

/** Field of view the entrance opens out from, and settles at. */
const FOV_START = 24;
const FOV_REST = 70;

export class Viewer360 {
  /**
   * @param {object} [opts.initial]  where to resume: frame, speed, playing,
   *   yaw, pitch, fov. The section passes back what it last saw.
   */
  constructor({ stage, body = 'Earth', layer = 'cme', initial = {}, onBackToMap, onCompare }) {
    this.stage = stage;
    this.onBackToMap = onBackToMap;
    this.onCompare = onCompare;
    const { fov: restFov, ...resume } = initial;
    this.state = new ViewerState({ body, layer, playing: true, ...resume });
    this._restFov = restFov || FOV_REST;
    // Seeking before the video has loaded is discarded when the source is
    // set, so the timestep to resume at is held until it can play.
    this._resumeFrame = resume.frame > 0 ? resume.frame : null;
    this.tl = new Timeline();

    /* ------------------------------------------------------------ markup */
    this.element = document.createElement('div');
    this.element.className = 'v360';
    this.element.innerHTML = `
      <div class="v360__surface" tabindex="-1"></div>
      <div class="v360__status">
        <span class="v360__spinner"></span>
        <span class="v360__status-text">Loading the render</span>
      </div>`;
    this.surface = this.element.querySelector('.v360__surface');
    this.statusEl = this.element.querySelector('.v360__status');
    this.statusText = this.element.querySelector('.v360__status-text');

    /* The prompt that teaches the one thing that is not obvious: this is a
       sphere and you are inside it. It goes for good on the first drag. */
    this.hint = document.createElement('div');
    this.hint.className = 'v360__hint';
    this.hint.innerHTML = `<span class="v360__hint-ring"></span>Drag to look around`;

    this.corner = document.createElement('div');
    this.corner.className = 'v360__corner';
    this.corner.innerHTML = `<span class="v360__layer"></span>`;

    this.panel = createControlPanel({
      state: this.state,
      viewpoints: true,
      extras: [
        { id: 'compare', label: 'Compare', icon: ICONS.grid, onClick: () => onCompare?.() },
        { id: 'back', label: 'Back', icon: ICONS.back, onClick: () => onBackToMap?.() },
      ],
    });
    this.element.append(this.hint, this.corner, this.panel.element);
    this._layerEl = this.corner.querySelector('.v360__layer');

    /* ------------------------------------------------------------- scene */
    this.scene = new THREE.Scene();

    // The camera hangs off a rig rather than standing alone. In a WebXR
    // session three.js writes the camera's own transform from the headset every
    // frame, so the rig is the only place an application-controlled rotation
    // survives.
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(FOV_START, 1, 0.1, 1000);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    const sky = createSkySphere();
    this.sky = sky;
    this.scene.add(sky.mesh);

    /* ------------------------------------------------------------- video */
    this.video = this._createVideo();
    this.texture = videoTexture(this.video);
    sky.uniforms.uTexA.value = this.texture;
    sky.uniforms.uTexB.value = this.texture;   // phase 3 swaps in the second set

    this.controls = new LookControls({
      surface: this.surface,
      rig: this.rig,
      camera: this.camera,
      state: this.state,
    });

    /* ------------------------------------------------------- state wiring */
    this._unsubscribe = this.state.subscribe((s, changed) => this._onState(s, changed));

    this.restoreView = stage.setView(this.scene, this.camera);
    this.stopFrame = stage.onFrame((dt) => this._frame(dt));

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);

    this._loadSource();

    // Same idea as window.__stage: a handle to poke at from the console.
    if (import.meta.env.DEV) window.__viewer = this;
  }

  /* ================================================================ video */

  _createVideo() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;              // required, or the browser refuses to autoplay
    v.loop = false;   // the run ends; see the 'ended' handler below
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    // Never in the document. It exists only to feed a texture, and an offscreen
    // element still decodes perfectly well.
    v.style.display = 'none';

    v.addEventListener('canplay', () => {
      this.state.patch({ ready: true, buffering: false });
      // Dismissing the pill belongs here rather than in _openUp: the entrance
      // plays only once, but the pill comes back on every source change.
      this.statusEl.classList.add('is-done');
      if (this._resumeFrame != null) {
        v.currentTime = frameToTime(this._resumeFrame);
        this._resumeFrame = null;
      }
      // load() resets playbackRate to 1, so a speed chosen before the source
      // changed -- or restored from memory -- has to be applied again here.
      v.playbackRate = this.state.value.speed;
      this._openUp();
      if (this.state.value.playing) this._play();
    });
    v.addEventListener('waiting', () => this.state.patch({ buffering: true }));
    v.addEventListener('playing', () => this.state.patch({ buffering: false }));
    // A seek while paused presents no new video frame, so the callback below
    // never runs and the readout would sit on the frame we jumped away from.
    // This is the path the scrubber will land on, so it has to be right.
    v.addEventListener('seeked', () => {
      this.texture.needsUpdate = true;
      this._reportFrame(timeToFrame(v.currentTime));
    });
    // The simulation has a last timestep. Looping back to a quiet Sun without
    // being asked reads as the viewer resetting itself, so it stops and holds
    // on the final frame; pressing play again starts the run over.
    v.addEventListener('ended', () => {
      this.state.patch({ playing: false });
      this._reportFrame(LAST_FRAME);
    });
    v.addEventListener('error', () => {
      const url = videoUrl(this.state.value.body, this.state.value.layer);
      this.state.patch({ error: `Could not load ${url}`, playing: false });
      this.statusText.textContent = 'Render not found. Is the media folder mounted?';
      this.statusEl.classList.add('is-error');
    });

    // The exact frame the compositor is showing, straight from the decoder.
    // `currentTime` is only approximate, and phase two's scrubber and the
    // frame-accurate compare both depend on this being right.
    //
    // It is a refinement, not the only source -- see _frame(), which syncs from
    // `currentTime` every tick regardless. This callback stops firing whenever
    // the page is not being painted, and on its own that left the clock reading
    // frame 0 while the video was audibly playing.
    if ('requestVideoFrameCallback' in v) {
      const onFrame = (_now, meta) => {
        this._reportFrame(timeToFrame(meta.mediaTime));
        this._rvfc = v.requestVideoFrameCallback(onFrame);
      };
      this._rvfc = v.requestVideoFrameCallback(onFrame);
    }
    return v;
  }

  /**
   * Report where playback has got to, without that being read as a request to
   * go there.
   *
   * This distinction is the whole point. Both the video's frame callback and
   * the render loop write the current position into state, and _onState seeks
   * whenever the frame changes. Comparing timestamps and allowing a tolerance
   * looked like enough and was not: at 2x and 4x the video moves more than a
   * frame between ticks, so the two sources disagree by more than any sensible
   * tolerance, _onState seeks backwards to a position playback had already
   * passed, the seek stalls the decoder, and the next report is older still.
   * That loop is self-sustaining, and it is what pinned the video for the rest
   * of the timeline.
   *
   * A flag set across one synchronous patch cannot drift the way a tolerance
   * can. Subscribers run synchronously inside patch(), so _onState always sees
   * the correct value.
   */
  _reportFrame(n) {
    this._fromPlayback = true;
    this.state.patch({ frame: n });
    this._fromPlayback = false;
  }

  _loadSource() {
    const { body, layer } = this.state.value;
    this.statusEl.classList.remove('is-error', 'is-done');
    this.statusText.textContent = `Loading ${LAYERS[layer].label} · ${body}`;
    this.state.patch({ ready: false, buffering: true, error: null });
    this.video.src = videoUrl(body, layer);
    this.video.load();
  }

  async _play() {
    try {
      // Pressing play while parked on the last timestep starts the run again,
      // rather than doing nothing because the video is already at its end.
      if (this.video.ended || this.state.value.frame >= LAST_FRAME) {
        this.video.currentTime = 0;
      }
      await this.video.play();
    } catch {
      // Autoplay was refused. Not an error worth shouting about -- the play
      // button is right there, and pressing it counts as the interaction the
      // browser was waiting for.
      this.state.patch({ playing: false });
    }
  }

  /**
   * Keyboard.
   *
   * Escape is deliberately not bound. The page shell already uses it to leave
   * the project entirely, and two listeners on window would both fire -- you
   * would ask for the map and get thrown back to the mission select.
   */
  _key(e) {
    // Optional chaining because the target is not always an element -- a key
    // press with nothing focused arrives with `window` as the target, and
    // `window.matches` does not exist. Calling it unguarded threw and took
    // every shortcut down with it.
    if (e.target?.matches?.('input, textarea, [contenteditable]')) return;
    const n = this.state.value.frame;
    const step = e.shiftKey ? 10 : 1;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.state.patch({ playing: !this.state.value.playing });
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.state.patch({ playing: false, frame: Math.max(0, n - step) });
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.state.patch({ playing: false, frame: Math.min(LAST_FRAME, n + step) });
        break;
      case 'm': case 'M':
        this.onBackToMap?.();
        break;
      case 'c': case 'C':
        this.onCompare?.();
        break;
      default:
        // 1-4 jump straight to a viewpoint, in orbital order.
        if (e.key >= '1' && e.key <= '4') this.state.patch({ body: BODIES[+e.key - 1] });
    }
  }

  /* ================================================================ state */

  _onState(s, changed) {
    if (changed.layer) this._layerEl.textContent = LAYERS[s.layer].label;
    if (changed.body || changed.layer) this._loadSource();

    if (changed.playing) {
      if (s.playing) this._play();
      else this.video.pause();
    }
    if (changed.speed) this.video.playbackRate = s.speed;

    // Only seek for frame changes a control asked for. A report from playback
    // is describing where the video already is -- see _reportFrame.
    if (changed.frame && !this._fromPlayback) {
      this.video.currentTime = frameToTime(s.frame);
    }
  }

  /** The arrival: the veil lifts and the view opens out from a narrow lens. */
  _openUp() {
    if (this._opened) return;
    this._opened = true;

    this.tl.add({
      from: 0, to: 1, dur: 0.9, ease: easeOutCubic,
      onUpdate: (v) => { this.sky.uniforms.uFade.value = v; },
    });
    this.tl.add({
      from: FOV_START, to: this._restFov, dur: 1.5, ease: easeOutCubic,
      onUpdate: (v) => {
        this.controls.fov = this.controls.targetFov = v;
        this.camera.fov = v;
        this.camera.updateProjectionMatrix();
      },
    });
  }

  /* ================================================================ frame */

  _frame(dt) {
    this.tl.update(dt);
    this.controls.update(dt, this.stage.renderer.xr.isPresenting);

    this.panel.tick(dt);

    if (this.controls.everDragged && !this._hintGone) {
      this._hintGone = true;
      this.hint.classList.add('is-gone');
    }

    // The floor of the readout. requestVideoFrameCallback is more exact when it
    // runs, but it is silent whenever the page is not painting, so relying on
    // it alone lets the clock drift away from what the video is really doing.
    // Both write the same integer, and ViewerState.patch ignores a no-op.
    // Not while a seek is in flight: currentTime still reads the old position,
    // and writing that back would cancel the jump the scrubber just asked for.
    if (this.state.value.ready && !this.video.seeking) {
      this._reportFrame(timeToFrame(this.video.currentTime));
    }

    if (import.meta.env.DEV) this._diagnostics(dt);
  }

  /**
   * Is a 4096x2048 texture upload every frame actually affordable?
   *
   * Thirty-three megabytes per frame is not a small ask, and the honest answer
   * is a measurement rather than an opinion. If this settles well under sixty,
   * or dropped frames climb, the fix is a one-off ffmpeg pass to 2048x1024 and
   * a changed URL in lib/media.js -- nothing else moves.
   */
  _diagnostics(dt) {
    this._acc = (this._acc || 0) + dt;
    this._ticks = (this._ticks || 0) + 1;
    if (this._acc < 1) return;

    const fps = this._ticks / this._acc;
    const q = this.video.getVideoPlaybackQuality?.();
    const dropped = q ? q.droppedVideoFrames : 0;
    this.panel.setDiagnostics(
      `${fps.toFixed(0)} fps · ${this.video.videoWidth}x${this.video.videoHeight} · ${dropped} dropped`,
    );
    this._acc = 0;
    this._ticks = 0;
  }

  /* ============================================================== teardown */

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    this.stopFrame?.();
    this.restoreView?.();
    this._unsubscribe?.();

    if (this._rvfc && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this._rvfc);
    }
    // Pausing is not enough. Clearing the source and reloading is what makes
    // the browser actually let go of the decoder.
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();

    this.controls.destroy();
    this.panel.destroy();
    this.hint.remove();
    this.corner.remove();
    this.state.destroy();
    this.tl.clear();

    this.texture.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.scene.remove(this.sky.mesh);

    this.element.remove();
  }
}
