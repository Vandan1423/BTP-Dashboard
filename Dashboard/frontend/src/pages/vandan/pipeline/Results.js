/**
 * WHAT CAME BACK
 * ==============
 * One card per viewpoint, showing the frame exactly as the renderer wrote it:
 * flat and visibly wrong-looking. That is deliberate. An equirectangular
 * projection shown flat is a smear, and putting the smear next to the button
 * that wraps it back onto a sphere is the shortest explanation of why this
 * dataset needs a 360 viewer at all.
 *
 * Two ways in, matching the two ways the explorer shows frames: open a single
 * viewpoint, or compare them all. Both grow out of the cards themselves -- the
 * explorer is handed each card's rectangle and starts its panes there.
 *
 * Underneath is the receipt: samples, resolution, grid, date, and the camera
 * position in AU for every viewpoint. Those numbers are what makes a render
 * reproducible, and they are the first thing an examiner should ask for.
 */
import { QUALITY, RESOLUTION, duration } from './cost.js';
import { BODY_COLOR } from './Heliosphere.js';
import { utcLabel, phaseAt } from '../data/timing.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** The service's messages go into markup; they are text, and stay text. */
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="8.4"/><ellipse cx="12" cy="12" rx="3.6" ry="8.4"/>
  <path d="M3.8 12h16.4"/></svg>`;
const GRID = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.3" y="2.8" width="5" height="4.4" rx="1"/><rect x="8.7" y="2.8" width="5" height="4.4" rx="1"/><rect x="2.3" y="8.8" width="5" height="4.4" rx="1"/><rect x="8.7" y="8.8" width="5" height="4.4" rx="1"/></svg>`;
const SINGLE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.6"/></svg>`;

