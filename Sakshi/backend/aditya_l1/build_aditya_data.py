"""
Builds a data.csv-format file (time, electron, electron_high, proton -- all ln(flux))
for scoring the frozen M1-phases model on Aditya-L1 data, mirroring
analysis/build_2003_data_v2.py's pattern exactly: electrons from SOHO/EPHIN (unchanged --
Aditya-L1 has no electron instrument), proton now from ASPEX-STEPS instead of GOES.

See ../aditya_l1/README.md for why this is NOT a clean equivalent of the GOES proton
channel (STEPS tops out at ~6 MeV/nucleon; the model's proton target is GOES's >10 MeV
integral channel) -- this script produces the best available proxy, not an identical
physical quantity, and the MAE numbers it feeds into evaluate_external.py must be
reported with that caveat.

Requires Level-2 STEPS CDF files in aditya_l1/raw/. These used to require downloading by
hand from PRADAN (login required) -- that's no longer strictly true: fetch_aditya_pradan.py
automates the PRADAN login (a plain Keycloak OAuth2 flow) and downloads files directly by
their deterministic URL, given your own PRADAN account credentials (PRADAN_USERNAME/
PRADAN_PASSWORD env vars). Per PRADAN's own data description, L2 STEPS ships as FOUR
separate CDF files per day, one per sensor unit -- PS (Parker Spiral), EP (Earth Pointed),
IM (Intermediate), NP (North Pointed) -- each file holding only that unit's differential
directional flux. There is no SR (Sun Radial) or SP (South Pointed) L2 product. Whichever
way the files arrive, this script globs aditya_l1/raw/, keeps only the files for one
chosen direction, and concatenates them in time order.

Default direction is PS (Parker Spiral): with no Sun-pointing sensor available, PS is
the best stand-in -- it's the direction field-aligned SEP protons streaming out from the
Sun actually arrive from, which is why in-situ particle instruments orient a sensor that
way in the first place.

Confirmed from real downloaded files (cdflib, no spacepy/CDF-library install needed):
each direction's L2 file exposes two detector elements, "Inner" and "Outer" (a
delta-E/E telescope pair), each with an "allspecies"/"alphaplusheavier"/"heavier"
variable. There is no standalone proton channel. "allspecies" covers 0.3-6 MeV (Inner)
/ 0.25-6 MeV (Outer) in 11 differential energy bins (Counts/sec/MeV/sr/cm2); at these
energies protons vastly outnumber alphas and heavier ions, so "allspecies" is itself
already a reasonable proton-dominated proxy -- no subtraction needed (the
"alphaplusheavier"/"heavier" variables cover a disjoint higher per-nucleon-equivalent
range, 6-24 MeV total, not an overlapping contamination band to subtract out). Default
detector element is "Inner" (the back/stopping element of the telescope pair, the usual
choice for higher-energy validation); pass --detector Outer to use the other one. Fill
value is -1e31 (masked to NaN before any averaging).

Usage:
  python build_aditya_data.py --steps-dir raw/ \
      --start 2024/05/10 --end 2024/05/15 --out data_2024_may_aspex.csv \
      [--direction PS]
"""
import argparse
import glob
import os
import numpy as np
import pandas as pd
import cdflib
from seppy.loader.soho import soho_load

EPS = 1e-4
FILLVAL = -1e31

STEPS_DIRECTIONS = ["PS", "EP", "IM", "NP"]  # the only four L2 products that exist
STEPS_DETECTORS = ["Inner", "Outer"]


def _files_for_direction(steps_dir, direction):
    """Picks out the subset of downloaded daily CDFs that belong to one sensor
    direction. Confirmed PRADAN filename convention:
    AL1_AST91_L2_<PS|EP|IM|NP>_YYYYMMDD_V01.cdf -- this matches the direction tag
    anywhere in the filename (case-insensitive, flanked by non-alphanumeric chars so
    e.g. "EP" doesn't match inside another word), which fits that pattern directly.
    """
    import re
    all_cdfs = sorted(glob.glob(os.path.join(steps_dir, "*.cdf")))
    pat = re.compile(rf"(?<![A-Za-z]){direction}(?![A-Za-z])", re.IGNORECASE)
    matched = [f for f in all_cdfs if pat.search(os.path.basename(f))]
    if not matched:
        raise SystemExit(
            f"no files in {steps_dir} matched direction '{direction}' by filename. "
            f"Found {len(all_cdfs)} .cdf file(s) total: "
            f"{[os.path.basename(f) for f in all_cdfs]}. "
            "Check the real filenames and adjust _files_for_direction()'s matching if needed."
        )
    return matched


