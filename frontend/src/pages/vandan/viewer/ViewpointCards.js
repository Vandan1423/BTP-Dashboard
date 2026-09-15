/**
 * CHOOSING WHERE TO STAND
 * =======================
 * Four cards, one per viewpoint. Each shows what that planet actually sees at
 * the CME's peak, so you pick by looking rather than by reading a name.
 *
 * The face is not a crop of the equirectangular frame -- that would be a
 * smeared band of nothing, which is the whole reason the viewer exists. It is a
 * real perspective view reprojected out of the sphere with ffmpeg's `v360`
 * filter at a 104 degree horizontal field, so a card is a fair preview of what
 * you get when you go inside.
 *
 * They tilt toward the pointer. Real perspective on a real element: the deck
 * has a shared vanishing point, and the card being pointed at leans out of it.
 */
import { BODIES } from '../../../lib/media.js';
import { loadEphemeris } from '../data/ephemeris.js';
import { PHASES, dateLabel } from '../data/timing.js';

/** The timestep the posters were rendered from -- the peak of the event. */
export const POSTER_FRAME = PHASES[2].from;   // 180

const ACCENT = {
  Mercury: '#c9bda8',
  Venus: '#f0c98a',
  Earth: '#7fb6ff',
  Mars: '#e08a5a',
};

/** One line each, so the choice means something before you have been inside. */
const NOTE = {
  Mercury: 'Closest in. The front arrives first and fills the sky fastest.',
  Venus: 'Mid-flight. The flux rope is still coherent overhead.',
  Earth: 'One AU. The arrival an operational forecast would care about.',
  Mars: 'Furthest out. The front is broad, faint and late.',
};

/** How far a card leans toward the pointer, in degrees. */
const TILT = 9;

export function createViewpointCards({ onSelect }) {
  const root = document.createElement('div');
  root.className = 'vpc';

  root.innerHTML = BODIES.map((body) => `
    <button class="vpc__card" type="button" data-body="${body}"
            style="--card-accent:${ACCENT[body]}" aria-label="View from ${body}">
      <span class="vpc__inner">
        <span class="vpc__media">
          <img src="${import.meta.env.BASE_URL}posters/${body.toLowerCase()}.jpg"
               alt="The view from ${body} at the peak of the coronal mass ejection"
               loading="lazy" decoding="async">
          <span class="vpc__sheen" aria-hidden="true"></span>
        </span>
        <span class="vpc__meta">
          <span class="vpc__row">
            <span class="vpc__name">${body}</span>
            <span class="vpc__au">—</span>
          </span>
          <span class="vpc__note">${NOTE[body]}</span>
        </span>
        <span class="vpc__enter">
          Enter
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 8h11M9.5 3.5 14 8l-4.5 4.5" stroke="currentColor"
                  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </span>
    </button>`).join('');

  const cards = [...root.querySelectorAll('.vpc__card')];

  /* The distance is real, so it is worth putting on the card: it is what makes
     the four views different from one another in the first place. */
  loadEphemeris().then(({ byBody }) => {
    for (const card of cards) {
      const p = byBody[card.dataset.body]?.[POSTER_FRAME];
      if (!p) continue;
      card.querySelector('.vpc__au').textContent = `${p.r.toFixed(2)} AU`;
      card.title = `${card.dataset.body} on ${dateLabel(POSTER_FRAME)}, ${p.r.toFixed(3)} AU from the Sun`;
    }
  }).catch(() => {
    for (const card of cards) card.querySelector('.vpc__au').remove();
  });

  /* --------------------------------------------------------------- tilt */
  const onMove = (e) => {
    const card = e.currentTarget;
    const r = card.getBoundingClientRect();
    // -1..1 from the centre of the card.
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    card.style.setProperty('--rx', `${(-y * TILT).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${(x * TILT).toFixed(2)}deg`);
    // Drives the highlight, so the sheen tracks the pointer across the face.
    card.style.setProperty('--mx', `${(((x + 1) / 2) * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(((y + 1) / 2) * 100).toFixed(1)}%`);
  };
  const onLeave = (e) => {
    const card = e.currentTarget;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
    root.classList.remove('is-hovering');
  };
  const onEnter = () => root.classList.add('is-hovering');
  const onClick = (e) => onSelect?.(e.currentTarget.dataset.body);

  for (const card of cards) {
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('click', onClick);
  }

  return {
    element: root,

    /** Mark the viewpoint you last visited. */
    setSelected(body) {
      for (const c of cards) c.classList.toggle('is-selected', c.dataset.body === body);
    },

    destroy() {
      for (const card of cards) {
        card.removeEventListener('pointermove', onMove);
        card.removeEventListener('pointerenter', onEnter);
        card.removeEventListener('pointerleave', onLeave);
        card.removeEventListener('click', onClick);
      }
      root.remove();
    },
  };
}
