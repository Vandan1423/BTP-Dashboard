/**
 * THE WAY IN
 * ==========
 * One `.vtk` file, and nothing else is asked for yet.
 *
 * A full sequence upload was considered and ruled out with the professor: the
 * pipeline's field names, domain bounds, colour ranges and camera set are tuned
 * to this dataset, and a four-viewpoint sequence is thirteen hours. A single
 * timestep is the thing that genuinely works, so the door only accepts one.
 *
 * The sample button matters more than it looks. A demo that cannot start
 * without a hundred-megabyte file on the examiner's machine is a demo with a
 * single point of failure, and the archived timesteps are right there.
 */
import { indexFromName, isVtk } from './api.js';
import { baseSeconds, duration } from './cost.js';
import { phaseAt } from '../data/timing.js';
import { archivedName } from './JobForm.js';

/** Where the preview starts: the most expensive frame in the whole run. */
export const SAMPLE_INDEX = 169;

const PLUG = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor"
  stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M16 3.5 27 9.5v13L16 28.5 5 22.5v-13L16 3.5Z"/>
  <path d="M5 9.5 16 15.5l11-6M16 15.5v13"/>
  <path d="M10.5 12.5 21.5 6.5"/></svg>`;

export function createIntake({ index = SAMPLE_INDEX, service = null, onFile, onSample }) {
  let sampleIndex = index;
  const el = document.createElement('div');
  el.className = 'ppanel__inner pintake';
  el.innerHTML = `
    <span class="ppanel__eyebrow">Feature 2 · on demand</span>
    <h1 class="ppanel__title">Render your own timestep</h1>
    <p class="ppanel__body">
      Drop one <code>.vtk</code> from the PLUTO run. It is resampled onto the
      same pinned 256³ grid the rest of the dataset uses, the cameras are placed
      at the real planetary positions for that date, and Cycles renders one
      equirectangular frame per viewpoint you ask for.
    </p>

    <label class="pdrop" tabindex="0">
      <input type="file" accept=".vtk" hidden>
      <span class="pdrop__glyph">${PLUG}</span>
      <span class="pdrop__lead">Drop a <b>.vtk</b> file</span>
      <span class="pdrop__sub">or click to choose · about 102 MB each</span>
      <span class="pdrop__ring" aria-hidden="true"></span>
    </label>

    <p class="pintake__err" hidden></p>

    <p class="psvc" data-live="unknown"><i></i><span>Looking for the render service…</span></p>

    <button class="pbtn pbtn--ghost pintake__sample" type="button">
      <span class="pbtn__dot"></span>
      <span data-sample-lead></span>
      <span class="pbtn__note" data-sample-note></span>
    </button>

    <dl class="pfacts">
      <div class="pfact"><dt>256³</dt><dd>pinned grid</dd></div>
      <div class="pfact"><dt>11.2 s</dt><dd>to convert</dd></div>
      <div class="pfact"><dt>4</dt><dd>viewpoints available</dd></div>
      <div class="pfact"><dt>50×</dt><dd>spread in frame cost</dd></div>
    </dl>

    <p class="pnote">
      The files carry no timestamp, so the date is read from the index in the
      name and left editable. An arbitrarily named file still works; it just
      needs a date typed in.
    </p>`;

  const input = el.querySelector('input[type=file]');
  const drop = el.querySelector('.pdrop');
  const err = el.querySelector('.pintake__err');
  const sample = el.querySelector('.pintake__sample');
  const sampleLead = el.querySelector('[data-sample-lead]');
  const sampleNote = el.querySelector('[data-sample-note]');

  /* The button renders whichever timestep the volume inspector is showing, so
     scrubbing the event on the left is how an archived timestep is chosen. */
  const paintSample = () => {
    sampleLead.textContent = `Use archived timestep ${sampleIndex} instead`;
    sampleNote.textContent = `${archivedName(sampleIndex)} · ${phaseAt(sampleIndex).label} · `
      + `${duration(baseSeconds(sampleIndex))} per viewpoint at 4096 spp`;
  };
  paintSample();

  /* Before anything is dropped, say whether it will really be rendered. A demo
     that silently falls back to the simulator is the thing to avoid. */
  const svcEl = el.querySelector('.psvc');
  const paintService = (svc) => {
    if (!svc) return;
    svcEl.dataset.live = String(svc.live);
    svcEl.querySelector('span').textContent = svc.live
      ? `Frames are rendered on ${svc.label}.`
      : `Simulated: ${svc.reason || 'no render service answered'}. Start Dashboard/backend/serve.py to render for real.`;
  };
  paintService(service);

  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
    drop.classList.add('is-bad');
    setTimeout(() => drop.classList.remove('is-bad'), 620);
  };

  const accept = (file) => {
    if (!file) return;
    if (!isVtk(file.name)) return fail(`${file.name} is not a .vtk file.`);
    err.hidden = true;
    onFile?.(file, indexFromName(file.name));
  };

  const onChange = () => accept(input.files?.[0]);
  const onDragOver = (e) => { e.preventDefault(); drop.classList.add('is-over'); };
  const onDragLeave = () => drop.classList.remove('is-over');
  const onDrop = (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    accept(e.dataTransfer?.files?.[0]);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  };
  const onSampleClick = () => onSample?.(sampleIndex);

  input.addEventListener('change', onChange);
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', onDragLeave);
  drop.addEventListener('drop', onDrop);
  drop.addEventListener('keydown', onKey);
  sample.addEventListener('click', onSampleClick);

  return {
    element: el,
    setIndex(n) { sampleIndex = n; paintSample(); },
    setService: paintService,
    destroy() {
      input.removeEventListener('change', onChange);
      drop.removeEventListener('dragover', onDragOver);
      drop.removeEventListener('dragleave', onDragLeave);
      drop.removeEventListener('drop', onDrop);
      drop.removeEventListener('keydown', onKey);
      sample.removeEventListener('click', onSampleClick);
      el.remove();
    },
  };
}
