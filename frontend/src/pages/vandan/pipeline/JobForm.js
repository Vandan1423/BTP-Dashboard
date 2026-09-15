/**
 * WHAT TO RENDER, AND WHAT IT WILL COST
 * =====================================
 * Four decisions: which viewpoints, how many samples, what resolution, and what
 * date the cameras are placed for. Every one of them moves the estimate above
 * the button, live, because the estimate is the thing that makes this feature
 * acceptable rather than annoying -- the professor agreed to a multi-minute
 * wait only after being shown real timings, and the same courtesy is owed to
 * anyone using it.
 *
 * The date is a plain UTC text field rather than a datetime picker on purpose.
 * A `datetime-local` input is in the visitor's own timezone, and silently
 * shifting a heliospheric camera placement by five and a half hours is exactly
 * the class of error this pipeline has already been bitten by once.
 */
import { ALL_BODIES } from './api.js';
import { BODY_COLOR } from './Heliosphere.js';
import { QUALITY, RESOLUTION, estimate, duration, occupancyFor } from './cost.js';
import { frameToUtc, phaseAt, clampFrame, FRAME_COUNT } from '../data/timing.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** "2024-11-06 23:40" -- what the field shows and what it parses back. */
const fmtUtc = (d) => {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

const parseUtc = (s) => {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})\s*$/.exec(s || '');
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(ms) ? new Date(ms) : null;
};

/** "data.0169.vtk" -- the name an archived timestep would have on disk. */
export const archivedName = (n) => `data.${String(n).padStart(4, '0')}.vtk`;

/**
 * @param {object} opts
 * @param {File|null} opts.file         the upload, if there is one
 * @param {boolean} opts.archived       an archived timestep rather than an upload
 * @param {object} [opts.initial]       settings to restore
 */
