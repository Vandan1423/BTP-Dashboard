/**
 * THE CONTROL PANEL
 * =================
 * One panel, used by both the single viewer and the four-up comparison. Every
 * control does exactly one thing: patch the ViewerState it was given. Nothing
 * in here touches a video element or a camera, which is what lets the same
 * panel drive one sphere or four.
 *
 * Composition is declared by the caller -- which groups appear, and what the
 * buttons on the right are -- so the two views share a layout, a rhythm and a
 * set of keyboard habits instead of drifting into two dialects.
 *
 * It also gets out of the way. While something is playing and the pointer has
 * been still for a few seconds it slides out, because the thing worth looking
 * at is behind it. Any movement brings it back, and the chevron pins it either
 * way for anyone who would rather decide for themselves.
 */
import { utcLabel, phaseAt, elapsedDays, LAST_FRAME } from '../data/timing.js';
import { BODIES } from '../../../lib/media.js';
import { clamp } from '../../../lib/math.js';
import { createScrubber } from './Scrubber.js';

const PLAY  = `<path d="M6 4.2 17 11 6 17.8V4.2Z"/>`;
const PAUSE = `<path d="M6.4 4h3.1v14H6.4zM12.5 4h3.1v14h-3.1z"/>`;
const PREV  = `<path d="M14.5 4.5 7.5 11l7 6.5V4.5Z"/><path d="M6 4.5h1.6v13H6z"/>`;
const NEXT  = `<path d="M7.5 4.5 14.5 11l-7 6.5V4.5Z"/><path d="M15.4 4.5H17v13h-1.6z"/>`;
const CHEV  = `<path d="M4 6.5 8 10.5l4-4" stroke="currentColor" stroke-width="1.5"
                     fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Slow enough to study one timestep, fast enough to skim fifty days. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** Seconds of stillness before the panel slides out of the way. */
const IDLE_SECONDS = 3.6;

export function createControlPanel({
  state,
  transport = true,
  clock = true,
  speed = true,
  viewpoints = false,
  extras = [],
  autoHide = true,
} = {}) {
  const el = document.createElement('div');
  el.className = 'ctlp';

  el.innerHTML = `
    <button class="ctlp__toggle" type="button" aria-label="Hide controls" aria-expanded="true">
      <svg viewBox="0 0 16 16" aria-hidden="true">${CHEV}</svg>
    </button>

    <div class="ctlp__panel">
      <div class="ctlp__scrub"></div>

      <div class="ctlp__row">
        <div class="ctlp__side">
          ${transport ? `
            <div class="ctlp__transport">
              <button class="ctlp__btn ctlp__step" type="button" data-step="-1" aria-label="Previous timestep">
                <svg viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">${PREV}</svg>
              </button>
              <button class="ctlp__play" type="button" aria-label="Play">
                <svg viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">${PLAY}</svg>
              </button>
              <button class="ctlp__btn ctlp__step" type="button" data-step="1" aria-label="Next timestep">
                <svg viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">${NEXT}</svg>
              </button>
            </div>` : ''}

          ${clock ? `
            <div class="ctlp__clock">
              <span class="ctlp__time">--</span>
              <span class="ctlp__sub">
                <span class="ctlp__phase"></span>
                <span class="ctlp__frame"></span>
              </span>
            </div>` : ''}
        </div>

        <div class="ctlp__side ctlp__side--end">
          ${speed ? `
            <div class="ctlp__seg" role="group" aria-label="Playback speed">
              ${SPEEDS.map((v) => `
                <button class="ctlp__opt ctlp__speed${v === 1 ? ' is-active' : ''}"
                        type="button" data-speed="${v}">${v}×</button>`).join('')}
            </div>` : ''}

          ${viewpoints ? `
            <div class="ctlp__seg" role="group" aria-label="Viewpoint">
              ${BODIES.map((b) => `
                <button class="ctlp__opt ctlp__view" type="button" data-body="${b}">
                  <span class="ctlp__dot" data-body="${b}"></span><span class="ctlp__viewname">${b}</span>
                </button>`).join('')}
            </div>` : ''}

          ${extras.length ? `
            <div class="ctlp__actions">
              ${extras.map((a) => `
                <button class="ctlp__action${a.active ? ' is-on' : ''}" type="button" data-id="${a.id}">
                  ${a.icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
                       aria-hidden="true">${a.icon}</svg>` : ''}
                  ${a.dot ? '<span class="ctlp__actiondot"></span>' : ''}
                  <span class="ctlp__actionlabel">${a.label}</span>
                </button>`).join('')}
            </div>` : ''}
        </div>
      </div>

      <span class="ctlp__diag" hidden></span>
    </div>`;

  const q = (s) => el.querySelector(s);
  const panel = q('.ctlp__panel');
  const toggleBtn = q('.ctlp__toggle');
  const playBtn = q('.ctlp__play');
  const playIcon = playBtn?.querySelector('svg');
  const timeEl = q('.ctlp__time');
  const phaseEl = q('.ctlp__phase');
  const frameEl = q('.ctlp__frame');
  const diagEl = q('.ctlp__diag');
  const speedBtns = [...el.querySelectorAll('.ctlp__speed')];
  const viewBtns = [...el.querySelectorAll('.ctlp__view')];
  const stepBtns = [...el.querySelectorAll('.ctlp__step')];
  const actionBtns = [...el.querySelectorAll('.ctlp__action')];

  const scrubber = createScrubber({ state });
  q('.ctlp__scrub').appendChild(scrubber.element);

  /* ------------------------------------------------------------ behaviour */
  const onPlay = () => state.patch({ playing: !state.value.playing });
  const onStep = (e) => state.patch({
    playing: false,
    frame: clamp(state.value.frame + (+e.currentTarget.dataset.step), 0, LAST_FRAME),
  });
  const onSpeed = (e) => state.patch({ speed: +e.currentTarget.dataset.speed });
  const onView = (e) => state.patch({ body: e.currentTarget.dataset.body });
  const onAction = (e) => {
    const a = extras.find((x) => x.id === e.currentTarget.dataset.id);
    a?.onClick?.(e.currentTarget);
  };

  playBtn?.addEventListener('click', onPlay);
  for (const b of stepBtns) b.addEventListener('click', onStep);
  for (const b of speedBtns) b.addEventListener('click', onSpeed);
  for (const b of viewBtns) b.addEventListener('click', onView);
  for (const b of actionBtns) b.addEventListener('click', onAction);

  /* ------------------------------------------------------------ visibility */
  let idle = 0;
  let pinned = null;           // null = automatic, true = held open, false = held shut
  let hidden = false;

  const apply = () => {
    el.classList.toggle('is-hidden', hidden);
    toggleBtn.setAttribute('aria-expanded', String(!hidden));
    toggleBtn.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
  };

  const wake = () => {
    idle = 0;
    if (pinned === false) return;    // held shut on purpose; leave it alone
    if (hidden) { hidden = false; apply(); }
  };

  const onToggle = () => {
    hidden = !hidden;
    // Touching the chevron is a decision, so stop second-guessing it.
    pinned = !hidden;
    apply();
  };
  toggleBtn.addEventListener('click', onToggle);

  // Any sign of life brings it back. Pointer moves are frequent, so this is
  // kept to flipping one integer.
  const onWake = () => wake();
  window.addEventListener('pointermove', onWake, { passive: true });
  window.addEventListener('pointerdown', onWake, { passive: true });
  window.addEventListener('keydown', onWake);

  /* ---------------------------------------------------------------- paint */
  const stop = state.subscribe((s, changed) => {
    if (changed.playing && playIcon) {
      playIcon.innerHTML = s.playing ? PAUSE : PLAY;
      playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      el.classList.toggle('is-playing', s.playing);
      if (!s.playing) wake();      // pausing means you want the controls
    }
    if (changed.frame && timeEl) {
      timeEl.textContent = utcLabel(s.frame);
      const p = phaseAt(s.frame);
      phaseEl.textContent = p.label;
      phaseEl.dataset.phase = p.id;
      frameEl.textContent = `${s.frame} / ${LAST_FRAME} · day ${elapsedDays(s.frame).toFixed(1)}`;
    }
    if (changed.speed) {
      for (const b of speedBtns) b.classList.toggle('is-active', +b.dataset.speed === s.speed);
    }
    if (changed.body) {
      for (const b of viewBtns) b.classList.toggle('is-active', b.dataset.body === s.body);
    }
    if (changed.ready) el.classList.toggle('is-ready', s.ready);
    if (changed.buffering) el.classList.toggle('is-buffering', s.buffering);
  });

  return {
    element: el,

    /** Called from the owner's frame loop; drives the idle timer. */
    tick(dt) {
      if (!autoHide || pinned !== null || hidden) return;
      // Only while something is moving. A paused frame is being studied, and
      // taking the scrubber away mid-study would be its own kind of rude.
      if (!state.value.playing) { idle = 0; return; }
      idle += dt;
      if (idle > IDLE_SECONDS) { hidden = true; apply(); }
    },

    wake,

    /** Update one of the caller's own buttons, e.g. a lock that toggled. */
    setAction(id, { label, active } = {}) {
      const b = actionBtns.find((x) => x.dataset.id === id);
      if (!b) return;
      if (label !== undefined) b.querySelector('.ctlp__actionlabel').textContent = label;
      if (active !== undefined) b.classList.toggle('is-on', active);
    },

    setDiagnostics(text) {
      diagEl.hidden = !text;
      diagEl.textContent = text || '';
    },

    destroy() {
      stop();
      scrubber.destroy();
      playBtn?.removeEventListener('click', onPlay);
      for (const b of stepBtns) b.removeEventListener('click', onStep);
      for (const b of speedBtns) b.removeEventListener('click', onSpeed);
      for (const b of viewBtns) b.removeEventListener('click', onView);
      for (const b of actionBtns) b.removeEventListener('click', onAction);
      toggleBtn.removeEventListener('click', onToggle);
      window.removeEventListener('pointermove', onWake);
      window.removeEventListener('pointerdown', onWake);
      window.removeEventListener('keydown', onWake);
      el.remove();
    },
  };
}

export const ICONS = {
  grid: `<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.4"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.4"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.4"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.4"/>`,
  back: `<path d="M3.2 8.4 12 3.6l8.8 4.8L12 13.2 3.2 8.4Z"/><path d="M3.2 13.6 12 18.4l8.8-4.8"/>`,
};
