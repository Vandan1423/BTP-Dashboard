/**
 * THE FORECAST SECTION
 * ====================
 * Two steps, never shown at once: a form (pick a date/time range and a
 * model), and the result (the Sun-to-Earth scene for that range, built by
 * SunEarthScene.js). Submitting the form calls the Flask API added
 * alongside the local analysis webapp (analysis/webapp/app.py in the
 * ProtonFluxTimeSeries repo -- `/api/models`, `/api/forecast`,
 * `model_eval.py`'s `evaluate_series`), then swaps the form out for the
 * scene. "New forecast" swaps back. Run the API locally:
 *   cd ElectronInput/analysis/webapp && ../../../.venv/bin/python app.py
 *
 * There is no default/example event loaded on open -- the form is the only
 * way in, and nothing renders until you run it.
 */
import { createSunEarthScene, applySunEarthSpan } from './SunEarthScene.js';
import './forecast.css';

const API_BASE = import.meta.env.VITE_FORECAST_API ?? 'http://127.0.0.1:5050';

// One format everywhere in this section: ISO date (YYYY-MM-DD) + 24h clock
// (HH:MM), always labeled UTC, never AM/PM and never a browser-locale-
// dependent native datetime-local picker (which renders differently, and
// often in 12h AM/PM, depending on the viewer's OS/browser locale).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const fmtDate = (d) => d.toISOString().slice(0, 10);
const fmtTime = (d) => d.toISOString().slice(11, 16);

