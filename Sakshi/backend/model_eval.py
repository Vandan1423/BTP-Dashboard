"""
Runs a chosen model on a fetched DataFrame, scoring only the rows whose target time
falls inside the user's requested [start, end] window (the extra buffer rows before
`start` exist purely so those early targets have a full 24-step input window to draw
on -- they are never themselves scored or plotted as predictions).

Two families of model:
  - no-phase (m1_noph, m3_mlnoph): usable on ANY supported range, historic or live.
  - phase (m1, m3_ml): need background/rising/falling as an input feature. The
    original labels are retrospective (a row is "rising" only because a future peak
    is already known), so these are only usable on `historic` data, where the whole
    range -- including what's "in the future" relative to any point in it -- is
    already fetched and known. historic_phases.add_historic_phases() reconstructs
    those labels from the fetched data itself (validated at 99.7% row-level
    agreement against the real training labels; see
    analysis/validate_historic_phases.py). app.py rejects a phase model against a
    `live` range before ever calling in here.
"""
import os
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["font.family"] = "sans-serif"
matplotlib.rcParams["font.sans-serif"] = ["Helvetica", "Arial", "DejaVu Sans"]
matplotlib.rcParams["axes.unicode_minus"] = False
import matplotlib.pyplot as plt
from keras.models import load_model

from m3ml_utils import load_m3ml_models, predict_m3ml
from historic_phases import add_historic_phases

HERE = os.path.dirname(__file__)
LN10 = np.log(10)

MODEL_CONFIGS = {
    "m1_noph": {"label": "M1 (no phase)", "kind": "single", "use_phase": False,
                "path": os.path.join(HERE, "models", "m1_noph", "model.keras")},
    "m3_mlnoph": {"label": "M3-ML (no phase)", "kind": "m3ml", "use_phase": False,
                  "path": os.path.join(HERE, "models", "m3_mlnoph")},
    "m1": {"label": "M1 (phase)", "kind": "single", "use_phase": True,
           "path": os.path.join(HERE, "models", "m1", "model.keras")},
    "m3_ml": {"label": "M3-ML (phase)", "kind": "m3ml", "use_phase": True,
              "path": os.path.join(HERE, "models", "m3_ml")},
}
PT = 6   # all four models were trained with prediction_time=6 (30 min ahead)


def build_windows(df, pt, use_phase=False):
    electron = df["electron"].values
    electron_high = df["electron_high"].values
    proton = df["proton"].values
    if use_phase:
        phases = np.array([df["background"].values, df["rising"].values, df["falling"].values]).T
    times = list(df["time"].values)
    x, y_val, y_time = [], [], []
    for t in range(24, len(df) - pt):
        cur = [electron[t - 24:t + 1], electron_high[t - 24:t + 1], proton[t - 24:t + 1]]
        if use_phase:
            # Anti-leakage freeze: a phase label doesn't flip until 30 min (6 steps)
            # after the true transition -- exactly m1.py/m3_ml.py's own training rule.
            pt_arr = np.array(phases[t - 24:t + 1])
            i = 24
            while (pt_arr[i] != pt_arr[i - 6]).any():
                pt_arr[i] = pt_arr[i - 6]
                i -= 1
            for j in range(pt_arr.shape[1]):
                cur.append(pt_arr[:, j])
        x.append(cur)
        y_val.append(proton[t + pt])
        y_time.append(times[t + pt])
    x = np.array([inst.T for inst in np.array(x)])
    return x, np.array(y_val, float), y_time


def _prep(model_name, df):
    """Adds phase columns if this model needs them. Returns the (possibly augmented) df."""
    cfg = MODEL_CONFIGS[model_name]
    if cfg["use_phase"]:
        df = add_historic_phases(df)
    return df, cfg


def _predict(cfg, x):
    if cfg["kind"] == "single":
        model = load_model(cfg["path"])
        return model.predict(x, verbose=0).flatten()
    models = load_m3ml_models(cfg["path"])
    preds, _ = predict_m3ml(models, x)
    return preds


def evaluate_model(model_name, df, start, end, out_png):
    df, cfg = _prep(model_name, df)
    x, y, ytime = build_windows(df, PT, cfg["use_phase"])
    ytime_ts = pd.to_datetime(ytime)
    mask = (ytime_ts >= pd.Timestamp(start)) & (ytime_ts <= pd.Timestamp(end))
    x_s, y_s, ytime_s = x[mask], y[mask], np.array(ytime)[mask]

    if len(x_s) == 0:
        raise ValueError("No scoreable rows in the requested range (range too short vs. buffer/horizon).")

    preds = _predict(cfg, x_s)

    abserr = np.abs(preds - y_s)
    metrics = {
        "label": cfg["label"],
        "n": int(len(y_s)),
        "mae": float(abserr.mean()),
        "mae_elevated": float(abserr[y_s > 0].mean()) if (y_s > 0).any() else None,
        "n_elevated": int((y_s > 0).sum()),
        "mae_event": float(abserr[y_s > LN10].mean()) if (y_s > LN10).any() else None,
        "n_event": int((y_s > LN10).sum()),
    }

    _make_plot(df, start, end, ytime_s, y_s, preds, cfg["label"], out_png)
    return metrics


