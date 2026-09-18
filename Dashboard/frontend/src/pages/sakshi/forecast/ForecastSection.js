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
import { createSunEarthScene } from './SunEarthScene.js';
import './forecast.css';

const API_BASE = import.meta.env.VITE_FORECAST_API ?? 'http://127.0.0.1:5050';

export function createForecastSection({ stage }) {
  const now = new Date();
  const liveFloor = new Date(now.getTime() - 7 * 86400000);
  const toLocalInput = (d) => d.toISOString().slice(0, 16);

  const element = document.createElement('div');
  element.className = 'fform-wrap';

  let activeScene = null;
  let modelId = null;

  function showForm() {
    activeScene?.destroy();
    activeScene = null;
    element.innerHTML = `
      <div class="fform">
        <form class="fform__form">
          <div class="fform__row">
            <div class="fform__field">
              <label for="fstart">Start (UTC)</label>
              <input id="fstart" type="datetime-local" step="300" required>
            </div>
            <div class="fform__field">
              <label for="fend">End (UTC)</label>
              <input id="fend" type="datetime-local" step="300" required>
            </div>
          </div>
          <div class="fform__row">
            <div class="fform__field fform__field--model">
              <label>Model</label>
              <div class="fform__models"></div>
            </div>
            <button class="fform__run" type="submit">Run</button>
          </div>
        </form>
        <p class="fform__hint">
          Supported: any range ending on/before 2020-12-31, or within the last 7 days
          (${liveFloor.toISOString().slice(0, 10)} .. ${now.toISOString().slice(0, 10)}).
          2021 through ${liveFloor.toISOString().slice(0, 10)} is not supported (no exact
          &gt;10&nbsp;MeV integral proton channel available there).
        </p>
        <div class="fform__status" hidden></div>
      </div>`;

    const form = element.querySelector('.fform__form');
    const startInput = element.querySelector('#fstart');
    const endInput = element.querySelector('#fend');
    const modelsWrap = element.querySelector('.fform__models');
    const runBtn = element.querySelector('.fform__run');
    const statusEl = element.querySelector('.fform__status');

    // Defaults: the last 12 hours of the live-supported window, so the form
    // opens on something that will actually run rather than an empty picker.
    endInput.value = toLocalInput(now);
    startInput.value = toLocalInput(new Date(now.getTime() - 12 * 3600000));

    fetch(`${API_BASE}/api/models`).then((r) => r.json()).then((models) => {
      modelsWrap.innerHTML = models.map((m, i) => `
        <label class="fform__model">
          <input type="radio" name="fmodel" value="${m.id}" ${i === 0 ? 'checked' : ''}>
          <span>${m.label}</span>
        </label>`).join('');
      modelId = models[0]?.id ?? null;
      for (const r of modelsWrap.querySelectorAll('input')) {
        r.addEventListener('change', () => { modelId = r.value; });
      }
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
      if (!modelId) { setStatus('No model selected.', true); return; }
      const start = startInput.value, end = endInput.value;
      if (!start || !end) { setStatus('Pick both a start and end time.', true); return; }

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
    },
  };
}
