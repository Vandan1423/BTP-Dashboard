/**
 * WATCHING A JOB RUN
 * ==================
 * A render is thirty seconds to ten minutes, so this screen has one job: make
 * the wait legible. Three things do that, and none of them is a spinner.
 *
 *   the countdown   what is left, from the measured cost model, not a guess
 *   the viewpoints  which one is on the GPU right now, and how far in
 *   the log         the lines the pipeline scripts actually print
 *
 * The viewpoints run one at a time. That is not an implementation shortcut --
 * the A30 is shared and has already been OOM'd once by another user holding
 * 22.6 GB, and four Cycles processes at once is the single most reliable way
 * to fail in front of an examiner.
 */
import { duration } from './cost.js';
import { BODY_COLOR } from './Heliosphere.js';
import { SIM_SPEED } from './api.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** How many lines of log are kept in the DOM. Older ones scroll out of life. */
const LOG_CAP = 120;

/**
 * @param {object} opts
 * @param {boolean} opts.live     a real render service, or the simulator
 * @param {string} [opts.label]   where the service is: "this Mac · Metal"
 * @param {string} [opts.reason]  why the simulator is being used
 */
export function createJobMonitor({ jobId, bodies, live, label, reason, onCancel }) {
  const el = document.createElement('div');
  el.className = 'ppanel__inner pmon';
  el.innerHTML = `
    <span class="ppanel__eyebrow">
      <span class="pmon__live" data-live="${live}"></span>
      ${live ? `Rendering on ${label}` : 'Simulated locally'}
    </span>
    <h1 class="ppanel__title" data-title>Working</h1>

    ${live ? '' : `
      <p class="pbanner">
        Nothing is being rendered: ${reason || 'no render service answered'}.
        The job is played out against the measured cost model instead, the setup
        steps at a few times real speed and the render at about ${SIM_SPEED}×.
        Every time quoted below is the real one. The frames are this pipeline's
        own archived renders of that timestep, and an uploaded file is not read.
      </p>`}

    <div class="pclock">
      <div class="pclock__ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="pclock__track" cx="60" cy="60" r="52"/>
          <circle class="pclock__fill" cx="60" cy="60" r="52"/>
        </svg>
        <span class="pclock__pct" data-pct>0%</span>
      </div>
      <div class="pclock__read">
        <span class="pclock__big" data-eta>—</span>
        <span class="pclock__sub">remaining · <span data-elapsed>0 s</span> elapsed</span>
        <span class="pclock__job">job ${jobId}</span>
      </div>
    </div>

    <ul class="pvplist">
      ${bodies.map((b) => `
        <li class="pvprow" data-body="${b}" data-state="queued" style="--vp:${hex(BODY_COLOR[b])}">
          <span class="pvprow__dot"></span>
          <span class="pvprow__name">${b}</span>
          <span class="pvprow__state">queued</span>
          <span class="pvprow__track"><i></i></span>
        </li>`).join('')}
    </ul>

    <div class="plog">
      <div class="plog__head">
        <span>Worker log</span>
        <span class="plog__count" data-count>0 lines</span>
      </div>
      <pre class="plog__body" data-log></pre>
    </div>

    <p class="pbanner pmon__offline" hidden>
      The render service is not answering right now. Still trying; a render that
      has started carries on over there whether this page can see it or not.
    </p>

    <ul class="pwarn" hidden></ul>

    <button class="pbtn pbtn--quiet pmon__cancel" type="button">Cancel the job</button>`;

  const etaEl = el.querySelector('[data-eta]');
  const elapsedEl = el.querySelector('[data-elapsed]');
  const pctEl = el.querySelector('[data-pct]');
  const fillEl = el.querySelector('.pclock__fill');
  const logEl = el.querySelector('[data-log]');
  const countEl = el.querySelector('[data-count]');
  const cancelBtn = el.querySelector('.pmon__cancel');
  const rows = new Map(bodies.map((b) => [b, el.querySelector(`.pvprow[data-body="${b}"]`)]));

  // The ring is one stroked circle; the dash pattern is the progress.
  const CIRC = 2 * Math.PI * 52;
  fillEl.style.strokeDasharray = `${CIRC}`;
  fillEl.style.strokeDashoffset = `${CIRC}`;

  let lastLogKey = '';
  const titleEl = el.querySelector('[data-title]');
  const warnEl = el.querySelector('.pwarn');
  let lastWarnings = '';

  const onCancelClick = () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling…';
    onCancel?.();
  };
  cancelBtn.addEventListener('click', onCancelClick);

  const jobEl = el.querySelector('.pclock__job');

  return {
    element: el,

    setOffline(on) { el.querySelector('.pmon__offline').hidden = !on; },

    /** The id only exists once the service has accepted the upload. */
    setJobId(id) { jobEl.textContent = `job ${id}`; },

    /** @param {object} snap the poll response */
    update(snap) {
      const total = snap.plan?.total ?? 1;
      const done = Math.max(0, Math.min(1, (snap.elapsed ?? 0) / total));

      pctEl.textContent = `${Math.round(done * 100)}%`;
      fillEl.style.strokeDashoffset = `${CIRC * (1 - done)}`;
      elapsedEl.textContent = duration(snap.elapsed ?? 0);

      // Waiting behind someone else's render is not the same as working, and
      // on a shared GPU it can be the longer of the two.
      if (snap.status === 'queued') {
        const ahead = snap.queue_position ?? 0;
        titleEl.textContent = 'Queued';
        etaEl.textContent = ahead ? `${ahead} ahead` : 'starting';
      } else {
        titleEl.textContent = 'Working';
        etaEl.textContent = snap.status === 'done' ? 'done' : duration(snap.eta_s ?? 0);
      }

      const warnings = snap.warnings ?? [];
      const warnKey = warnings.join('|');
      if (warnKey !== lastWarnings) {
        lastWarnings = warnKey;
        warnEl.hidden = warnings.length === 0;
        warnEl.replaceChildren(...warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
      }

      for (const v of snap.viewpoints ?? []) {
        const row = rows.get(v.body);
        if (!row) continue;
        row.dataset.state = v.status;
        row.querySelector('.pvprow__state').textContent =
          v.status === 'done' ? duration(v.seconds)
          : v.status === 'rendering' ? `${Math.round(v.progress * 100)}%`
          : 'queued';
        row.querySelector('.pvprow__track i').style.transform = `scaleX(${v.progress.toFixed(3)})`;
      }

      // The service sends its last two hundred lines, so once a log is long its
      // length stops changing; the newest line is what says it moved.
      const log = snap.log ?? [];
      const logKey = `${log.length}|${log[log.length - 1]?.text ?? ''}`;
      if (logKey !== lastLogKey) {
        lastLogKey = logKey;
        const shown = log.slice(-LOG_CAP);
        logEl.textContent = shown.map((l) => l.text).join('\n');
        countEl.textContent = `${log.length} line${log.length === 1 ? '' : 's'}`;
        logEl.scrollTop = logEl.scrollHeight;
      }
    },

    destroy() {
      cancelBtn.removeEventListener('click', onCancelClick);
      el.remove();
    },
  };
}

