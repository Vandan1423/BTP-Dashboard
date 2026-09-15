/**
 * WHICH CAMERA IS RENDERING, AND HOW FAR IN
 * =========================================
 * A small ring on each planet and a label beside it, drawn in CSS pixels over
 * the scene. This is the render loader, and it is deliberately modest: a ring
 * twenty-two pixels across that fills as the frame renders, a second dashed
 * ring turning outside it while that camera has the GPU, and a tick when the
 * frame is saved.
 *
 * The version before this drew the rings as billboards in world space. They
 * scaled with perspective, so a planet near the camera wore a ring the size of
 * the Sun's orbit, and every label sat on top of somebody else's ring. Pixels
 * do not grow.
 *
 * Label placement is the part worth reading. Each label is pushed out from its
 * planet along the line away from the Sun, which is almost always empty sky --
 * the orbits are concentric, so "outward" is the one direction that never
 * points at another planet's inner orbit. Then a few passes of pairwise
 * repulsion separate any that still overlap, and the result is eased rather
 * than snapped, so labels glide apart instead of jittering as the camera turns.
 */
import { BODY_COLOR } from './Heliosphere.js';
import { damp } from '../../../lib/math.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Circumference of the progress ring, r = 10 in a 32 px box. */
const CIRC = 2 * Math.PI * 10;

/** Clearance kept between labels, and around rings and the Sun. */
const GAP = 8;

export class ViewpointMarkers {
  constructor({ bodies, layer }) {
    this.layer = layer;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'vpm-leaders');
    layer.appendChild(this.svg);

