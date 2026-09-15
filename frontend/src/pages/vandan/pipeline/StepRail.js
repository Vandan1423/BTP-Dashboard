/**
 * THE SPINE OF A JOB
 * ==================
 * Six steps, always in the same order, always visible once a file is in hand.
 * They are the actual pipeline -- `VtkToVdbPipeline.py`, then
 * `GetPlanetsPositions.py`, then the template `.blend`, then `RenderCameras.py`
 * -- and not a generic progress bar, so the time each one costs is written
 * underneath it from the measured model rather than divided up evenly.
 *
 * A step can be pending, active, or done. The connector between two steps fills
 * as the one before it runs, which is what makes a long render legible: the
 * render step is nine tenths of the width because it is nine tenths of the job.
 */
import { duration } from './cost.js';

export const STEPS = [
  { id: 'upload',    label: 'Upload',    detail: 'the .vtk file' },
  { id: 'convert',   label: 'VTK → VDB', detail: '256³ resample' },
  { id: 'ephemeris', label: 'Cameras',   detail: 'Solar-MACH' },
  { id: 'scene',     label: 'Scene',     detail: 'template .blend' },
  { id: 'render',    label: 'Render',    detail: 'Cycles' },
  { id: 'frames',    label: 'Frames',    detail: 'equirectangular' },
];

export function createStepRail() {
  const el = document.createElement('ol');
  el.className = 'prail';
  el.innerHTML = STEPS.map((s) => `
    <li class="prail__step" data-id="${s.id}" data-state="pending">
      <span class="prail__mark"><i></i></span>
      <span class="prail__text">
        <span class="prail__label">${s.label}</span>
        <span class="prail__detail">${s.detail}</span>
      </span>
      <span class="prail__bar"><i></i></span>
    </li>`).join('');

  const steps = new Map(
    STEPS.map((s) => [s.id, el.querySelector(`.prail__step[data-id="${s.id}"]`)]),
  );

  return {
    element: el,

    /**
     * @param {string|null} active    the step running now
     * @param {Set<string>} done      steps already finished
     * @param {number} progress       0..1 through the active step
     */
    set(active, done, progress = 0) {
      for (const s of STEPS) {
        const node = steps.get(s.id);
        const state = done.has(s.id) ? 'done' : s.id === active ? 'active' : 'pending';
        node.dataset.state = state;
        const fill = state === 'done' ? 1 : state === 'active' ? progress : 0;
        node.style.setProperty('--fill', fill.toFixed(3));
      }
    },

    /** Writes the measured cost under each step once the settings are known. */
    setCosts(stages) {
      for (const st of stages) {
        const node = steps.get(st.id);
        if (!node || !st.seconds) continue;
        node.querySelector('.prail__detail').textContent = duration(st.seconds);
      }
    },

    reset() {
      for (const s of STEPS) {
        const node = steps.get(s.id);
        node.dataset.state = 'pending';
        node.style.setProperty('--fill', '0');
        node.querySelector('.prail__detail').textContent = s.detail;
      }
    },
  };
}
