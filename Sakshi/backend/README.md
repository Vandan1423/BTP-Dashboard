# Sakshi's model backend

Serves six trained/fit SEP proton-flux forecasting models -- M1 and M3-ML
(each with a no-phase and a phase variant), plus the Posner (2007) and
Persistent baselines, all from the `ProtonFluxTimeSeries` project -- over a
small Flask API, so the dashboard's Forecast tab
(`Dashboard/frontend/src/pages/sakshi/`) can run any of them on any date/time
range a visitor picks and get back real predictions -- not just the training
code, the actual `.keras` weights (and Posner's frozen lookup table), bundled
under `models/`.

**No-phase (`m1_noph`, `m3_mlnoph`) and both baselines (`posner`,
`persistent`)** work on any supported range, including live. **Phase (`m1`,
`m3_ml`)** need background/rising/falling as a model input; those labels are
retrospective in the original training data (a row is only "rising" because
a future peak is already known), which is fine for any range that's fully
known in advance -- ACE/EPAM or Aditya-L1, both of which have the whole
range, "future" included, already fetched by the time labels are built -- but
impossible for genuinely *live* data. `historic_phases.py` reconstructs real
(not guessed) phase labels the same way the original training labels were
built; `app.py` rejects a phase model against a live range with a clear error
rather than faking it.

## Run it

```bash
cd Sakshi/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://127.0.0.1:5050
```

Optional: set `PRADAN_USERNAME`/`PRADAN_PASSWORD` (your own PRADAN account)
before starting the server to enable auto-fetching Aditya-L1 data for dates
beyond the pre-built 2024-05 window. Without them, Aditya-L1 ranges outside
that window return a clear error instead of silently failing.

Then run the dashboard as usual (`cd Dashboard/frontend && npm run dev`) --
the Forecast tab talks to `http://127.0.0.1:5050` by default (see
`VITE_FORECAST_API` in `ForecastSection.js`/`SunEarthScene.js` if you need to
point it elsewhere, e.g. a deployed backend instead of localhost).

## What's here

- `app.py` -- Flask app. `/api/models` lists all six models (grouped into
  four families for the UI's two-step picker); `/api/forecast`
  (POST `{model, start, end}`) fetches real electron/proton data for
  that range, runs the model, and returns the actual/predicted series as
  JSON. Also serves a small standalone HTML UI (`/`) with the same
  functionality, independent of the three.js dashboard.
- `data_fetch.py` -- builds a `(time, electron, electron_high, proton)`
  dataset for an arbitrary range, across three date-based regimes:
  - **epam** (up to 2023-09-10): ACE/EPAM's P8 proton channel, via
    `ace_epam_data.py` -- used uniformly for the whole pre-Aditya span,
    including years where NOAA GOES's own archive would have been a cleaner
    match, so every historic range uses one consistent L1 proton source
    instead of switching sources mid-span. Not a clean match to the
    training data's proton definition -- see that module's docstring for
    the energy-band/calibration/shot-noise caveats.
  - **aditya** (2023-09-10 onward): Aditya-L1/ASPEX-STEPS. Checks
    already-downloaded local data in `aditya_l1/` first; if nothing covers
    the window and `PRADAN_USERNAME`/`PRADAN_PASSWORD` are set in this
    process's environment, auto-fetches the missing STEPS L2 CDFs from
    ISRO's PRADAN portal (`aditya_l1/fetch_aditya_pradan.py`) and builds the
    proton series on the spot. Without those env vars, falls back to a
    clear "download it yourself" error.
  - **live** (trailing 7 days): NOAA SWPC's real-time GOES feed. Deliberately
    kept on GOES rather than EPAM/Aditya-L1 -- Aditya-L1 can't serve live
    data at all (same PRADAN login gate), and EPAM's real-time feed has its
    own shot-noise and long-term-availability problems.

  Electrons always come from SOHO/EPHIN via `seppy`, across all three
  regimes. Note: `seppy`'s loader crashes with an unrelated `UnboundLocalError`
  (`cs_e300`) when no EPHIN file exists yet for a requested date (near-real-time
  EPHIN typically lags 1-2 days behind "now") -- `fetch_ephin()` catches this
  and raises a clear, actionable error instead of surfacing seppy's internals.
- `model_eval.py` -- runs a model on that data and scores it (MAE etc).
  Adds phase columns first (via `historic_phases.py`) for the two model
  families that need them; runs Posner/Persistent directly off the raw
  electron/proton series, no phase step involved.
- `historic_phases.py` -- reconstructs background/rising/falling for any
  fully-known-in-advance range (epam or aditya, not live): finds threshold
  crossings (>10 pfu equivalent), tracks the running peak until decay to
  threshold/5, and approximates onset as background mean + 3 standard
  deviations over a trailing window (the closest reconstructable proxy for
  the original paper's "three times the error bar above background"
  definition, since raw instrument error bars aren't in the fetched data).
  Validated against the real training labels at 99.7% row-level agreement --
  see `validate_historic_phases.py`.
- `ace_epam_data.py` -- vendored copy of `ProtonFluxTimeSeries/ace_epam/
  build_epam_data.py`. Downloads/caches ACE/EPAM's yearly 5-minute HDF4
  files from the ACE Science Center and extracts the P8 proton channel
  (1.88-4.7 MeV) for the `epam` regime.
- `aditya_l1/` -- Aditya-L1/ASPEX-STEPS data and fetch pipeline:
  `fetch_aditya_pradan.py` (scripted PRADAN login + deterministic CDF
  download, needs your own `PRADAN_USERNAME`/`PRADAN_PASSWORD`),
  `build_aditya_data.py` (CDF -> proton series, PS direction/Inner
  detector/highest energy bin), `raw/` (downloaded CDFs, cached), and
  `data_2024_may_aspex.csv` (a pre-built window so the Gannon-storm period
  works with no PRADAN account needed).
- `m3ml_utils.py` -- shared inference logic for the M3-ML architecture
  (phase-selection classifier + three specialist regression models).
- `models/` -- the actual trained/fit artifacts: `m1_noph/model.keras`,
  `m1/model.keras`, `m3_mlnoph/` + `m3_ml/` (each with
  `{phase_selection,background,rising,falling}_model.keras`), and
  `posner/posner_matrix.json` (a frozen 18x13 lookup table, fit once from
  the training split). Persistent needs no artifact at all -- it just
  returns each window's own last proton value. (A third architecture,
  M3-MT, routes on magnitude thresholds calibrated at training time that
  were never saved to disk -- not reconstructable without re-running that
  calibration against the original training set, so it's not included
  here.)
- `evaluate_external.py`, `export_dashboard_event.py` -- reference scripts
  (not used at runtime): how the fixed 2003 event bundled into the frontend
  (`Dashboard/frontend/public/data/sakshi/event_2003.json`) was generated.
- `validate_historic_phases.py` -- reference script (not runnable standalone
  here, needs the original repo's `Data/data.csv`): how `historic_phases.py`
  was validated against the real training labels.
- `cache/` (git-ignored, created on first run) -- downloaded EPHIN and EPAM
  data is cached here (`cache/ephin/`, `cache/epam/`) so repeat requests for
  the same period don't re-download. GOES's live feed isn't cached -- it's
  re-fetched fresh every request, since it's always "now".

## Why a separate backend at all

The models need Python (TensorFlow/Keras) and live external data fetches
(NOAA, SOHO); none of that belongs in a static Vite/three.js frontend. This
mirrors how Vandan's part works too (`Dashboard/backend/`) -- the dashboard
is a static site that talks to a small local Python service for anything
that needs real computation or data.
