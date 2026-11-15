"""
Vendored copy of ProtonFluxTimeSeries/ace_epam/build_epam_data.py, imported by data_fetch.py
for the "epam" regime (2021-01-01 .. Aditya-L1 start). Kept as a self-contained module here
since this dashboard repo doesn't have access to the training repo's directory tree.

Alternative to analysis/build_2003_data_v2.py's GOES-based external-validation data: same
electrons (SOHO/EPHIN, unchanged), but PROTON now from ACE/EPAM's LEMS30 "P8" channel
(1.88-4.7 MeV differential flux) instead of NOAA GOES's p3_flux_ic (">10 MeV integral, pfu").

Why: EPHIN and ACE/EPAM both sit at L1; GOES sits at geostationary orbit. build_2003_data_v2.py
already documents a real vantage-point mismatch there (Kuhl et al. 2019). This script trades
that mismatch for a different, already-accepted-elsewhere one: P8 tops out at 4.7 MeV, well
under the >10 MeV convention the model was trained against (p10f10event.dat's "F(>10MeV)>10
pfu", and GOES's own p3_flux_ic) -- the same category of energy-band proxy already used for
Aditya-L1 (aditya_l1/README.md's STEPS 4.57-6 MeV channel). ACE/EPAM does NOT have a clean
>10 MeV proton channel: EPAM's own proton telescope caps at 4.7 MeV, and ACE/SIS's only
">10 MeV" output (its K0 key-parameter H_lo/H_hi) is itself background contamination from
particles entering the instrument's sides, not a calibrated channel, and its CDAWeb archive
appears to only start 2017-07 (checked indirectly -- cdaweb.gsfc.nasa.gov/spdf.gsfc.nasa.gov
were unreachable from this environment; izw1.caltech.edu, the ACE Science Center, was not).

CONSEQUENCE WORTH FLAGGING EXPLICITLY: because P8 is a different physical quantity (lower-
energy differential flux, not the same integral band) from what the model's `proton` column
was trained on, this is NOT an apples-to-apples drop-in replacement for data_2003_may_v2.csv --
expect a real distribution shift in absolute scale, and treat the ln(10) SEP-event threshold
and any MAE comparison against GOES-trained numbers as exploratory, not literally comparable,
exactly the same caveat already attached to the Aditya-L1 numbers.

THIRD CAVEAT, SEPARATE FROM THE TWO ABOVE -- SHOT NOISE ON QUIET PERIODS: P8 is a narrow
(1.88-4.7 MeV) differential bin, so during geomagnetically quiet stretches the true ambient
flux in that specific band is low enough that the raw count in a given 5-min accumulation
window is a small integer (0, 1, 2, 3 particles). Flux = count / (geometric_factor *
accumulation_time * bandwidth), so count noise of +-1 particle swings the linear flux by a
large factor, and ln() turns that into visible sharp up-down jitter across adjacent 5-min
points that is NOT real solar-wind/SEP structure -- confirmed directly on the 2003-05-09..11
quiet window (see conversation): the series swings between roughly -1.2 and -5.2 on a
30-60 min timescale throughout, with no smooth structure. This is plausibly why the 2003
quiet-day MAE (0.680) came out worse than the GOES/EPHIN-based reference (0.592) while the
2017 real-event MAE (0.294) came out better than its reference (0.363): during a real event,
count rates in this band are high enough that shot noise is negligible and the channel
behaves well; during a quiet period, low counts dominate the signal with noise the model has
no way to predict, since it isn't real structure to begin with. GOES's broader integral band
and EPHIN's own channels don't show this because they accumulate over a much wider energy
range with correspondingly higher, less noisy count rates.

Data source: ACE Science Center (izw1.caltech.edu), EPAM Level 2, 5-minute yearly HDF4 files --
no login needed. Only P7 and P8 are reliably valid across both the 2003 and 2017 external-
validation windows: EPAM's own documentation states channels P1-P6 go to fill value (-999.9)
for good after DOY 302, 2003, so anything after Oct 2003 (including the 2017 window) only has
P7/P8 to draw on. P8 (this script's default) is the higher-energy, closer match of the two.

Usage:
  python build_epam_data.py --start 2003/05/09 --end 2003/05/11 --out data_2003_may_epam.csv
  python build_epam_data.py --start 2017/09/04 --end 2017/09/12 --out data_2017_sep_epam.csv
  optional: --channel P7   (default P8)
"""
import argparse
import os
import numpy as np
import pandas as pd
import requests
from pyhdf.HDF import HDF
from pyhdf.VS import VS
from seppy.loader.soho import soho_load