export function createResults({ job, viewpoints, byBody, snapshot = null, onOpen, onAgain, onReset }) {
  const q = QUALITY[job.quality] ?? QUALITY.preview;
  const r = RESOLUTION[job.resolution] ?? RESOLUTION.full;
  const index = job.index;
  const n = viewpoints.length;

  const el = document.createElement('div');
  el.className = 'ppanel__inner pres';
  el.innerHTML = `
    <span class="ppanel__eyebrow">Step 6 · frames</span>
    <h1 class="ppanel__title">${n} frame${n === 1 ? '' : 's'} back</h1>
    <p class="ppanel__body">
      Each one is the whole sphere of directions around that planet, unrolled
      into a rectangle. Open one to wrap it back up and look around inside it.
    </p>

    <div class="pres__open">
      <button class="pbtn pbtn--go" type="button" data-open="single">
        ${SINGLE}<span class="pbtn__label">View individually</span>
      </button>
      <button class="pbtn pbtn--ghost-row" type="button" data-open="compare" ${n < 2 ? 'disabled' : ''}>
        ${GRID}<span class="pbtn__label">Compare ${n < 2 ? '' : `all ${n}`}</span>
      </button>
    </div>

    <div class="pgrid">
      ${viewpoints.map((v) => `
        <button class="pcard" type="button" data-body="${v.body}"
                style="--vp:${hex(BODY_COLOR[v.body])}">
          <span class="pcard__media">
            <img src="${v.thumb ?? v.url}" alt="Equirectangular render from ${v.body}" decoding="async">
            <span class="pcard__scrim"></span>
            <span class="pcard__open">${EYE} Look inside</span>
          </span>
          <span class="pcard__foot">
            <span class="pcard__name"><i></i>${v.body}</span>
            <span class="pcard__time">${duration(v.seconds)}</span>
          </span>
        </button>`).join('')}
    </div>

    <div class="preceipt">
      <span class="preceipt__head">Parameter receipt</span>
      <dl>
        <div><dt>Samples</dt><dd>${q.spp} spp · ${q.label}</dd></div>
        <div><dt>Resolution</dt><dd>${r.label} equirectangular</dd></div>
        <div><dt>Volume grid</dt><dd>256³, pinned from data.0000.vtk</dd></div>
        <div><dt>Timestamp</dt><dd>${snapshot?.datetime ? `${escapeHtml(snapshot.datetime)} UTC` : index != null ? utcLabel(index) : job.datetime}</dd></div>
        <div><dt>Phase</dt><dd>${index != null ? phaseAt(index).label : 'unknown'}</dd></div>
        <div><dt>Density · emission</dt><dd>8.0 · 4.2, step 3.0, bounces 1</dd></div>
        ${snapshot?.volume_source ? `<div><dt>Volume</dt><dd>${escapeHtml(snapshot.volume_source)}</dd></div>` : ''}
        ${snapshot?.tracer_voxels != null ? `<div><dt>Tracer</dt><dd>tr1 &gt; 0.1 in ${Number(snapshot.tracer_voxels).toLocaleString('en-US')} voxels</dd></div>` : ''}
        ${snapshot?.positions_source ? `<div><dt>Positions</dt><dd>${escapeHtml(snapshot.positions_source)}</dd></div>` : ''}
        ${snapshot?.machine ? `<div><dt>Rendered on</dt><dd>${escapeHtml(snapshot.machine)}</dd></div>` : ''}
      </dl>
      ${(snapshot?.warnings ?? []).length ? `<ul class="pwarn">${snapshot.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
      <table class="pcams">
        <thead><tr><th>Camera</th><th>x</th><th>y</th><th>z</th><th>r</th></tr></thead>
        <tbody></tbody>
      </table>
      <p class="pnote">Positions in AU, inertial frame, from Solar-MACH. The same
      numbers go into the Blender cameras, so a dot on the map and the point you
      stand at inside the sphere are one coordinate.</p>
    </div>

    <div class="pres__acts">
      ${job.quality === 'preview' ? `
        <button class="pbtn pbtn--quiet pres__again" type="button">Re-render at 4096 spp</button>` : ''}
      <button class="pbtn pbtn--quiet pres__reset" type="button">Start another file</button>
    </div>`;

  const tbody = el.querySelector('.pcams tbody');
  for (const v of viewpoints) {
    // What the cameras were actually placed at, when the service says; the
    // page's own copy of the ephemeris only covers the run's 201 timesteps.
    const p = snapshot?.positions?.[v.body] ?? byBody?.[v.body]?.[index ?? 0];
    const tr = document.createElement('tr');
    tr.style.setProperty('--vp', hex(BODY_COLOR[v.body]));
    tr.innerHTML = p
      ? `<td><i></i>${v.body}</td><td>${p.x.toFixed(3)}</td><td>${p.y.toFixed(3)}</td>
         <td>${p.z.toFixed(3)}</td><td>${(p.r ?? Math.hypot(p.x, p.y, p.z)).toFixed(3)}</td>`
      : `<td><i></i>${v.body}</td><td colspan="4">not in the ephemeris</td>`;
    tbody.appendChild(tr);
  }

  const cards = [...el.querySelectorAll('.pcard')];
  const onCard = (e) => onOpen?.({ mode: 'single', body: e.currentTarget.dataset.body });
  const onOpenBtn = (e) => {
    const mode = e.currentTarget.dataset.open;
    onOpen?.({ mode, body: viewpoints[0].body });
  };
  for (const c of cards) c.addEventListener('click', onCard);
  const openBtns = [...el.querySelectorAll('[data-open]')];
  for (const b of openBtns) b.addEventListener('click', onOpenBtn);

  const againBtn = el.querySelector('.pres__again');
  const resetBtn = el.querySelector('.pres__reset');
  const onAgainClick = () => onAgain?.();
  const onResetClick = () => onReset?.();
  againBtn?.addEventListener('click', onAgainClick);
  resetBtn.addEventListener('click', onResetClick);

  // Cards arrive one after another. Reading a layout property commits the
  // starting state first; deliberately not requestAnimationFrame, which never
  // fires in a background tab and would leave the cards at opacity zero.
  void el.offsetWidth;
  cards.forEach((c, i) => { c.style.transitionDelay = `${80 + i * 90}ms`; c.classList.add('is-in'); });

  return {
    element: el,

    /** Where each card's image is on screen, for the explorer to grow from. */
    cardRects() {
      const out = {};
      for (const c of cards) {
        const img = c.querySelector('.pcard__media');
        const rect = img.getBoundingClientRect();
        if (rect.width) out[c.dataset.body] = rect;
      }
      return out;
    },

    destroy() {
      for (const c of cards) c.removeEventListener('click', onCard);
      for (const b of openBtns) b.removeEventListener('click', onOpenBtn);
      againBtn?.removeEventListener('click', onAgainClick);
      resetBtn.removeEventListener('click', onResetClick);
      el.remove();
    },
  };
}
