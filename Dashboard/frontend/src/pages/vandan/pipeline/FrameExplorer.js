/**
 * LOOKING AT WHAT CAME BACK
 * =========================
 * Every frame a job returns is a full 360 sphere, and there are two ways to
 * look at them, with no seam between the two:
 *
 *   single   one viewpoint fills the screen; switch between them with the tabs
 *   compare  all of them side by side, turning together, like the four-up grid
 *            in the 360 viewer -- drag any pane and every pane follows
 *
 * How the switch is seamless: every pane always exists, with a rectangle and a
 * fade. Changing mode only changes where each rectangle is heading. In single
 * mode the focused pane is heading for the whole screen and the rest are
 * heading for their grid cells at zero opacity; in compare mode every pane is
 * heading for its cell. The rectangles are eased toward those targets every
 * frame, so the focused view visibly shrinks into its place in the grid while
 * the others fade up around it, and clicking a pane grows it back out. Change
 * your mind halfway and it simply turns round.
 *
 * One renderer draws all of it: each sphere is on its own render layer, and the
 * scene is drawn once per pane through a scissored viewport -- the same
 * technique CompareGrid uses, borrowed through PipelineScene.takeView.
 *
 * Textures arrive in three steps so nothing ever waits on a blank pane: a 7 KB
 * thumbnail at once, a 250 KB 2048x1024 still behind it, and the full 8.7 MB
 * render only for a single view that has been looked at for a moment.
 */
import * as THREE from 'three';
import { createSkySphere } from '../viewer/sphereShader.js';
import { LookControls } from '../viewer/LookControls.js';
import { ViewerState } from '../viewer/ViewerState.js';
import { damp, clamp } from '../../../lib/math.js';
import { utcLabel } from '../data/timing.js';
import { BODY_COLOR } from './Heliosphere.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

const ICON_SINGLE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.6"/></svg>`;
const ICON_GRID = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.3" y="2.8" width="5" height="4.4" rx="1"/><rect x="8.7" y="2.8" width="5" height="4.4" rx="1"/><rect x="2.3" y="8.8" width="5" height="4.4" rx="1"/><rect x="8.7" y="8.8" width="5" height="4.4" rx="1"/></svg>`;
const ICON_DL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.8 7.4 8 10.6l3.2-3.2M3 13.3h10"/></svg>`;
const ICON_X = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.8h3.7v3.7M13.2 2.8 9 7M6.5 13.2H2.8V9.5M2.8 13.2 7 9"/></svg>`;

/** Gutter between panes, in CSS pixels. */
const GUTTER = 10;
/** How quickly rectangles and fades chase their targets, per second. */
const RECT_SPEED = 7.5;
/** Seconds a single view is held before the full render is fetched. */
const FULL_AFTER = 0.7;

export class FrameExplorer {
  /**
   * @param {object} opts
   * @param {Array<{ body, url, still?, thumb?, seconds? }>} opts.viewpoints
   * @param {number|null} opts.index           the VTK index, for the date
   * @param {'single'|'compare'} opts.mode
   * @param {string} opts.body                 the focused viewpoint
   * @param {Record<string, DOMRect>} [opts.origins]  where each pane grows from
   * @param {Record<string, {r:number}>} [opts.distances]
   */
  constructor({ stage, host, viewpoints, index, mode = 'single', body, origins = {}, distances = {}, onChange, onRequestClose, onClose }) {
    this.stage = stage;
    this.host = host;
    this.onChange = onChange;
    this.onRequestClose = onRequestClose;
    this.onClose = onClose;
    this.index = index;
    this.mode = viewpoints.length > 1 ? mode : 'single';
    this.focus = viewpoints.some((v) => v.body === body) ? body : viewpoints[0].body;
    this.compareness = this.mode === 'compare' ? 1 : 0;
    this.closing = false;
    this._size = new THREE.Vector2();
    this._held = 0;

    this.look = new ViewerState({ yaw: 0, pitch: 0, fov: 72 });

    this._buildDom(viewpoints, distances);
    this._buildScene(viewpoints, origins);

    this.controls = new LookControls({
      surface: this.surface, rig: this.rig, camera: this.camera, state: this.look,
    });
    this.controls.fov = this.controls.targetFov = 72;

    this.release = host.takeView((renderer) => this._render(renderer));
    this.stopFrame = stage.onFrame((dt) => this._frame(dt));

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);