/**
 * A job that failed. The error is the service's own message -- a file with no
 * tr1 field, Blender exiting, a timestep that is not on this machine -- and the
 * last lines of the log sit under it, because "failed" alone helps nobody.
 */
export function createJobFailure({ error, log = [], canRetry, onRetry, onReset }) {
  const el = document.createElement('div');
  el.className = 'ppanel__inner pfail';
  el.innerHTML = `
    <span class="ppanel__eyebrow"><span class="pmon__live" data-live="false"></span>Job failed</span>
    <h1 class="ppanel__title">The render did not finish</h1>
    <p class="pfail__msg"></p>
    <div class="plog">
      <div class="plog__head"><span>Last lines of the log</span></div>
      <pre class="plog__body"></pre>
    </div>
    <div class="pres__acts">
      <button class="pbtn pbtn--go pfail__retry" type="button" ${canRetry ? '' : 'disabled'}>
        <span class="pbtn__label">Try again</span>
      </button>
      <button class="pbtn pbtn--quiet pfail__reset" type="button">Start another file</button>
    </div>`;
  el.querySelector('.pfail__msg').textContent = error || 'The service reported a failure without a message.';
  el.querySelector('.plog__body').textContent = log.slice(-14).map((l) => l.text).join('\n');

  const retry = el.querySelector('.pfail__retry');
  const reset = el.querySelector('.pfail__reset');
  const onRetryClick = () => onRetry?.();
  const onResetClick = () => onReset?.();
  retry.addEventListener('click', onRetryClick);
  reset.addEventListener('click', onResetClick);

  return {
    element: el,
    destroy() {
      retry.removeEventListener('click', onRetryClick);
      reset.removeEventListener('click', onResetClick);
      el.remove();
    },
  };
}
