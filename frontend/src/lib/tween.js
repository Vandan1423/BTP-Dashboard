/**
 * A tiny tween runner.
 *
 * Pages own one of these and step it from their frame callback, so tweens are
 * tied to the same clock as the scene and pause with it. No timers, nothing to
 * leak when a page unmounts.
 *
 *   const tl = new Timeline();
 *   tl.add({ from: 0, to: 1, dur: 1.2, onUpdate: v => field.uniforms.uMorph.value = v });
 *   // in onFrame: tl.update(dt);
 */
import { easeOutCubic } from './math.js';

export class Timeline {
  constructor() { this.items = []; }

  /**
   * @param {number} from
   * @param {number} to
   * @param {number} dur      seconds
   * @param {number} [delay]  seconds before it starts
   * @param {function} [ease]
   * @param {function} onUpdate  receives the eased value
   * @param {function} [onDone]
   */
  add({ from, to, dur, delay = 0, ease = easeOutCubic, onUpdate, onDone }) {
    this.items.push({ from, to, dur, delay, ease, onUpdate, onDone, t: 0, started: false });
    return this;
  }

  /** Runs `fn` once, `delay` seconds from now. */
  at(delay, fn) {
    return this.add({ from: 0, to: 1, dur: 0.0001, delay, onUpdate: () => {}, onDone: fn });
  }

  clear() { this.items.length = 0; }

  get idle() { return this.items.length === 0; }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const local = it.t - it.delay;
      if (local < 0) continue;

      const k = Math.min(1, local / it.dur);
      it.onUpdate(it.from + (it.to - it.from) * it.ease(k));

      if (k >= 1) {
        this.items.splice(i, 1);
        it.onDone?.();
      }
    }
  }
}
