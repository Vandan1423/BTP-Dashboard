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
    │                      supported range, across three date-based regimes —
    │                      ACE/EPAM (up to 2023-09-10), Aditya-L1/ASPEX (from
    │                      2023-09-10, auto-fetched from PRADAN if you have an
    │                      account), and live NOAA GOES (trailing 7 days)
    ├── ace_epam_data.py   loads ACE/EPAM's P8 proton channel (yearly HDF4 files
    │                      from the ACE Science Center) for the pre-Aditya regime
    ├── aditya_l1/         Aditya-L1/ASPEX-STEPS data + fetch pipeline
    │   ├── fetch_aditya_pradan.py  scripted PRADAN login (Keycloak OAuth2, no
    │   │                          CAPTCHA) + deterministic CDF download, given
    │   │                          your own PRADAN_USERNAME/PRADAN_PASSWORD
    │   ├── build_aditya_data.py   turns downloaded STEPS L2 CDFs into a proton
    │   │                          series (PS direction, Inner detector, highest
    │   │                          energy bin -- see its docstring for why)
    │   ├── raw/                   downloaded CDFs, cached here (git-tracked)
    │   └── data_2024_may_aspex.csv  pre-built window (2024-05-11..16, Gannon
    │                                storm) so that range works with no PRADAN
    │                                account at all
    ├── historic_phases.py reconstructs background/rising/falling for any
    │                      fully-known-in-advance range (99.7% agreement with
    │                      real training labels) — what makes the phase-input
    │                      models usable at all outside the original training
    │                      window
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
    └── cache/              (git-ignored) downloaded EPHIN/EPAM data, so
                            repeat requests for the same period don't re-fetch
                            (GOES's live feed isn't cached -- it's always "now")
```

**Model picker, two steps.** Pick a family — M1, M3-ML, Posner, or Persistent —
then, only for M1/M3-ML, whether to use phase (background/rising/falling) input.
Posner and Persistent have no phase concept, so that control disappears for them.

**Phase input works on any fully-known-in-advance range** — ACE/EPAM (up to
2023-09-10) and Aditya-L1 (2023-09-10 onward) both qualify, since the whole
range, "future" included, is already fetched by the time `historic_phases.py`
reconstructs labels for it. It's specifically **live ranges** (trailing 7
days) where phase input is impossible: the labels are retrospective (a row is
only "rising" because a future peak is already known), and for a live range
that future genuinely hasn't happened yet. `app.py` rejects a phase model
against a live range with a clear error rather than faking it. No-phase
models and both baselines work on all three regimes, including live.

See `backend/README.md` for exact run commands and the full validation numbers
behind each model.