    // Start every pane at its origin, then aim it at its first target.
    this._layout(true);
    for (const p of this.panes) this._load(p, 'thumb').then(() => this._load(p, 'still'));
    this._paintBar();
    if (import.meta.env.DEV) window.__explorer = this;
  }

  /* ================================================================== dom */

  _buildDom(viewpoints, distances) {
    const date = this.index != null ? utcLabel(this.index) : 'rendered frame';
    this.element = document.createElement('div');
    this.element.className = 'pfx';
    this.element.innerHTML = `
      <div class="pfx__surface" tabindex="-1"></div>
      <div class="pfx__panes"></div>

      <div class="pfx__bar">
        <div class="pfx__modes" data-mode="${this.mode}">
          <span class="pfx__pill" aria-hidden="true"></span>
          <button type="button" data-mode="single">${ICON_SINGLE}<span>Single</span></button>
          <button type="button" data-mode="compare" ${viewpoints.length < 2 ? 'disabled' : ''}>${ICON_GRID}<span>Compare</span></button>
        </div>

        <div class="pfx__tabs">
          ${viewpoints.map((v, i) => `
            <button type="button" data-body="${v.body}" style="--vp:${hex(BODY_COLOR[v.body])}"
                    title="${v.body} · key ${i + 1}">
              <i></i><span>${v.body}</span>
            </button>`).join('')}
        </div>

        <span class="pfx__sep"></span>
        <span class="pfx__when">${date}</span>
        <span class="pfx__res" data-res></span>

        <a class="pfx__icon pfx__dl" data-dl download aria-label="Download full-resolution PNG" title="Download PNG">${ICON_DL}</a>
        <button class="pfx__icon pfx__close" type="button" aria-label="Close" title="Close">${ICON_X}</button>
      </div>

      <div class="pfx__hint"><span></span>Drag to look around · scroll to zoom</div>`;

    this.surface = this.element.querySelector('.pfx__surface');
    this.panesEl = this.element.querySelector('.pfx__panes');
    this.modesEl = this.element.querySelector('.pfx__modes');
    this.tabsEl = this.element.querySelector('.pfx__tabs');
    this.resEl = this.element.querySelector('[data-res]');
    this.dlEl = this.element.querySelector('[data-dl]');
    this.hintEl = this.element.querySelector('.pfx__hint');

    this._onBar = (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn && modeBtn.tagName === 'BUTTON' && !modeBtn.disabled) {
        this.setMode(modeBtn.dataset.mode);
        return;
      }
      const tab = e.target.closest('[data-body]');
      if (tab) { this.setMode('single', tab.dataset.body); return; }
      // The owner decides how to close, because only it knows where the cards
      // are to shrink back into.
      if (e.target.closest('.pfx__close')) (this.onRequestClose ?? (() => this.close()))();
    };
    this.element.querySelector('.pfx__bar').addEventListener('click', this._onBar);

    // A click that did not turn into a drag picks the pane under it.
    this._onPress = (e) => { this._press = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    this._onRelease = (e) => {
      const p = this._press;
      this._press = null;
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5 || performance.now() - p.t > 450) return;
      if (this.mode !== 'compare') return;
      const hit = this.panes.find((pane) => {
        const r = pane.rect;
        return e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
      });
      if (hit) this.setMode('single', hit.body);
    };
    this.surface.addEventListener('pointerdown', this._onPress);
    this.surface.addEventListener('pointerup', this._onRelease);

    this._distances = distances;
  }

  /* ================================================================ scene */

  _buildScene(viewpoints, origins) {
    this.scene = new THREE.Scene();
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.panes = viewpoints.map((v, i) => {
      const layer = i + 1;
      const sky = createSkySphere();
      sky.mesh.layers.set(layer);
      this.scene.add(sky.mesh);

      const el = document.createElement('div');
      el.className = 'pfx__pane';
      el.style.setProperty('--vp', hex(BODY_COLOR[v.body]));
      const au = this._distances?.[v.body];
      el.innerHTML = `
        <span class="pfx__tag"><i></i>${v.body}${au ? `<em>${au.r.toFixed(2)} AU</em>` : ''}</span>
        <span class="pfx__expand">${ICON_EXPAND}</span>
        <span class="pfx__load"><b></b></span>`;
      this.panesEl.appendChild(el);

      const o = origins[v.body];
      return {
        ...v,
        layer, sky, el,
        loadEl: el.querySelector('.pfx__load'),
        origin: o ? { x: o.left, y: o.top, w: o.width, h: o.height } : null,
        rect: { x: 0, y: 0, w: 0, h: 0 },
        target: { x: 0, y: 0, w: 0, h: 0 },
        fade: 0, fadeTarget: 0,
        level: null, texture: null, pending: null,
      };
    });
  }

  /* ============================================================ textures */

  /**
   * Swap a pane to a sharper texture. Levels only ever go up; a request for
   * one the pane already has, or has in flight, is ignored.
   */
  _load(pane, level) {
    const rank = { thumb: 0, still: 1, full: 2 };
    const url = level === 'thumb' ? pane.thumb : level === 'still' ? pane.still : pane.url;
    if (!url) return Promise.resolve();
    if (pane.level && rank[pane.level] >= rank[level]) return Promise.resolve();
    if (pane.pending === level) return pane.pendingPromise;

    pane.pending = level;
    if (level === 'full') this.element.classList.add('is-fetching');

    pane.pendingPromise = loadTexture(url).then((tex) => {
      if (!this.panes) { tex.dispose(); return; }        // closed meanwhile
      if (pane.level && rank[pane.level] >= rank[level]) { tex.dispose(); return; }
      const old = pane.texture;
      pane.texture = tex;
      pane.level = level;
      pane.sky.uniforms.uTexA.value = tex;
      pane.sky.uniforms.uTexB.value = tex;
      pane.loadEl.classList.add('is-done');
      old?.dispose();
      this._paintBar();
    }).catch(() => {
      // A missing still is not fatal: the thumbnail carries on, and the full
      // render is tried directly.
      if (level === 'still') return this._load(pane, 'full');
    }).finally(() => {
      if (pane.pending === level) pane.pending = null;
      if (level === 'full') this.element.classList.remove('is-fetching');
    });
    return pane.pendingPromise;
  }

  /** Fill in the distance on each pane's tag once the ephemeris has loaded. */
  setDistances(byBody, index) {
    for (const p of this.panes ?? []) {
      const pos = byBody?.[p.body]?.[index];
      const tag = p.el.querySelector('.pfx__tag');
      if (!pos || tag.querySelector('em')) continue;
      const em = document.createElement('em');
      em.textContent = `${pos.r.toFixed(2)} AU`;
      tag.appendChild(em);
    }
  }

  /* =============================================================== modes */

  /**
   * @param {'single'|'compare'} mode
   * @param {string} [body] focus this viewpoint
   */
  setMode(mode, body) {
    if (mode === 'compare' && this.panes.length < 2) mode = 'single';
    const changed = mode !== this.mode || (body && body !== this.focus);
    this.mode = mode;
    if (body) this.focus = body;
    this._held = 0;
    this._paintBar();
    if (changed) this.onChange?.({ mode: this.mode, body: this.focus });
  }

  _paintBar() {
    this.modesEl.dataset.mode = this.mode;
    this.element.dataset.mode = this.mode;
    for (const b of this.tabsEl.querySelectorAll('button')) {
      b.classList.toggle('is-on', this.mode === 'single' && b.dataset.body === this.focus);
    }
    const pane = this.panes?.find((p) => p.body === this.focus);
    if (pane) {
      this.dlEl.href = pane.url;
      this.dlEl.setAttribute('download', pane.url.split('/').slice(-2).join('_'));
      const label = { thumb: '512 px', still: '2048 px', full: '4096 px' }[pane.level] ?? '';
      this.resEl.textContent = this.mode === 'single' ? label : `${this.panes.length} views`;
    }
  }

  _key(e) {
    if (e.target?.matches?.('input, textarea, [contenteditable]')) return;
    // Escape is deliberately not bound: the page shell uses it to leave the
    // project, and both listeners would fire.
    if (e.key === 'c' || e.key === 'C') {
      this.setMode(this.mode === 'compare' ? 'single' : 'compare');
    } else if (e.key >= '1' && e.key <= '9') {
      const p = this.panes[+e.key - 1];
      if (p) this.setMode('single', p.body);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (this.mode !== 'single') return;
      const i = this.panes.findIndex((p) => p.body === this.focus);
      const n = this.panes.length;
      const next = this.panes[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n];
      this.setMode('single', next.body);
    }
  }

  /* ============================================================== layout */

  /** Grid cells for compare mode, clear of the top bar and the bottom row. */
  _cells(W, H) {
    const n = this.panes.length;
    const narrow = W < 820;
    let cols = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 2;
    if (narrow) cols = n === 4 ? 2 : 1;
    const rows = Math.ceil(n / cols);

    const left = clamp(W * 0.014, 10, 22);
    // Clear of the top bar, and of the explorer's own bar and the dock below.
    const top = narrow ? 76 : 86;
    const bottom = H - (narrow ? 170 : 150);
    const width = W - left * 2;
    const height = Math.max(120, bottom - top);
    const cw = (width - GUTTER * (cols - 1)) / cols;
    const ch = (height - GUTTER * (rows - 1)) / rows;

    return this.panes.map((_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // A short last row is centred rather than left-aligned.
      const inRow = Math.min(cols, n - row * cols);
      const offset = ((cols - inRow) * (cw + GUTTER)) / 2;
      return { x: left + offset + col * (cw + GUTTER), y: top + row * (ch + GUTTER), w: cw, h: ch };
    });
  }

  _layout(first = false) {
    this.stage.renderer.getSize(this._size);
    const W = this._size.x;
    const H = this._size.y;
    const cells = this._cells(W, H);
    const full = { x: 0, y: 0, w: W, h: H };

    this.panes.forEach((p, i) => {
      const cell = cells[i];
      if (this.closing) {
        // Back into the card it came out of, if that card is still there.
        const o = p.origin ?? shrink(cell, 0.9);
        Object.assign(p.target, o);
        p.fadeTarget = 0;
      } else if (this.mode === 'compare') {
        Object.assign(p.target, cell);
        p.fadeTarget = 1;
      } else if (p.body === this.focus) {
        Object.assign(p.target, full);
        p.fadeTarget = 1;
      } else {
        Object.assign(p.target, shrink(cell, 0.94));
        p.fadeTarget = 0;
      }

      if (first) {
        const start = p.origin ?? shrink(this.mode === 'compare' ? cell : full, 0.96);
        Object.assign(p.rect, start);
        p.fade = 0;
      }
    });
  }

  /* =============================================================== frame */

  _frame(dt) {
    this._layout();
    this.controls.update(dt, this.stage.renderer.xr.isPresenting);

    this.compareness = damp(this.compareness, this.mode === 'compare' && !this.closing ? 1 : 0, RECT_SPEED, dt);
    this.element.style.setProperty('--compare', this.compareness.toFixed(3));

    let settled = true;
    for (const p of this.panes) {
      for (const k of ['x', 'y', 'w', 'h']) {
        p.rect[k] = damp(p.rect[k], p.target[k], RECT_SPEED, dt);
        if (Math.abs(p.rect[k] - p.target[k]) > 0.5) settled = false;
      }
      // Fading out is quicker than fading in, so a pane leaving never lingers
      // over the one arriving.
      p.fade = damp(p.fade, p.fadeTarget, p.fadeTarget > p.fade ? 7 : 11, dt);

      const r = p.rect;
      p.el.style.transform = `translate3d(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px, 0)`;
      p.el.style.width = `${Math.max(0, r.w).toFixed(1)}px`;
      p.el.style.height = `${Math.max(0, r.h).toFixed(1)}px`;
      p.el.style.opacity = (p.fade * this.compareness).toFixed(3);
      p.el.classList.toggle('is-focus', p.body === this.focus);
    }

    if (this.closing && settled && this.panes.every((p) => p.fade < 0.02)) {
      this.onClose?.();
      return;
    }

    // Only a view that is actually being looked at earns the full render.
    if (this.mode === 'single' && !this.closing) {
      this._held += dt;
      const pane = this.panes.find((p) => p.body === this.focus);
      if (pane && this._held > FULL_AFTER && pane.level === 'still') this._load(pane, 'full');
    }

    if (this.controls.everDragged && !this._hintGone) {
      this._hintGone = true;
      this.hintEl.classList.add('is-gone');
    }
  }

  _render(renderer) {
    renderer.getSize(this._size);
    const W = this._size.x;
    const H = this._size.y;

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.clear();
    renderer.setScissorTest(true);

    // The focused pane last, so as it grows it covers the panes fading out.
    const order = [...this.panes].sort((a, b) => (a.body === this.focus) - (b.body === this.focus));
    for (const p of order) {
      const { x, y, w, h } = p.rect;
      if (p.fade < 0.004 || w < 2 || h < 2) continue;
      const gy = H - y - h;             // renderer rows count from the bottom
      renderer.setViewport(x, gy, w, h);
      renderer.setScissor(x, gy, w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.camera.layers.set(p.layer);
      p.sky.uniforms.uFade.value = p.fade;
      renderer.render(this.scene, this.camera);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  }

  /* ============================================================ teardown */

  /** Animate back into the cards, then call onClose. */
  close(origins) {
    if (this.closing) return;
    if (origins) {
      for (const p of this.panes) {
        const o = origins[p.body];
        p.origin = o && o.width ? { x: o.left, y: o.top, w: o.width, h: o.height } : null;
      }
    }
    this.closing = true;
    this.element.classList.add('is-closing');
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    this.stopFrame?.();
    this.element.querySelector('.pfx__bar').removeEventListener('click', this._onBar);
    this.surface.removeEventListener('pointerdown', this._onPress);
    this.surface.removeEventListener('pointerup', this._onRelease);
    this.controls.destroy();
    this.release?.();
    for (const p of this.panes) {
      p.texture?.dispose();
      p.sky.geometry.dispose();
      p.sky.material.dispose();
    }
    this.panes = null;
    this.look.destroy();
    this.element.remove();
    if (import.meta.env.DEV && window.__explorer === this) delete window.__explorer;
  }
}

const shrink = (r, k) => ({
  x: r.x + (r.w * (1 - k)) / 2,
  y: r.y + (r.h * (1 - k)) / 2,
  w: r.w * k,
  h: r.h * k,
});

/**
 * Load an equirectangular image as a texture, decoding off the main thread
 * where the browser allows it. A 4096x2048 PNG decoded on the main thread is a
 * visible stall in the middle of an animation.
 */
function loadTexture(url) {
  const configure = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // No mipmaps: the longitude comes from an atan that jumps a full turn at
    // the seam, and mip selection there draws a blurred stripe. See sphereShader.
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };

  if (typeof createImageBitmap === 'function') {
    return fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); })
      .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
      .then((bitmap) => {
        const tex = new THREE.Texture(bitmap);
        // The bitmap was already flipped while decoding, and WebGL ignores
        // UNPACK_FLIP_Y for ImageBitmaps anyway.
        tex.flipY = false;
        const dispose = tex.dispose.bind(tex);
        tex.dispose = () => { dispose(); bitmap.close?.(); };
        return configure(tex);
      });
  }
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (t) => resolve(configure(t)), undefined, reject);
  });
}
