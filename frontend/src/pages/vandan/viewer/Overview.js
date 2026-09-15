/**
 * THE WAY IN
 * ==========
 * What you get when you open the 360 Viewer section: what these renders are,
 * what was measured, and four cards showing what each viewpoint actually sees.
 *
 * You arrive here rather than inside a sphere. Being dropped straight into one
 * gives no idea what you are looking at, and no hint that there are three other
 * places to look from.
 */
import { LAST_FRAME, dateLabel } from '../data/timing.js';
import { createViewpointCards, POSTER_FRAME } from './ViewpointCards.js';

const FACTS = [
  { value: '201', label: 'timesteps' },
  { value: '4', label: 'viewpoints' },
  { value: '4096×2048', label: 'per frame' },
  { value: '55.4', label: 'days simulated' },
];

export function createOverview({ onSelect, onCompare }) {
  const el = document.createElement('div');
  el.className = 'ovw';
  el.innerHTML = `
    <div class="ovw__copy">
      <span class="ovw__eyebrow">Solar Wind &amp; CME</span>
      <h1 class="ovw__title">Stand on a planet and watch it arrive</h1>
      <p class="ovw__body">
        A coronal mass ejection leaving the Sun and washing across the inner
        heliosphere, from a magnetohydrodynamic simulation of ${LAST_FRAME + 1}
        timesteps. Each one was rendered from the real orbital position of
        Mercury, Venus, Earth and Mars on that date, as a full 360° sphere
        rather than a flat frame. Choose where to stand.
      </p>
      <dl class="ovw__facts">
        ${FACTS.map((f) => `
          <div class="ovw__fact"><dt>${f.value}</dt><dd>${f.label}</dd></div>`).join('')}
      </dl>
    </div>

    <div class="ovw__pick">
      <div class="ovw__pickhead">
        <span class="ovw__picklabel">Choose a viewpoint</span>
        <span class="ovw__pickdate">Previews at the peak · ${dateLabel(POSTER_FRAME)}</span>
      </div>
      <div class="ovw__cards"></div>
      <button class="ovw__compare" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.4"/>
          <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.4"/>
          <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.4"/>
          <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.4"/>
        </svg>
        Compare all four, frame by frame
      </button>
    </div>`;

  const cards = createViewpointCards({ onSelect });
  el.querySelector('.ovw__cards').appendChild(cards.element);

  const compareBtn = el.querySelector('.ovw__compare');
  const onCompareClick = () => onCompare?.();
  compareBtn.addEventListener('click', onCompareClick);

  return {
    element: el,
    setSelected: (body) => cards.setSelected(body),
    destroy() {
      compareBtn.removeEventListener('click', onCompareClick);
      cards.destroy();
      el.remove();
    },
  };
}