export function createForecastSection({ stage }) {
  const now = new Date();
  const liveFloor = new Date(now.getTime() - 7 * 86400000);
  const adityaStart = new Date('2023-09-10');

  const element = document.createElement('div');
  element.className = 'fform-wrap';

  let activeScene = null;
  let families = [];
  let familyId = null;
  let phaseOn = false;
  let stopFormSpan = null;

  // The id actually sent to /api/forecast: for M1/M3-ML it depends on the phase
  // toggle; Posner/Persistent are single models with no phase concept at all.
  function resolveModelId() {
    const fam = families.find((f) => f.id === familyId);
    if (!fam) return null;
    return fam.has_phase_variant ? (phaseOn ? fam.phase_id : fam.no_phase_id) : fam.model_id;
  }

  function showForm() {
    activeScene?.destroy();
    activeScene = null;
    stopFormSpan?.();
    element.innerHTML = `
      <div class="fform">
        <form class="fform__form">
          <div class="fform__row">
            <div class="fform__field fform__field--date">
              <label for="fstart-date">Start date (UTC)</label>
              <input id="fstart-date" class="fform__dt" type="text" inputmode="numeric"
                     placeholder="YYYY-MM-DD" pattern="\\d{4}-\\d{2}-\\d{2}" maxlength="10" required>
            </div>
            <div class="fform__field fform__field--time">
              <label for="fstart-time">Start time (UTC, 24h)</label>
              <input id="fstart-time" class="fform__dt" type="text" inputmode="numeric"
                     placeholder="HH:MM" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" required>
            </div>
            <div class="fform__field fform__field--date">
              <label for="fend-date">End date (UTC)</label>
              <input id="fend-date" class="fform__dt" type="text" inputmode="numeric"
                     placeholder="YYYY-MM-DD" pattern="\\d{4}-\\d{2}-\\d{2}" maxlength="10" required>
            </div>
            <div class="fform__field fform__field--time">
              <label for="fend-time">End time (UTC, 24h)</label>
              <input id="fend-time" class="fform__dt" type="text" inputmode="numeric"
                     placeholder="HH:MM" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" required>
            </div>
          </div>
          <div class="fform__row">
            <div class="fform__field fform__field--model">
              <label>Model</label>
              <div class="fform__models"></div>
            </div>
            <div class="fform__field fform__field--phase" hidden>
              <label>Phase input</label>
              <div class="fform__phase"></div>
            </div>
            <button class="fform__run" type="submit">Run</button>
          </div>
        </form>
        <p class="fform__hint">
          Supported, by date range and satellite:
          <br>&bull; up to ${fmtDate(adityaStart)}: <strong>NASA&nbsp;ACE</strong> (EPAM instrument, P8 channel proxy)
          <br>&bull; ${fmtDate(adityaStart)} .. ${fmtDate(liveFloor)}: <strong>ISRO&nbsp;Aditya-L1</strong> (ASPEX/STEPS, only for already-downloaded windows)
          <br>&bull; ${fmtDate(liveFloor)} .. ${fmtDate(now)}: <strong>NOAA&nbsp;GOES</strong> (live, last 7 days)
          <br>Electrons are always SOHO/EPHIN. A range can't straddle two of these.
          Phase inputs (M1/M3-ML) work on either of the first two (the future they rely on
          is already known) -- just not on a live range.
        </p>
        <div class="fform__status" hidden></div>
      </div>`;

    stopFormSpan = applySunEarthSpan(element.querySelector('.fform'));

    const form = element.querySelector('.fform__form');
    const startDateInput = element.querySelector('#fstart-date');
    const startTimeInput = element.querySelector('#fstart-time');
    const endDateInput = element.querySelector('#fend-date');
    const endTimeInput = element.querySelector('#fend-time');
    const modelsWrap = element.querySelector('.fform__models');
    const phaseField = element.querySelector('.fform__field--phase');
    const phaseWrap = element.querySelector('.fform__phase');
    const runBtn = element.querySelector('.fform__run');
    const statusEl = element.querySelector('.fform__status');

    // Defaults: the last 12 hours of the live-supported window, so the form
    // opens on something that will actually run rather than an empty picker.
    const defaultStart = new Date(now.getTime() - 12 * 3600000);
    endDateInput.value = fmtDate(now);
    endTimeInput.value = fmtTime(now);
    startDateInput.value = fmtDate(defaultStart);
    startTimeInput.value = fmtTime(defaultStart);

    function renderPhaseToggle() {
      const fam = families.find((f) => f.id === familyId);
      if (!fam || !fam.has_phase_variant) {
        phaseField.hidden = true;
        return;
      }
      phaseField.hidden = false;
      phaseWrap.innerHTML = `
        <label class="fform__model">
          <input type="radio" name="fphase" value="0" ${!phaseOn ? 'checked' : ''}>
          <span>No phase</span>
        </label>
        <label class="fform__model">
          <input type="radio" name="fphase" value="1" ${phaseOn ? 'checked' : ''}>
          <span>With phase</span>
        </label>`;
      for (const r of phaseWrap.querySelectorAll('input')) {
        r.addEventListener('change', () => { phaseOn = r.value === '1'; });
      }
    }

    fetch(`${API_BASE}/api/models`).then((r) => r.json()).then(({ families: fams }) => {
      families = fams;
      familyId = fams[0]?.id ?? null;
      phaseOn = false;
      modelsWrap.innerHTML = fams.map((f, i) => `
        <label class="fform__model">
          <input type="radio" name="ffamily" value="${f.id}" ${i === 0 ? 'checked' : ''}>
          <span>${f.label}</span>
        </label>`).join('');
      for (const r of modelsWrap.querySelectorAll('input')) {
        r.addEventListener('change', () => {
          familyId = r.value;
          phaseOn = false;
          renderPhaseToggle();
        });
      }
      renderPhaseToggle();
    }).catch(() => {
      modelsWrap.innerHTML = `<p class="fform__error">Could not reach the forecast API at ${API_BASE}.</p>`;
    });

    const setStatus = (text, isError = false) => {
      statusEl.hidden = !text;
      statusEl.textContent = text || '';
      statusEl.classList.toggle('is-error', isError);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const modelId = resolveModelId();
      if (!modelId) { setStatus('No model selected.', true); return; }
      const startDate = startDateInput.value.trim(), startTime = startTimeInput.value.trim();
      const endDate = endDateInput.value.trim(), endTime = endTimeInput.value.trim();
      if (!startDate || !startTime || !endDate || !endTime) {
        setStatus('Pick both a start and end date/time.', true); return;
      }
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        setStatus('Dates must be in YYYY-MM-DD format.', true); return;
      }
      if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
        setStatus('Times must be in 24h HH:MM format (UTC).', true); return;
      }
      const start = `${startDate}T${startTime}`, end = `${endDate}T${endTime}`;

      runBtn.disabled = true;
      setStatus('Fetching data and running the model…');

      try {
        const res = await fetch(`${API_BASE}/api/forecast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, start, end }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        showResult(json, start, end);
      } catch (err) {
        setStatus(err.message || String(err), true);
        runBtn.disabled = false;
      }
    });
  }

  function toSceneData(json) {
    const rows = json.times.map((t, i) => ({
      t, e: json.electron[i], eh: json.electron_high[i], p: json.proton[i], pred: json.predicted[i],
    }));
    return { label: json.label, pt_minutes: 30, ln10_threshold: json.ln10_threshold, cadence_minutes: 5, rows };
  }

  function showResult(json, start, end) {
    stopFormSpan?.();
    stopFormSpan = null;
    element.innerHTML = '';

    const m = json.metrics;
    const subtitle =
      `${json.label}  |  ${start.replace('T', ' ')} → ${end.replace('T', ' ')} UTC  |  ` +
      `MAE ${m.mae.toFixed(3)}` +
      (m.mae_event != null ? `  (event MAE ${m.mae_event.toFixed(3)}, n=${m.n_event})` : '') +
      `  |  source: ${json.source_kind}`;

    activeScene = createSunEarthScene({
      stage, data: toSceneData(json), subtitle, onBack: showForm,
    });
    element.appendChild(activeScene.element);
  }

  showForm();

  return {
    element,
    destroy() {
      activeScene?.destroy();
      activeScene = null;
      stopFormSpan?.();
      stopFormSpan = null;
    },
  };
}
