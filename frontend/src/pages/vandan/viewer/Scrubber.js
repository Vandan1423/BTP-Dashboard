/**
 * THE TIMELINE
 * ============
 * Two hundred and one timesteps laid out end to end, with the CME's phases
 * painted straight onto the track. You can see before you touch it that the
 * event lives in the last fifth of the run: everything before timestep 160 is
 * quiet background wind, and the flux rope arrives at 180.
 *
 * Those boundaries are not styling. They came out of scanning every timestep
 * for density, pressure and the tracer fields, and they are the reason the
 * scrubber is worth having at all -- without them you would drag blindly
 * through fifty days of nothing looking for the ten that matter.
 */
import { PHASES, LAST_FRAME, utcLabel, phaseAt } from '../data/timing.js';
import { clamp } from '../../../lib/math.js';

const pct = (n) => (n / LAST_FRAME) * 100;

export function createScrubber({ state }) {
  const el = document.createElement('div');
  el.className = 'scrub';
  el.innerHTML = `
    <div class="scrub__track" role="slider" tabindex="0"
         aria-label="Timestep" aria-valuemin="0" aria-valuemax="${LAST_FRAME}">
      <div class="scrub__bands">
        ${PHASES.map((p) => `
          <span class="scrub__band" data-phase="${p.id}"
                style="left:${pct(p.from)}%;width:${pct(p.to - p.from + 1)}%"
                title="${p.label}"></span>`).join('')}
      </div>
      <div class="scrub__fill"></div>
      ${PHASES.slice(1).map((p) => `
        <span class="scrub__mark" data-phase="${p.id}" style="left:${pct(p.from)}%">
          <span class="scrub__marklabel">${p.label}</span>
        </span>`).join('')}
      <div class="scrub__head"></div>
      <div class="scrub__ghost"><span class="scrub__ghostlabel"></span></div>
    </div>`;

  const track = el.querySelector('.scrub__track');
  const fill = el.querySelector('.scrub__fill');
  const head = el.querySelector('.scrub__head');
  const ghost = el.querySelector('.scrub__ghost');
  const ghostLabel = el.querySelector('.scrub__ghostlabel');

  let dragging = false;
  let resumeAfterDrag = false;

  const frameAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * LAST_FRAME);
  };

  const onDown = (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    // Scrubbing a playing video fights itself, so pause for the drag and put it
    // back exactly as it was on release.
    resumeAfterDrag = state.value.playing;
    if (resumeAfterDrag) state.patch({ playing: false });
    state.patch({ frame: frameAt(e.clientX) });
  };

  const onMove = (e) => {
    const n = frameAt(e.clientX);
    // The date under the cursor, before you commit to it.
    ghost.style.left = `${pct(n)}%`;
    ghostLabel.textContent = utcLabel(n);
    if (dragging) state.patch({ frame: n });
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    track.releasePointerCapture?.(e.pointerId);
    el.classList.remove('is-dragging');
    if (resumeAfterDrag) state.patch({ playing: true });
  };

  const onKey = (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); state.patch({ frame: clamp(state.value.frame - step, 0, LAST_FRAME) }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); state.patch({ frame: clamp(state.value.frame + step, 0, LAST_FRAME) }); }
    if (e.key === 'Home') { e.preventDefault(); state.patch({ frame: 0 }); }
    if (e.key === 'End') { e.preventDefault(); state.patch({ frame: LAST_FRAME }); }
  };

  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
  track.addEventListener('keydown', onKey);

  const stop = state.subscribe((s, changed) => {
    if (!changed.frame) return;
    const p = pct(s.frame);
    fill.style.width = `${p}%`;
    head.style.left = `${p}%`;
    track.setAttribute('aria-valuenow', s.frame);
    track.setAttribute('aria-valuetext', `${utcLabel(s.frame)}, ${phaseAt(s.frame).label}`);
    el.dataset.phase = phaseAt(s.frame).id;
  });

  return {
    element: el,
    destroy() {
      stop();
      track.removeEventListener('pointerdown', onDown);
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      track.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