def load_steps_proton(steps_dir, direction, detector="Inner", energy_channel_index=-1):
    """Loads and concatenates the highest available STEPS "allspecies" (proton-
    dominated, see module docstring) energy channel for one direction, across every
    daily file found in steps_dir for that direction.

    energy_channel_index=-1 picks the highest-energy bin (index 10 of 11, ~4.57-6 MeV
    for the Inner detector) -- the closest STEPS gets to the GOES >10 MeV band, still
    well short of it (see README caveat).
    """
    files = _files_for_direction(steps_dir, direction)
    print(f"  direction {direction}: {len(files)} daily file(s) -> {[os.path.basename(f) for f in files]}")

    var = f"{direction}_{detector}_allspecies"
    pieces = []
    for path in files:
        cdf = cdflib.CDF(path)
        zvars = cdf.cdf_info().zVariables
        if var not in zvars:
            # Some early-window files (e.g. the 2024-05-09 downloads) use an older,
            # incompatible L2 schema: a single un-binned broadband channel (plain
            # "PS_Inner", no species split, energy range only ~0.2-1.9 MeV) instead of
            # the per-bin "PS_Inner_allspecies" spectrum (0.3-6 MeV) the rest of the
            # window has. Rather than silently mixing two different physical
            # quantities together, skip those files -- see README.
            print(f"  skipping {os.path.basename(path)}: no '{var}' variable (old schema? has: {zvars})")
            continue
        epoch = cdf.varget("Epoch")
        times = cdflib.cdfepoch.to_datetime(epoch)
        flux = cdf.varget(var)  # (time, 11 energy bins)
        proton = flux[:, energy_channel_index].astype(float)
        proton[proton <= FILLVAL / 10] = np.nan  # mask the -1e31 fill sentinel
        pieces.append(pd.Series(proton, index=pd.to_datetime(times)))

    if not pieces:
        raise SystemExit(f"no usable (new-schema) files found for direction {direction}/{detector}")
    return pd.concat(pieces).sort_index().rename("proton")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps-dir", required=True, help="folder holding the downloaded daily ASPEX-STEPS L2 CDF files (e.g. raw/)")
    ap.add_argument("--start", required=True, help="e.g. 2024/05/10")
    ap.add_argument("--end", required=True, help="e.g. 2024/05/15")
    ap.add_argument("--out", required=True)
    ap.add_argument("--direction", default="PS", choices=STEPS_DIRECTIONS,
                     help="STEPS sensor direction (default: Parker Spiral -- no Sun-pointing L2 product exists; PS is the closest to the SEP streaming direction)")
    ap.add_argument("--detector", default="Inner", choices=STEPS_DETECTORS,
                     help="STEPS telescope element (default: Inner, the back/stopping element -- both cover ~the same 0.3-6 MeV range)")
    args = ap.parse_args()

    print(f"downloading EPHIN L2 (electrons) {args.start} .. {args.end} ... (SOHO -- Aditya-L1 has no electron instrument)")
    dfe, _ = soho_load(dataset="SOHO_COSTEP-EPHIN_L2-1MIN", startdate=args.start, enddate=args.end)
    e5 = dfe[["E150", "E300"]].resample("5min").mean()

    print(f"reading ASPEX-STEPS L2 proton flux ({args.direction}/{args.detector}, highest energy channel) from {args.steps_dir}")
    proton_raw = load_steps_proton(args.steps_dir, args.direction, args.detector)
    p5 = proton_raw.resample("5min").mean()
    start_ts, end_ts = args.start.replace("/", "-"), args.end.replace("/", "-")
    p5 = p5.loc[start_ts:end_ts]
    p5 = p5.interpolate(limit=3)
    p5 = p5.clip(lower=0)

    out = pd.DataFrame({
        "electron": np.log(e5["E150"].clip(lower=EPS)),
        "electron_high": np.log(e5["E300"].clip(lower=EPS)),
    }).join(np.log(p5.clip(lower=EPS)).rename("proton"), how="inner").dropna()

    out.insert(0, "time", out.index.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3])
    out = out.reset_index(drop=True)
    out.to_csv(args.out, index=False)
    print(f"\nwrote {args.out}  ({len(out)} rows, {out['time'].iloc[0]} .. {out['time'].iloc[-1]})")
    print(out.describe())
    print(
        "\nCAVEAT: 'proton' here is ASPEX-STEPS's highest channel (~6 MeV/nucleon max), "
        "not GOES's >10 MeV integral channel the model was trained against -- report "
        "MAE from this file as a proxy comparison, not an equivalent one. See README.md."
    )


if __name__ == "__main__":
    main()
