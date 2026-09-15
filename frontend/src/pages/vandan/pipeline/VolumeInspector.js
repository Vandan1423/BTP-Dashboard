/**
 * TAKING THE VOLUME APART
 * =======================
 * The controls that make the volume something to handle rather than watch.
 * Each one is a uniform in the shader, so every change is immediate:
 *
 *   Timestep  scrub the event from quiet wind to the peak and back, or play it
 *   Show      the wind, the ejecta, or both
 *   Cells     the raw unstructured cells, or the pinned 256³ grid they land on
 *   Slice     cut the domain open along an axis and slide the cut through it
 *   Floor     hide everything below a density
 *
 * The timestep is not a toy. On the intake it chooses which archived timestep
 * the sample button submits, and for an archived job it drives the date field
 * in the form -- so exploring the event and choosing what to render are the
 * same gesture. For an uploaded file the index comes from the filename and the
 * scrubber is locked to it, because a date that disagrees with the file would
 * place the cameras wrong.
 */
import { PHASES, LAST_FRAME, utcLabel, phaseAt, clampFrame } from '../data/timing.js';

const PLAY = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8.5-5z" fill="currentColor"/></svg>`;
const PAUSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" fill="currentColor"/></svg>`;
const RESET = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.6v2.8h2.8"/></svg>`;
const CHEV = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4"/></svg>`;

/** Timesteps per second while the event plays. */
const PLAY_RATE = 16;

