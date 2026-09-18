"""
Part (a), the rigorous version: run an ALREADY-TRAINED model on a SEPARATE data file
(e.g. a post-2002 period the model has never seen), with NO retraining and NO train/test split
- every row in the file is scored.

The new CSV must have the same columns data.csv has:
    time, electron, electron_high, proton   (+ background,rising,falling if the model used -ph)
produced by the same transforms as Data/data_preprocess.py.

Usage:
  python evaluate_external.py --model <run>/model.keras --data <new.csv> --pt 6
  optional: --phase           (model was trained with -ph; new.csv needs the 3 phase columns)
            --events <file>    (onset threshold peak end per line -> event-level MAE/lag like results.txt)
            --out <png>

Sanity check (should ~reproduce the run's own test MAE):
  python evaluate_external.py --model out/m1/run1/model.keras --data Data/data.csv --pt 6 --slice-test
"""
import argparse
import os
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

LN10 = np.log(10)


def build_windows(df, pt, use_phase):
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
    x = np.array([inst.T for inst in np.array(x)])   # rnn shape (steps, features)
    return x, np.array(y_val, float), y_time


def x_axis_lag(targets, preds, cap=24):
    maes = []
    for lag in range(min(len(targets), cap)):
        a = targets[:len(targets) - lag]
        b = preds[lag:]
        maes.append(np.mean(np.abs(a - b)))
    return int(np.argmin(maes))


def lag_ln10(targets, preds):
    a = next((i for i, v in enumerate(targets) if v > LN10), -1)
    p = next((i for i, v in enumerate(preds) if v > LN10), -1)
    if p == -1:
        p = len(preds) - 1
    return p - a if a != -1 else np.nan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True,
                    help="a run's model.keras, or (with --m3ml) the run DIRECTORY")
    ap.add_argument("--data", required=True)
    ap.add_argument("--pt", type=int, default=6)
    ap.add_argument("--phase", action="store_true")
    ap.add_argument("--m3ml", action="store_true",
                    help="model is an m3_ml-style run dir (phase_selection + 3 intensity models)")
    ap.add_argument("--events", default=None)
    ap.add_argument("--slice-test", action="store_true",
                    help="only score the last 20%% (to sanity-check against the run's own results)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    df = pd.read_csv(args.data)
    print(f"data: {args.data}  rows={len(df)}  {df['time'].iloc[0]} .. {df['time'].iloc[-1]}")
    if args.m3ml:
        models = load_m3ml_models(args.model)
        print(f"model: {args.model}  (m3_ml-style, 4 sub-models)")
    else:
        model = load_model(args.model)
        print(f"model: {args.model}  input shape {model.input_shape}")

    x, y, ytime = build_windows(df, args.pt, args.phase)
    if args.slice_test:
        k = int(0.8 * len(x))
        x, y, ytime = x[k:], y[k:], ytime[k:]
        print(f"scoring last 20%: {len(x)} windows from {ytime[0]}")
    else:
        print(f"scoring ALL {len(x)} windows")

    if args.m3ml:
        preds, _ = predict_m3ml(models, x)
    else:
        preds = model.predict(x, verbose=0).flatten()
    abserr = np.abs(preds - y)
    print(f"\noverall MAE (ln flux) = {abserr.mean():.3f}")
    print(f"MAE on elevated pts (>0)      = {abserr[y>0].mean():.3f}  (n={int((y>0).sum())})")
    if (y > LN10).any():
        print(f"MAE on event pts (>ln10)     = {abserr[y>LN10].mean():.3f}  (n={int((y>LN10).sum())})")

    if args.events:
        tmap = {t: i for i, t in enumerate(ytime)}
        pmap = dict(zip(ytime, preds))
        vmap = dict(zip(ytime, y))
        maes, o2p, o2t, ln10 = [], [], [], []
        with open(args.events) as f:
            for line in f:
                onset, thr, peak, end = line.split()
                if onset not in tmap or peak not in tmap:
                    continue
                seg = ytime[tmap[onset]:tmap[peak] + 1]
                ta = np.array([vmap[s] for s in seg]); pa = np.array([pmap[s] for s in seg])
                seg2 = ytime[tmap[onset]:tmap[thr] + 1]
                ta2 = np.array([vmap[s] for s in seg2]); pa2 = np.array([pmap[s] for s in seg2])
                maes.append(np.mean(np.abs(ta - pa)))
                o2p.append(x_axis_lag(ta, pa)); o2t.append(x_axis_lag(ta2, pa2))
                ln10.append(lag_ln10(ta, pa))
        if maes:
            print(f"\n--- event-level ({len(maes)} events matched) ---")
            print(f"Average MAE      = {np.mean(maes):.3f}")
            print(f"Average O2P lag  = {np.nanmean(o2p):.3f}")
            print(f"Average O2T lag  = {np.nanmean(o2t):.3f}")
            print(f"Average ln10 lag = {np.nanmean(ln10):.3f}")

    # plot actual vs predicted over the whole scored span
    fig, ax = plt.subplots(figsize=(12, 4.5))
    tt = pd.to_datetime(ytime)
    ax.plot(tt, y, color="tab:blue", lw=0.7, label="actual proton")
    ax.plot(tt, preds, color="tab:green", lw=0.7, label="predicted proton")
    ax.axhline(LN10, color="k", ls=":", lw=1)
    ax.set_ylabel("ln(Flux)")
    ax.set_title(f"{os.path.basename(args.model)} on {os.path.basename(args.data)}  |  MAE={abserr.mean():.3f}",
                 fontsize=9)
    ax.legend(fontsize=8)
    ax.tick_params(axis="x", rotation=30, labelsize=8)
    fig.tight_layout()
    out = args.out or os.path.join(os.path.dirname(__file__), "evaluate_external.png")
    fig.savefig(out, dpi=130)
    print("\nwrote", out)


if __name__ == "__main__":
    main()
