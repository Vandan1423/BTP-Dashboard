# Sakshi — SEP Proton Flux Forecasting

Relativistic electrons outrun the protons that follow them — a real head start
that neural networks (M1, M3-MT, M3-ML) trained on SOHO/EPHIN electron and proton
measurements learn to exploit, forecasting >10 MeV proton flux 30–60 minutes
ahead. Validated on the held-out 2000–2002 test set, a real 2003 SEP event, a
real 2017 event, and a live event that occurred during this project — none seen
during training.

```
Sakshi/
├── README.md              this file
├── INTEGRATION_NOTES.md   research pass into Dashboard/frontend/ done before
│                          building the forecast page (historical — the page
│                          it planned is now built; kept for reference)
│
└── backend/               the model-serving Flask API — self-contained,
    │                      doesn't need the ProtonFluxTimeSeries repo present
    ├── app.py             /api/models, /api/forecast, standalone HTML UI at /
    ├── model_eval.py      runs a chosen model on a fetched date range, scores it
    ├── data_fetch.py      builds (time, electron, electron_high, proton) for any
    │                      supported range — historic (NOAA GOES archive) or live
    │                      (NOAA SWPC), auto-handling the GOES EPS/EPEAD format
    │                      split across satellite generations
    ├── historic_phases.py reconstructs background/rising/falling for historic
    │                      ranges (99.7% agreement with real training labels) —
    │                      what makes the phase-input models usable at all outside
    │                      the original training window
    ├── m3ml_utils.py      shared inference for the M3-ML architecture
    │                      (phase-selection classifier + 3 specialist regressors)
    ├── requirements.txt
    ├── models/             trained/fit artifacts, <700 KB bundled total
    │   ├── m1_noph/        M1, no phase input — single global GRU regressor
    │   ├── m1/             M1, with phase input
    │   ├── m3_mlnoph/      M3-ML, no phase — phase-classifier + 3 specialists
    │   ├── m3_ml/          M3-ML, with phase input
    │   └── posner/         Posner (2007) — frozen 18×13 lookup table, fit
    │                       once from the training split (bit-identical to a
    │                       fresh fit); Persistent needs no artifact at all
    ├── templates/, static/ the standalone webapp UI (independent of the
    │                       three.js dashboard — useful for quick local checks)
    └── cache/              (git-ignored) downloaded GOES/EPHIN data, so
                            repeat requests for the same period don't re-fetch
```

**Model picker, two steps.** Pick a family — M1, M3-ML, Posner, or Persistent —
then, only for M1/M3-ML, whether to use phase (background/rising/falling) input.
Posner and Persistent have no phase concept, so that control disappears for them.

**Phase input only works on historic ranges** (any period ending on/before
2020-12-31). The labels are retrospective — a row is only "rising" because a
future peak is already known — which `historic_phases.py` can reconstruct
honestly for historic data (the "future" is already sitting in the fetched
range) but not for a live stream, where it hasn't happened yet. No-phase models
and both baselines work on live ranges (trailing 7 days) too, in principle —
live fetching currently hits an unrelated SEPpy library bug (`cs_e300`), a
pre-existing issue in the fetch path itself, not specific to any one model.

See `backend/README.md` for exact run commands and the full validation numbers
behind each model.
