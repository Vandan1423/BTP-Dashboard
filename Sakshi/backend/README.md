# Sakshi's model backend

Serves four trained SEP proton-flux forecasting models (M1 and M3-ML, each
with a no-phase and a phase variant, from the `ProtonFluxTimeSeries` project)
over a small Flask API, so the dashboard's Forecast tab
(`Dashboard/frontend/src/pages/sakshi/`) can run any of them on any date/time
range a visitor picks and get back real predictions -- not just the training
code, the actual `.keras` weights, bundled under `models/`.

**No-phase (`m1_noph`, `m3_mlnoph`)** work on any supported range, historic
or live. **Phase (`m1`, `m3_ml`)** need background/rising/falling as a model
input; those labels are retrospective in the original training data (a row
is only "rising" because a future peak is already known), which is fine for
a *historic* range -- the whole thing, "future" included, is already fetched
-- but impossible for genuinely *live* data. `historic_phases.py`
reconstructs real (not guessed) phase labels for historic ranges the same
way the original training labels were built; `app.py` rejects a phase model
against a live range with a clear error rather than faking it.

## Run it

```bash
cd Sakshi/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://127.0.0.1:5050
```

Then run the dashboard as usual (`cd Dashboard/frontend && npm run dev`) --
the Forecast tab talks to `http://127.0.0.1:5050` by default (see
`VITE_FORECAST_API` in `ForecastSection.js`/`SunEarthScene.js` if you need to
point it elsewhere, e.g. a deployed backend instead of localhost).

## What's here

- `app.py` -- Flask app. `/api/models` lists all four models; `/api/forecast`
  (POST `{model, start, end}`) fetches real SOHO/EPHIN + NOAA GOES data for
  that range, runs the model, and returns the actual/predicted series as
  JSON. Also serves a small standalone HTML UI (`/`) with the same
  functionality, independent of the three.js dashboard.
- `data_fetch.py` -- builds a `(time, electron, electron_high, proton)`
  dataset for an arbitrary range. Historic ranges (through 2020-12-31) come
  from NOAA's archived GOES satellite data (auto-detecting which satellite
  and instrument generation covered that month); live ranges (trailing 7
  days) come from NOAA SWPC's real-time feed. Electrons always come from
  SOHO/EPHIN via `seppy`. 2021 through 7-days-ago is deliberately
  unsupported -- no exact match to the training data's proton definition
  exists there without an uncomfortable approximation.
- `model_eval.py` -- runs a model on that data and scores it (MAE etc).
  Adds phase columns first (via `historic_phases.py`) for the two models
  that need them.
- `historic_phases.py` -- reconstructs background/rising/falling for a
  historic range: finds threshold crossings (>10 pfu), tracks the running
  peak until decay to threshold/5, and approximates onset as background
  mean + 3 standard deviations over a trailing window (the closest
  reconstructable proxy for the original paper's "three times the error bar
  above background" definition, since raw instrument error bars aren't in
  the fetched data). Validated against the real training labels at 99.7%
  row-level agreement -- see `validate_historic_phases.py`.
- `m3ml_utils.py` -- shared inference logic for the M3-ML architecture
  (phase-selection classifier + three specialist regression models).
- `models/` -- the actual trained weights: `m1_noph/model.keras`,
  `m1/model.keras`, and `m3_mlnoph/` + `m3_ml/`, each with
  `{phase_selection,background,rising,falling}_model.keras`. (A third
  architecture, M3-MT, routes on magnitude thresholds calibrated at training
  time that were never saved to disk -- not reconstructable without
  re-running that calibration against the original training set, so it's
  not included here.)
- `evaluate_external.py`, `export_dashboard_event.py` -- reference scripts
  (not used at runtime): how the fixed 2003 event bundled into the frontend
  (`Dashboard/frontend/public/data/sakshi/event_2003.json`) was generated.
- `validate_historic_phases.py` -- reference script (not runnable standalone
  here, needs the original repo's `Data/data.csv`): how `historic_phases.py`
  was validated against the real training labels.
- `cache/` (git-ignored, created on first run) -- downloaded GOES/EPHIN data
  is cached here so repeat requests for the same period don't re-download.

## Why a separate backend at all

The models need Python (TensorFlow/Keras) and live external data fetches
(NOAA, SOHO); none of that belongs in a static Vite/three.js frontend. This
mirrors how Vandan's part works too (`Dashboard/backend/`) -- the dashboard
is a static site that talks to a small local Python service for anything
that needs real computation or data.