def evaluate_series(model_name, df, start, end):
    """
    Same scoring as evaluate_model, but returns JSON-ready series instead of writing
    a PNG -- for the dashboard's own forecast-plot renderer (SunEarthScene.js),
    which draws the shaded input-buffer window + predicted-vs-actual curve itself in
    the site's own style, mirroring forecast_plot_external.py's visual exactly.
    """
    df, cfg = _prep(model_name, df)
    x, y, ytime = build_windows(df, PT, cfg["use_phase"])
    ytime_ts = pd.to_datetime(ytime)
    mask = (ytime_ts >= pd.Timestamp(start)) & (ytime_ts <= pd.Timestamp(end))
    x_s, y_s, ytime_s = x[mask], y[mask], np.array(ytime)[mask]

    if len(x_s) == 0:
        raise ValueError("No scoreable rows in the requested range (range too short vs. buffer/horizon).")

    preds = _predict(cfg, x_s)

    abserr = np.abs(preds - y_s)
    metrics = {
        "n": int(len(y_s)),
        "mae": float(abserr.mean()),
        "mae_elevated": float(abserr[y_s > 0].mean()) if (y_s > 0).any() else None,
        "n_elevated": int((y_s > 0).sum()),
        "mae_event": float(abserr[y_s > LN10].mean()) if (y_s > LN10).any() else None,
        "n_event": int((y_s > LN10).sum()),
    }

    times_all = df["time"].tolist()
    pred_by_time = dict(zip(ytime_s, preds.tolist()))
    now_index = next(
        (i for i, t in enumerate(times_all) if pd.Timestamp(t) >= pd.Timestamp(start)),
        0,
    )

    return {
        "label": cfg["label"],
        "metrics": metrics,
        "ln10_threshold": float(LN10),
        "now_index": now_index,
        "times": times_all,
        "electron": df["electron"].round(4).tolist(),
        "electron_high": df["electron_high"].round(4).tolist(),
        "proton": df["proton"].round(4).tolist(),
        "predicted": [pred_by_time.get(t) for t in times_all],
    }


def _make_plot(df, start, end, ytime_s, y_s, preds, label, out_png):
    times = df["time"].tolist()
    tindex = {t: i for i, t in enumerate(times)}
    electron = df["electron"].to_numpy()
    electron_high = df["electron_high"].to_numpy()
    proton = df["proton"].to_numpy()

    hist_start = 0
    t_row = min((tindex[t] for t in times if pd.Timestamp(t) >= pd.Timestamp(start)), default=0)
    fc_end = len(df) - 1
    xs = list(range(hist_start, fc_end + 1))

    pred_by_time = dict(zip(ytime_s, preds))
    pred_curve = np.full(len(xs), np.nan)
    for k, row in enumerate(xs):
        v = pred_by_time.get(times[row])
        if v is not None:
            pred_curve[k] = v

    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.plot(xs, electron[hist_start:fc_end + 1], "-", color="magenta", lw=1.2, label="Electron")
    ax.plot(xs, electron_high[hist_start:fc_end + 1], "-", color="olive", lw=1.2, label="High-energy electron")
    ax.plot(xs, proton[hist_start:fc_end + 1], "-", color="tab:blue", lw=1.6, label="Actual proton")
    ax.plot(xs, pred_curve, "-", color="tab:green", lw=1.8, label="Predicted proton (+6 steps)")

    y0, y1 = ax.get_ylim()
    ax.axvspan(hist_start, t_row, color="0.6", alpha=0.18, zorder=0)
    ax.axvline(t_row, color="k", ls="--", lw=1.0)
    ax.axhline(LN10, color="k", ls=":", lw=1.0)
    ax.set_ylim(y0, y1)
    ax.annotate("input buffer (not scored)", xy=(hist_start, y1), xytext=(2, -4),
                textcoords="offset points", ha="left", va="top", fontsize=8, color="0.25")
    ax.annotate("requested start", xy=(t_row, y0), xytext=(4, 6), textcoords="offset points",
                ha="left", va="bottom", fontsize=8, rotation=90)

    ntick = 10
    step = max(1, len(xs) // ntick)
    tick_rows = xs[::step]
    ax.set_xticks(tick_rows)
    ax.set_xticklabels([times[r][5:16].replace("T", " ") for r in tick_rows], rotation=45, ha="right", fontsize=8)
    ax.set_xlabel(f"time  ({times[0][:10]} -> {times[-1][:10]})")
    ax.set_ylabel("ln(Flux)")
    ax.set_title(f"{label}  |  {start:%Y-%m-%d %H:%M} -> {end:%Y-%m-%d %H:%M}", fontsize=9)
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