    this.items = new Map(bodies.map((body) => [body, this._build(body)]));
    this.hovered = null;
  }

  _build(body) {
    const color = hex(BODY_COLOR[body]);

    const marker = document.createElement('div');
    marker.className = 'vpm';
    marker.style.setProperty('--vp', color);
    marker.dataset.state = 'off';
    marker.innerHTML = `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle class="vpm__spin" cx="16" cy="16" r="14"/>
        <circle class="vpm__track" cx="16" cy="16" r="10"/>
        <circle class="vpm__arc" cx="16" cy="16" r="10"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        <path class="vpm__tick" d="M11.6 16.3l3 3 5.8-6.2"/>
      </svg>`;

    const label = document.createElement('div');
    label.className = 'vpl';
    label.style.setProperty('--vp', color);
    label.dataset.state = 'off';
    label.innerHTML = `
      <span class="vpl__name">${body}</span>
      <span class="vpl__meta"></span>`;

    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leader.setAttribute('class', 'vpm-leader');
    leader.style.stroke = color;

    this.layer.append(marker, label);
    this.svg.appendChild(leader);

    return {
      body, marker, label, leader,
      arc: marker.querySelector('.vpm__arc'),
      meta: label.querySelector('.vpl__meta'),
      state: 'off', progress: -1, text: '',
      w: 0, h: 0, dirty: true,
      // Eased on-screen position of the label's top-left corner.
      lx: 0, ly: 0, placed: false,
      // Where the planet itself is this frame.
      px: 0, py: 0, visible: false,
    };
  }

  /**
   * @param {string} body
   * @param {{ state: 'off'|'on'|'active'|'done', progress?: number, text?: string }} s
   */
  set(body, { state, progress = 0, text = '' }) {
    const it = this.items.get(body);
    if (!it) return;
    if (it.state !== state) {
      it.state = state;
      it.marker.dataset.state = state;
      it.label.dataset.state = state;
      it.dirty = true;
    }
    if (it.text !== text) {
      it.text = text;
      it.meta.textContent = text;
      it.dirty = true;
    }
    const p = Math.round(progress * 1000) / 1000;
    if (p !== it.progress) {
      it.progress = p;
      it.arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - p)));
    }
  }

  setHovered(body) {
    if (this.hovered === body) return;
    for (const it of this.items.values()) {
      const on = it.body === body;
      it.marker.classList.toggle('is-hover', on);
      it.label.classList.toggle('is-hover', on);
    }
    this.hovered = body;
  }

  /** Nearest visible planet to a screen point, within `radius` pixels. */
  pick(x, y, radius = 24) {
    let best = null;
    let bestD = radius;
    for (const it of this.items.values()) {
      if (!it.visible) continue;
      const d = Math.hypot(it.px - x, it.py - y);
      if (d < bestD) { bestD = d; best = it.body; }
    }
    return best;
  }

  /**
   * Lay everything out for this frame.
   *
   * @param {Map<string,{x,y,visible}>} planets  projected planet positions
   * @param {{x,y}} sun                          projected Sun position
   * @param {number} width
   * @param {number} height
   * @param {{left,right,top,bottom}} bounds     where labels are allowed to go
   * @param {number} reveal                      0..1, the heliosphere's fade
   */
  update(planets, sun, width, height, bounds, reveal, dt) {
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const show = reveal > 0.35;
    this.layer.classList.toggle('is-on', show);
    if (!show) {
      for (const it of this.items.values()) it.placed = false;
      return;
    }

    /* Measure labels only when their text or state changed. Reading layout
       every frame for four elements is cheap, but it is also pointless. */
    for (const it of this.items.values()) {
      if (it.dirty) {
        it.w = it.label.offsetWidth;
        it.h = it.label.offsetHeight;
        it.dirty = false;
      }
    }

    /* 1. The preferred spot: out from the planet, away from the Sun. */
    const boxes = [];
    for (const it of this.items.values()) {
      const p = planets.get(it.body);
      it.visible = !!p?.visible;
      if (!it.visible) continue;
      it.px = p.x;
      it.py = p.y;

      let dx = p.x - sun.x;
      let dy = p.y - sun.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }

      const reach = it.state === 'off' ? 12 : 22;
      const ax = p.x + dx * reach;
      const ay = p.y + dy * reach;
      boxes.push({
        it, dx, dy,
        x: dx >= 0 ? ax + 2 : ax - 2 - it.w,
        y: ay - it.h / 2 + dy * it.h * 0.35,
        w: it.w, h: it.h,
      });
    }

    /* 2. Separate. Obstacles are the Sun and every planet's ring, which labels
       may never cover; other labels are pushed apart evenly. */
    const obstacles = [
      { x: sun.x - 18, y: sun.y - 18, w: 36, h: 36 },
      ...boxes.map((b) => ({ x: b.it.px - 17, y: b.it.py - 17, w: 34, h: 34 })),
    ];
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        for (let j = i + 1; j < boxes.length; j++) separate(a, boxes[j], 0.5);
        for (const o of obstacles) separate(a, o, 1);
      }
    }

    /* 3. Keep inside the frame and out from under the panels. */
    for (const b of boxes) {
      b.x = Math.min(Math.max(b.x, bounds.left), bounds.right - b.w);
      b.y = Math.min(Math.max(b.y, bounds.top), bounds.bottom - b.h);
    }

    /* 4. Ease toward the solution, and draw. */
    for (const it of this.items.values()) {
      const b = boxes.find((x) => x.it === it);
      const on = !!b;
      it.marker.classList.toggle('is-on', on);
      it.label.classList.toggle('is-on', on);
      it.leader.style.opacity = on ? '' : '0';
      if (!on) { it.placed = false; continue; }

      if (!it.placed) { it.lx = b.x; it.ly = b.y; it.placed = true; }
      it.lx = damp(it.lx, b.x, 12, dt);
      it.ly = damp(it.ly, b.y, 12, dt);

      it.marker.style.transform = `translate3d(${it.px.toFixed(1)}px, ${it.py.toFixed(1)}px, 0)`;
      it.label.style.transform = `translate3d(${it.lx.toFixed(1)}px, ${it.ly.toFixed(1)}px, 0)`;

      // The leader runs from the ring's edge to the nearest point on the label.
      const cx = clamp(it.px, it.lx, it.lx + it.w);
      const cy = clamp(it.py, it.ly, it.ly + it.h);
      const vx = cx - it.px;
      const vy = cy - it.py;
      const d = Math.hypot(vx, vy);
      const ring = it.state === 'off' ? 6 : 14;
      if (d <= ring + 4) {
        it.leader.style.opacity = '0';
      } else {
        it.leader.style.opacity = '';
        it.leader.setAttribute('x1', (it.px + (vx / d) * ring).toFixed(1));
        it.leader.setAttribute('y1', (it.py + (vy / d) * ring).toFixed(1));
        it.leader.setAttribute('x2', (cx - (vx / d) * 3).toFixed(1));
        it.leader.setAttribute('y2', (cy - (vy / d) * 3).toFixed(1));
      }
    }
  }

  destroy() {
    for (const it of this.items.values()) {
      it.marker.remove();
      it.label.remove();
    }
    this.svg.remove();
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Push box `a` (and `b`, if it is movable) apart along whichever axis needs the
 * smaller move. `share` is how much of the move `a` takes: 0.5 between two
 * labels, 1 when `b` is an obstacle that does not move.
 */
function separate(a, b, share) {
  const ox = Math.min(a.x + a.w + GAP, b.x + b.w + GAP) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h + GAP, b.y + b.h + GAP) - Math.max(a.y, b.y);
  if (ox <= GAP || oy <= GAP) return;

  const pushX = ox - GAP;
  const pushY = oy - GAP;
  const acx = a.x + a.w / 2, bcx = b.x + b.w / 2;
  const acy = a.y + a.h / 2, bcy = b.y + b.h / 2;

  // Labels are wide and short, so a vertical move is nearly always the smaller
  // and less surprising one. Horizontal only when it is much cheaper.
  if (pushY <= pushX * 1.6) {
    const s = acy <= bcy ? -1 : 1;
    a.y += s * pushY * share;
    if (share < 1) b.y -= s * pushY * (1 - share);
  } else {
    const s = acx <= bcx ? -1 : 1;
    a.x += s * pushX * share;
    if (share < 1) b.x -= s * pushX * (1 - share);
  }
}
