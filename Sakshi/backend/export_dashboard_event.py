"""
Reference/reproducibility script: this is how the original 2003 SEP event
data bundled into the frontend (Dashboard/frontend/public/data/sakshi/) was
built. Not used at runtime by app.py -- the live Forecast form fetches from
this backend's own /api/forecast instead. Needs a source CSV in the shape
ElectronInput/analysis/data_fetch.py or the ProtonFluxTimeSeries analysis
tooling produces (time, electron, electron_high, proton columns).

Usage:
  python export_dashboard_event.py --data data_2003_may29event.csv \
      --model models/m1_noph/model.keras --pt 6 \
      --start 2003-05-28T18:00 --end 2003-05-30T18:00 \
      --out ../../Dashboard/frontend/public/data/sakshi/event_2003.json
"""
import argparse
import json
import os
import sys
import numpy as np
import pandas as pd
from keras.models import load_model

sys.path.insert(0, os.path.dirname(__file__))
from evaluate_external import build_windows

LN10 = float(np.log(10))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--pt", type=int, default=6)
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--label", default="2003-05-29 SEP event")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    df = pd.read_csv(args.data)
    model = load_model(args.model)
    x, y, ytime = build_windows(df, args.pt, use_phase=False)
    preds = model.predict(x, verbose=0).flatten()

    times = pd.to_datetime(ytime)
    df_out = pd.DataFrame({
        "time": ytime,
        "proton_actual": y,
        "proton_pred": preds,
    })
    # electron channels aligned to the same target timestamps (not the window),
    # i.e. the electron reading AT that same instant, for the visual precursor
    tmap = {t: i for i, t in enumerate(df["time"].values)}
    df_out["electron"] = [df["electron"].iloc[tmap[t]] if t in tmap else np.nan for t in ytime]
    df_out["electron_high"] = [df["electron_high"].iloc[tmap[t]] if t in tmap else np.nan for t in ytime]
    df_out = df_out.dropna()

    if args.start:
        df_out = df_out[pd.to_datetime(df_out["time"]) >= pd.Timestamp(args.start)]
    if args.end:
        df_out = df_out[pd.to_datetime(df_out["time"]) <= pd.Timestamp(args.end)]
    df_out = df_out.reset_index(drop=True)

    out = {
        "label": args.label,
        "pt_minutes": args.pt * 5,
        "ln10_threshold": LN10,
        "cadence_minutes": 5,
        "rows": [
            {
                "t": row.time,
                "e": round(float(row.electron), 4),
                "eh": round(float(row.electron_high), 4),
                "p": round(float(row.proton_actual), 4),
                "pred": round(float(row.proton_pred), 4),
            }
            for row in df_out.itertuples()
        ],
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"wrote {args.out}  ({len(out['rows'])} rows, "
          f"{out['rows'][0]['t']} .. {out['rows'][-1]['t']})")
    print(f"file size: {os.path.getsize(args.out) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