export function createVolumeInspector({ tools, index, onIndex, onTools, onReset, onCollapse, collapsed = false }) {
  const t = { ...tools };
  let idx = clampFrame(index ?? 169);
  let locked = false;
  let playing = false;

  const el = document.createElement('section');
  el.className = 'pvi';
  el.classList.toggle('is-collapsed', collapsed);
  el.innerHTML = `
    <header class="pvi__head">
      <span class="pvi__title">Volume</span>
      <button class="pvi__icon" type="button" data-act="reset" aria-label="Reset the view" title="Reset view">${RESET}</button>
      <button class="pvi__icon pvi__fold" type="button" data-act="fold" aria-label="Collapse">${CHEV}</button>
    </header>

    <div class="pvi__body">
      <div class="pvi__row pvi__row--time">
        <div class="pvi__label">
          <span>Timestep</span>
          <b data-idx>${idx}</b>
        </div>
        <div class="pvi__scrub">
          <button class="pvi__play" type="button" aria-label="Play the event">${PLAY}</button>
          <div class="pvi__track" tabindex="0" role="slider" aria-label="Timestep"
               aria-valuemin="0" aria-valuemax="${LAST_FRAME}">
            <div class="pvi__phases">
              ${PHASES.map((p) => `<i data-phase="${p.id}"
                 style="left:${(p.from / LAST_FRAME) * 100}%;width:${((p.to - p.from + 1) / (LAST_FRAME + 1)) * 100}%"></i>`).join('')}
            </div>
            <div class="pvi__fill"></div>
            <div class="pvi__thumb"></div>
          </div>
        </div>
        <div class="pvi__date"><span data-date></span><em data-phase></em></div>
      </div>

      <div class="pvi__row">
        <span class="pvi__label"><span>Show</span></span>
        <div class="pvi__seg" data-group="show">
          <button type="button" data-id="wind">Wind</button>
          <button type="button" data-id="cme">Ejecta</button>
        </div>
      </div>

      <div class="pvi__row">
        <span class="pvi__label"><span>Cells</span></span>
        <div class="pvi__seg" data-group="grid">
          <button type="button" data-id="raw">Raw</button>
          <button type="button" data-id="grid">256³ grid</button>
        </div>
      </div>

      <div class="pvi__row">
        <span class="pvi__label"><span>Slice</span><b data-slice-val></b></span>
        <div class="pvi__seg pvi__seg--4" data-group="slice">
          <button type="button" data-id="off">Off</button>
          <button type="button" data-id="x">X</button>
          <button type="button" data-id="y">Y</button>
          <button type="button" data-id="z">Z</button>
        </div>
        <input class="pvi__range" type="range" min="-0.95" max="0.95" step="0.01"
               data-range="slicePos" aria-label="Slice position">
      </div>

      <div class="pvi__row">
        <span class="pvi__label"><span>Density floor</span><b data-thr-val></b></span>
        <input class="pvi__range" type="range" min="0" max="0.8" step="0.01"
               data-range="threshold" aria-label="Density floor">
      </div>

      <p class="pvi__hint">Drag to orbit · scroll to zoom · point at the volume to read a cell</p>
    </div>`;

  const q = (s) => el.querySelector(s);
  const idxEl = q('[data-idx]');
  const dateEl = q('[data-date]');
  const phaseEl = q('[data-phase]');
  const track = q('.pvi__track');
  const fill = q('.pvi__fill');
  const thumb = q('.pvi__thumb');
  const playBtn = q('.pvi__play');
  const sliceRange = q('[data-range="slicePos"]');
  const thrRange = q('[data-range="threshold"]');
  const sliceVal = q('[data-slice-val]');
  const thrVal = q('[data-thr-val]');

  /* -------------------------------------------------------------- paint */

  const paintIndex = () => {
    const k = idx / LAST_FRAME;
    fill.style.width = `${k * 100}%`;
    thumb.style.left = `${k * 100}%`;
    idxEl.textContent = String(idx).padStart(3, '0');
    dateEl.textContent = utcLabel(idx);
    phaseEl.textContent = phaseAt(idx).label;
    phaseEl.dataset.phase = phaseAt(idx).id;
    track.setAttribute('aria-valuenow', String(idx));
  };

  const paintTools = () => {
    for (const b of el.querySelectorAll('[data-group="show"] button')) {
      b.classList.toggle('is-on', !!t[b.dataset.id]);
    }
    for (const b of el.querySelectorAll('[data-group="grid"] button')) {
      b.classList.toggle('is-on', t.grid === b.dataset.id);
    }
    for (const b of el.querySelectorAll('[data-group="slice"] button')) {
      b.classList.toggle('is-on', t.slice === b.dataset.id);
    }
    sliceRange.value = String(t.slicePos);
    sliceRange.disabled = t.slice === 'off';
    el.classList.toggle('is-slicing', t.slice !== 'off');
    sliceVal.textContent = t.slice === 'off' ? '' : `${t.slice.toUpperCase()} ${t.slicePos >= 0 ? '+' : '−'}${Math.abs(t.slicePos).toFixed(2)}`;
    thrRange.value = String(t.threshold);
    thrVal.textContent = t.threshold.toFixed(2);
    for (const r of [sliceRange, thrRange]) {
      const k = (r.value - r.min) / (r.max - r.min);
      r.style.setProperty('--k', `${(k * 100).toFixed(1)}%`);
    }
  };

  const emitTools = () => { paintTools(); onTools?.({ ...t }); };

  const setIdx = (n, fromUser) => {
    if (!Number.isFinite(n)) return;
    const next = clampFrame(n);
    if (next === idx && !fromUser) return;
    idx = next;
    paintIndex();
    if (fromUser) onIndex?.(idx);
  };

  /* -------------------------------------------------------------- scrub */

  let scrubbing = false;
  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    // A folded inspector has a track with no width, and a pointer event on it
    // would divide by zero and hand NaN to everything downstream.
    if (!r.width) return idx;
    return Math.round(((e.clientX - r.left) / r.width) * LAST_FRAME);
  };
  const onDown = (e) => {
    if (locked) return;
    scrubbing = true;
    stop();
    capture(track, "set", e.pointerId);
    track.classList.add('is-scrubbing');
    setIdx(fromEvent(e), true);
  };
  const onMove = (e) => { if (scrubbing) setIdx(fromEvent(e), true); };
  const onUp = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    capture(track, "release", e.pointerId);
    track.classList.remove('is-scrubbing');
  };
  const onTrackKey = (e) => {
    if (locked) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); setIdx(idx - step, true); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); setIdx(idx + step, true); }
  };

  /* --------------------------------------------------------------- play */

  let acc = 0;
  const stop = () => {
    playing = false;
    playBtn.innerHTML = PLAY;
    playBtn.classList.remove('is-on');
  };
  const onPlay = () => {
    if (locked) return;
    if (playing) { stop(); return; }
    playing = true;
    acc = 0;
    // Starting from the end would play nothing, so go round again.
    if (idx >= LAST_FRAME) setIdx(0, true);
    playBtn.innerHTML = PAUSE;
    playBtn.classList.add('is-on');
  };

  /* -------------------------------------------------------------- tools */

  const onSeg = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const group = btn.closest('[data-group]').dataset.group;
    const id = btn.dataset.id;
    if (group === 'show') {
      // Never both off: an empty volume looks like a bug, not a choice.
      const next = !t[id];
      const other = id === 'wind' ? 'cme' : 'wind';
      if (!next && !t[other]) t[other] = true;
      t[id] = next;
    } else if (group === 'grid') {
      t.grid = id;
    } else if (group === 'slice') {
      t.slice = id;
    }
    emitTools();
  };
  const onRange = (e) => {
    const key = e.target.dataset.range;
    t[key] = parseFloat(e.target.value);
    emitTools();
  };
  const onHeadClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') onReset?.();
    if (act === 'fold') onCollapse?.(el.classList.toggle('is-collapsed'));
  };

  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
  track.addEventListener('keydown', onTrackKey);
  playBtn.addEventListener('click', onPlay);
  for (const s of el.querySelectorAll('.pvi__seg')) s.addEventListener('click', onSeg);
  sliceRange.addEventListener('input', onRange);
  thrRange.addEventListener('input', onRange);
  q('.pvi__head').addEventListener('click', onHeadClick);

  paintIndex();
  paintTools();

  return {
    element: el,
    get tools() { return { ...t }; },
    get index() { return idx; },
    get collapsed() { return el.classList.contains('is-collapsed'); },

    /** Advance playback. Called from the shared frame loop, never a timer. */
    tick(dt) {
      if (!playing) return;
      acc += dt * PLAY_RATE;
      if (acc < 1) return;
      const n = Math.floor(acc);
      acc -= n;
      if (idx + n >= LAST_FRAME) { setIdx(LAST_FRAME, true); stop(); return; }
      setIdx(idx + n, true);
    },

    /** Follow an index chosen elsewhere -- the form's date field. */
    setIndex(n) { setIdx(n, false); },

    /** Lock the scrubber to a file's own index. */
    setLocked(on, reason = '') {
      locked = on;
      if (on) stop();
      el.classList.toggle('is-locked', on);
      track.title = on ? reason : '';
    },

    setVisible(on) { el.classList.toggle('is-on', on); if (!on) stop(); },

    setCollapsed(on) { el.classList.toggle('is-collapsed', on); },

    destroy() {
      stop();
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      track.removeEventListener('keydown', onTrackKey);
      playBtn.removeEventListener('click', onPlay);
      for (const s of el.querySelectorAll('.pvi__seg')) s.removeEventListener('click', onSeg);
      sliceRange.removeEventListener('input', onRange);
      thrRange.removeEventListener('input', onRange);
      q('.pvi__head').removeEventListener('click', onHeadClick);
      el.remove();
    },
  };
}

/**
 * Pointer capture throws when the pointer is already gone -- a touch that was
 * cancelled, or a pen lifted mid-gesture. Losing capture is harmless; an
 * exception out of an event handler is not.
 */
function capture(el, verb, id) {
  try { el[`${verb}PointerCapture`](id); } catch { /* the pointer has already ended */ }
}