EPS = 1e-4
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache", "epam")
ASC_BASE = "https://izw1.caltech.edu/ACE/ASC/DATA/level2/epam"


def _download_year(year):
    os.makedirs(CACHE_DIR, exist_ok=True)
    fname = f"epam_data_5min_year{year}.hdf"
    path = os.path.join(CACHE_DIR, fname)
    if not os.path.exists(path):
        print(f"downloading {fname} from the ACE Science Center ...")
        r = requests.get(f"{ASC_BASE}/{fname}", timeout=120)
        r.raise_for_status()
        with open(path, "wb") as f:
            f.write(r.content)
    return path


def _read_field(vd, name, nrec):
    # pyhdf's multi-field setfields() is broken in this environment (raises "illegal field
    # name" past the first field) -- read one field at a time instead, each its own full pass.
    vd.setfields(name)
    vd.seek(0)
    return np.array(vd.read(nRec=nrec)).flatten()


def load_epam_year(year, channel):
    path = _download_year(year)
    hdf = HDF(path)
    vs = hdf.vstart()
    vd = vs.attach("EPAM_data_5min")
    nrec = vd.inquire()[0]

    yr = _read_field(vd, "year", nrec).astype(int)
    doy = _read_field(vd, "day", nrec).astype(int)
    hr = _read_field(vd, "hr", nrec).astype(int)
    mn = _read_field(vd, "min", nrec).astype(int)
    sec = _read_field(vd, "sec", nrec).astype(int)
    flux = _read_field(vd, channel, nrec).astype(float)
    vd.detach()
    vs.vend()
    hdf.close()

    # DOY is 1-indexed (day 1 = Jan 1st), same convention/fix as Data/data_preprocess.py's
    # txt_to_df(): Year-01-01 + DOY days overshoots by exactly one day otherwise.
    time = (pd.to_datetime(yr, format="%Y") + pd.to_timedelta(doy, unit="D")
            - pd.Timedelta(1, unit="D") + pd.to_timedelta(hr, unit="h")
            + pd.to_timedelta(mn, unit="m") + pd.to_timedelta(sec, unit="s"))
    series = pd.Series(flux, index=time, name="proton_raw")
    series = series.mask(series <= -999)  # EPAM's own missing-value sentinel -> NaN, not 0
    return series


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--channel", default="P8", choices=["P7", "P8"],
                     help="EPAM LEMS30 proton channel: P7 (1.06-1.88 MeV) or P8 (1.88-4.7 MeV, default)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    print(f"downloading EPHIN L2 (electrons) {args.start} .. {args.end} ...")
    dfe, _ = soho_load(dataset="SOHO_COSTEP-EPHIN_L2-1MIN", startdate=args.start, enddate=args.end)
    e5 = dfe[["E150", "E300"]].resample("5min").mean()

    start_ts, end_ts = args.start.replace("/", "-"), args.end.replace("/", "-")
    years = sorted(set(range(pd.Timestamp(start_ts).year, pd.Timestamp(end_ts).year + 1)))
    print(f"loading ACE/EPAM {args.channel} for year(s) {years} ...")
    p5 = pd.concat([load_epam_year(y, args.channel) for y in years]).sort_index()
    p5 = p5.loc[start_ts:end_ts]
    # EPAM's native 5-min grid lands on :01/:06/:11... (offset from EPHIN's :00/:05/:10
    # resample() boundaries above) -- resample onto the same grid before joining, or the
    # inner join below finds almost no exact-timestamp matches.
    p5 = p5.resample("5min").mean()
    p5 = p5.interpolate(limit=3)  # bridge short gaps (a handful of 5-min samples)
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


if __name__ == "__main__":
    main()