export function createJobForm({ file, index, archived = !file, initial = {}, fileName, fileSize, machine = 'a30', onChange, onSubmit, onReset }) {
  const startIndex = initial.index ?? index ?? null;
  const settings = {
    bodies: initial.bodies?.length ? [...initial.bodies] : [...ALL_BODIES],
    quality: initial.quality ?? 'preview',
    resolution: initial.resolution ?? 'full',
    index: startIndex,
    datetime: initial.datetime ?? (startIndex != null ? fmtUtc(frameToUtc(startIndex)) : ''),
    // Which machine the estimate is for. The Mac is measured at 2.0x the A30.
    machine,
  };
  const nameOf = () => (file ? file.name : fileName && !archived ? fileName : archivedName(settings.index ?? 0));

  const el = document.createElement('div');
  el.className = 'ppanel__inner pform';
  el.innerHTML = `
    <span class="ppanel__eyebrow">Step 2 · settings</span>
    <h1 class="ppanel__title">Place the cameras</h1>

    <div class="pfile">
      <span class="pfile__icon"></span>
      <span class="pfile__text">
        <span class="pfile__name">${nameOf()}</span>
        <span class="pfile__meta"></span>
      </span>
      <button class="pfile__swap" type="button" aria-label="Choose a different file">Change</button>
    </div>

    <div class="pfield">
      <label class="pfield__label" for="pf-date">Timestamp <em>UTC</em></label>
      <div class="pfield__row">
        <input id="pf-date" class="pinput" type="text" spellcheck="false"
               placeholder="2024-11-06 23:40" value="${settings.datetime}">
        <span class="pfield__hint"></span>
      </div>
    </div>

    <div class="pfield">
      <span class="pfield__label">Viewpoints
        <button class="pfield__all" type="button">all four</button>
      </span>
      <div class="pvps">
        ${ALL_BODIES.map((b) => `
          <button class="pvp${settings.bodies.includes(b) ? ' is-on' : ''}" type="button" data-body="${b}"
                  style="--vp:${hex(BODY_COLOR[b])}" aria-pressed="${settings.bodies.includes(b)}">
            <span class="pvp__dot"></span>
            <span class="pvp__name">${b}</span>
            <span class="pvp__au">—</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="pfield">
      <span class="pfield__label">Quality</span>
      <div class="popts">
        ${Object.values(QUALITY).map((q) => `
          <button class="popt${q.id === settings.quality ? ' is-on' : ''}" type="button"
                  data-group="quality" data-id="${q.id}">
            <span class="popt__head"><b>${q.label}</b><em>${q.spp} spp</em></span>
            <span class="popt__note">${q.note}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="pfield">
      <span class="pfield__label">Resolution</span>
      <div class="popts popts--row">
        ${Object.values(RESOLUTION).map((r) => `
          <button class="popt${r.id === settings.resolution ? ' is-on' : ''}" type="button"
                  data-group="resolution" data-id="${r.id}">
            <span class="popt__head"><b>${r.label}</b></span>
            <span class="popt__note">${r.note}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="pest">
      <div class="pest__row">
        <span class="pest__label">Per viewpoint</span>
        <span class="pest__value" data-per>—</span>
      </div>
      <div class="pest__row pest__row--total">
        <span class="pest__label">Whole job</span>
        <span class="pest__value" data-total>—</span>
      </div>
      <div class="pest__bar"><i data-bar></i></div>
      <p class="pest__why" data-why></p>
    </div>

    <button class="pbtn pbtn--go" type="button" disabled>
      <span class="pbtn__label">Queue the render</span>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 8h11M9.5 3.5 14 8l-4.5 4.5" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;

  const dateInput = el.querySelector('#pf-date');
  const dateHint = el.querySelector('.pfield__hint');
  const vpButtons = [...el.querySelectorAll('.pvp')];
  const optButtons = [...el.querySelectorAll('.popt')];
  const allBtn = el.querySelector('.pfield__all');
  const goBtn = el.querySelector('.pbtn--go');
  const swapBtn = el.querySelector('.pfile__swap');
  const perEl = el.querySelector('[data-per]');
  const totalEl = el.querySelector('[data-total]');
  const barEl = el.querySelector('[data-bar]');
  const whyEl = el.querySelector('[data-why]');
  const fileMeta = el.querySelector('.pfile__meta');

  const fileNameEl = el.querySelector('.pfile__name');
  const paintFile = () => {
    const size = file?.size ?? fileSize;
    fileNameEl.textContent = nameOf();
    fileMeta.textContent = archived
      ? `archived timestep · index ${settings.index ?? '—'}`
      : `${((size ?? 0) / 1048576).toFixed(1)} MB${settings.index != null ? ` · index ${settings.index}` : ' · no index in the name'}`;
  };

  /* ------------------------------------------------------------- refresh */

  const refresh = () => {
    const plan = estimate(settings);
    const ready = settings.bodies.length > 0 && !!parseUtc(settings.datetime);

    perEl.textContent = duration(plan.perViewpoint);
    totalEl.textContent = duration(plan.total);

    // Against the worst case the whole dataset can produce, so the bar means
    // something absolute rather than being full every time.
    const worst = estimate({ ...settings, index: 169, bodies: ALL_BODIES,
                             quality: 'publication', resolution: 'full' }).total;
    barEl.style.width = `${Math.min(100, (plan.total / worst) * 100).toFixed(1)}%`;

    const occ = settings.index != null ? occupancyFor(settings.index) : null;
    whyEl.textContent = settings.index == null
      ? 'No index in the filename, so the run average of 30.2 s a frame is used. The worker replaces it with a measured value once the file is converted.'
      : occ > 0.6
        ? `A dense frame: ${phaseAt(settings.index).label.toLowerCase()}. Cost is dominated by how much ejected material is in shot, and this is near the worst of the run.`
        : occ > 0.15
          ? `${phaseAt(settings.index).label}. The front is in the domain but has not filled it yet.`
          : 'Quiet solar wind, nothing ejected yet. These are the cheap frames.';

    goBtn.disabled = !ready;
    el.classList.toggle('is-ready', ready);
    onChange?.({ ...settings, plan });
  };

  /* --------------------------------------------------------- interaction */

  const syncDate = () => {
    const d = parseUtc(dateInput.value);
    settings.datetime = dateInput.value;
    if (!d) {
      dateHint.textContent = 'Needs YYYY-MM-DD HH:MM';
      dateHint.dataset.bad = 'true';
    } else {
      // Nearest index, so an edited date still lands the cameras on a row of
      // the ephemeris the rest of the dashboard already has.
      // Not clamped: a date outside the run has no row in the ephemeris, and
      // quietly snapping it to the first or last timestep would place the
      // cameras for a day nobody asked for.
      const n = Math.round((d.getTime() - frameToUtc(0).getTime()) / (23936 * 1000));
      const inRange = n >= 0 && n < FRAME_COUNT;
      settings.index = inRange ? n : null;
      dateHint.dataset.bad = 'false';
      dateHint.textContent = inRange
        ? `index ${n} · ${phaseAt(n).label}`
        : 'outside the simulated window';
    }
    paintFile();
    refresh();
  };

  const onVp = (e) => {
    const btn = e.currentTarget;
    const body = btn.dataset.body;
    const on = settings.bodies.includes(body);
    // Never let the last one be turned off: a job with no viewpoints renders
    // nothing, and disabling the button says that better than an error would.
    if (on && settings.bodies.length === 1) {
      btn.classList.add('is-locked');
      setTimeout(() => btn.classList.remove('is-locked'), 480);
      return;
    }
    settings.bodies = on
      ? settings.bodies.filter((b) => b !== body)
      : [...ALL_BODIES].filter((b) => b === body || settings.bodies.includes(b));
    btn.classList.toggle('is-on', !on);
    btn.setAttribute('aria-pressed', String(!on));
    refresh();
  };

  const onOpt = (e) => {
    const btn = e.currentTarget;
    const group = btn.dataset.group;
    settings[group] = btn.dataset.id;
    for (const b of optButtons) {
      if (b.dataset.group === group) b.classList.toggle('is-on', b === btn);
    }
    refresh();
  };

  const onAll = () => {
    settings.bodies = [...ALL_BODIES];
    for (const b of vpButtons) { b.classList.add('is-on'); b.setAttribute('aria-pressed', 'true'); }
    refresh();
  };

  const onGo = () => {
    if (goBtn.disabled) return;
    goBtn.classList.add('is-firing');
    onSubmit?.({ ...settings, file, plan: estimate(settings) });
  };

  const onSwap = () => onReset?.();

  dateInput.addEventListener('input', syncDate);
  for (const b of vpButtons) b.addEventListener('click', onVp);
  for (const b of optButtons) b.addEventListener('click', onOpt);
  allBtn.addEventListener('click', onAll);
  goBtn.addEventListener('click', onGo);
  swapBtn.addEventListener('click', onSwap);

  syncDate();

  return {
    element: el,
    get settings() { return { ...settings }; },

    /**
     * Follow the volume inspector's timestep. Only for an archived timestep --
     * an upload's date belongs to the file, and the scrubber is locked there.
     */
    setIndex(n) {
      if (!archived || n === settings.index) return;
      dateInput.value = fmtUtc(frameToUtc(n));
      syncDate();
    },

    /** Distances, once the ephemeris has loaded. Same numbers as the cards. */
    /** The service answered after the form was built; quote its machine's times. */
    setMachine(m) {
      if (!m || m === settings.machine) return;
      settings.machine = m;
      refresh();
    },

    setDistances(byBody) {
      for (const b of vpButtons) {
        const track = byBody?.[b.dataset.body];
        const p = track?.[clampFrame(settings.index ?? 0)];
        b.querySelector('.pvp__au').textContent = p ? `${p.r.toFixed(2)} AU` : '—';
      }
    },

    destroy() {
      dateInput.removeEventListener('input', syncDate);
      for (const b of vpButtons) b.removeEventListener('click', onVp);
      for (const b of optButtons) b.removeEventListener('click', onOpt);
      allBtn.removeEventListener('click', onAll);
      goBtn.removeEventListener('click', onGo);
      swapBtn.removeEventListener('click', onSwap);
      el.remove();
    },
  };
}
