"""
Builds a data.csv-shaped DataFrame (time, electron, electron_high, proton) for an
ARBITRARY user-requested date range, restricted to the two periods where we have a
clean, exact match to the training data's proton definition (">10 MeV integral", pfu):

  - historic: any range ending on/before 2020-12-31, from NOAA's GOES 8-15 EPS "avg"
    archive (NCEI), which publishes p3_flux_ic = "Proton integral > 10 MeV corrected".
  - live: any range whose end falls within the trailing 7 days, from NOAA SWPC's
    real-time GOES-18 json (same >=10 MeV definition).

2021 through 7-days-ago is deliberately UNSUPPORTED: GOES-R (18/19) only publishes raw
differential energy bins there, and turning those into an equivalent >10 MeV integral
number requires an approximation we chose not to ship silently (see conversation).

Electrons (both periods) come from SOHO/EPHIN L2-1MIN via SEPpy, same as the rest of
the analysis tooling.
"""
import os
import re
import calendar
import datetime as dt
import numpy as np
import pandas as pd
import requests

EPS = 1e-4
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(os.path.join(CACHE_DIR, "goes"), exist_ok=True)
os.makedirs(os.path.join(CACHE_DIR, "ephin"), exist_ok=True)

NCEI_AVG_BASE = "https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/avg"
SWPC_LIVE_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-7-day.json"

HISTORIC_CUTOFF = dt.datetime(2020, 12, 31, 23, 55)


class UnsupportedRangeError(Exception):
    pass


def classify_range(start, end):
    """Returns 'historic', 'live', or raises UnsupportedRangeError."""
    now = dt.datetime.utcnow()
    live_floor = now - dt.timedelta(days=7)
    if end <= HISTORIC_CUTOFF:
        return "historic"
    if start >= live_floor and end <= now:
        return "live"
    raise UnsupportedRangeError(
        f"Requested range {start} .. {end} falls in the unsupported gap "
        f"(2021-01-01 .. {live_floor:%Y-%m-%d}) where no exact >10 MeV integral proton "
        f"channel is available. Pick a range that ends on/before 2020-12-31, or one "
        f"that stays within the last 7 days ({live_floor:%Y-%m-%d} .. {now:%Y-%m-%d})."
    )


# ---------------------------------------------------------------------------
# Electrons: SOHO/EPHIN via SEPpy (works for both historic and live ranges)
# ---------------------------------------------------------------------------

def fetch_ephin(start, end):
    from seppy.loader.soho import soho_load
    cache_key = f"ephin_{start:%Y%m%d}_{end:%Y%m%d}.pkl"
    cache_path = os.path.join(CACHE_DIR, "ephin", cache_key)
    if os.path.exists(cache_path):
        return pd.read_pickle(cache_path)

    dfe, _ = soho_load(dataset="SOHO_COSTEP-EPHIN_L2-1MIN",
                        startdate=start.strftime("%Y/%m/%d"),
                        enddate=end.strftime("%Y/%m/%d"))
    e5 = dfe[["E150", "E300"]].resample("5min").mean()
    e5.to_pickle(cache_path)
    return e5


# ---------------------------------------------------------------------------
# Protons: historic NCEI archive, with automatic satellite discovery/fallback
# ---------------------------------------------------------------------------

def _list_satellites(year, month):
    url = f"{NCEI_AVG_BASE}/{year}/{month:02d}/"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    sats = sorted(set(re.findall(r'href="goes(\d+)/?"', r.text)))
    return sats


def _download_csv(year, month, sat, fname):
    cache_path = os.path.join(CACHE_DIR, "goes", fname)
    if not os.path.exists(cache_path):
        url = f"{NCEI_AVG_BASE}/{year}/{month:02d}/goes{sat}/csv/{fname}"
        r = requests.get(url, timeout=60)
        if r.status_code != 200 or len(r.content) < 1000:
            return None
        with open(cache_path, "wb") as f:
            f.write(r.content)
    return cache_path


def _read_after_data_marker(path, required_columns):
    with open(path) as f:
        lines = f.readlines()
    hdr = next((i for i, l in enumerate(lines) if l.strip() == "data:"), None)
    if hdr is None:
        return None
    df = pd.read_csv(path, skiprows=hdr + 1)
    if not all(c in df.columns for c in required_columns):
        return None
    df["time_tag"] = pd.to_datetime(df["time_tag"])
    return df.set_index("time_tag")


def _load_goes_csv(year, month, sat):
    """
    Two GOES-era proton-instrument formats exist in this archive:
      - GOES 8-12 (older "EPS" instrument): g{sat}_eps_5m_*.csv, column p3_flux_ic
        (already an integral >10 MeV, corrected, single value).
      - GOES 13-15 ("EPEAD" instrument): g{sat}_epead_cpflux_5m_*.csv, columns
        ZPGT10E / ZPGT10W (>10 MeV, East-looking / West-looking detector). Only ONE of
        the two is meaningful at a time -- the satellite's orientation flag
        (g{sat}_epead_orientation_flag_1m_*.csv) says which: flag 0 -> use E, flag 1 -> use W.
        Verified against NOAA's own published Sep 5 2017 event peak (210 pfu): flag was 0
        all month and ZPGT10E peaked at 210.2 pfu at the correct time; ZPGT10W did not.
    Returns None if neither format is found/usable for this satellite/month.
    """
    last_day = calendar.monthrange(year, month)[1]
    mstart = f"{year}{month:02d}01"
    mend = f"{year}{month:02d}{last_day:02d}"

    path = _download_csv(year, month, sat, f"g{sat}_eps_5m_{mstart}_{mend}.csv")
    if path:
        df = _read_after_data_marker(path, ["p3_flux_ic"])
        if df is not None:
            return df["p3_flux_ic"].mask(df["p3_flux_ic"] <= -99998)

    path = _download_csv(year, month, sat, f"g{sat}_epead_cpflux_5m_{mstart}_{mend}.csv")
    if path:
        df = _read_after_data_marker(path, ["ZPGT10E", "ZPGT10W"])
        if df is not None:
            e = df["ZPGT10E"].mask(df["ZPGT10E"] <= -99998)
            w = df["ZPGT10W"].mask(df["ZPGT10W"] <= -99998)
            orient_path = _download_csv(
                year, month, sat,
                f"g{sat}_epead_orientation_flag_1m_{mstart}_{mend}_v1.0.0.csv")
            if orient_path:
                odf = _read_after_data_marker(orient_path, ["ORIENTATION_FLAG"])
            else:
                odf = None
            if odf is not None:
                flag = odf["ORIENTATION_FLAG"].reindex(df.index, method="nearest")
                return w.where(flag == 1, e)
            return e   # no orientation file available -> assume nominal (flag 0 -> E)

    return None


def fetch_goes_historic(start, end):
    months = []
    cur = dt.datetime(start.year, start.month, 1)
    end_month = dt.datetime(end.year, end.month, 1)
    while cur <= end_month:
        months.append((cur.year, cur.month))
        cur = dt.datetime(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)

    pieces = []
    for year, month in months:
        sats = _list_satellites(year, month)
        if not sats:
            raise UnsupportedRangeError(f"No GOES satellite data found for {year}-{month:02d}")
        best = None
        best_coverage = -1
        for sat in sats:
            series = _load_goes_csv(year, month, sat)
            if series is None:
                continue
            window = series[(series.index >= pd.Timestamp(start)) & (series.index <= pd.Timestamp(end))]
            if len(window) == 0:
                continue
            coverage = window.notna().mean()
            if coverage > best_coverage:
                best, best_coverage = series, coverage
        if best is None:
            raise UnsupportedRangeError(
                f"No usable GOES proton data found for {year}-{month:02d} "
                f"(tried satellites: {', '.join(sats)})")
        pieces.append(best)

    full = pd.concat(pieces).sort_index()
    full = full[~full.index.duplicated(keep="first")]
    p5 = full.loc[pd.Timestamp(start):pd.Timestamp(end)]
    p5 = p5.interpolate(limit=3).clip(lower=0)
    return p5


# ---------------------------------------------------------------------------
# Protons: live SWPC json (trailing 7 days)
# ---------------------------------------------------------------------------

def fetch_goes_live(start, end):
    r = requests.get(SWPC_LIVE_URL, timeout=30)
    r.raise_for_status()
    recs = r.json()
    g = pd.DataFrame([rec for rec in recs if rec["energy"] == ">=10 MeV"])
    g["time_tag"] = pd.to_datetime(g["time_tag"]).dt.tz_localize(None)
    g = g.set_index("time_tag")["flux"]
    p5 = g.loc[pd.Timestamp(start):pd.Timestamp(end)].resample("5min").mean().clip(lower=0)
    return p5


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_dataset(start, end, buffer_steps=30):
    """
    start/end: datetime objects for the user's requested analysis window.
    buffer_steps: extra 5-min steps of history fetched BEFORE `start` so the model's
    24-step input window has data to draw on for targets right at `start`.
    Returns a DataFrame with columns time, electron, electron_high, proton, covering
    [start - buffer, end].
    """
    fetch_start = start - dt.timedelta(minutes=5 * buffer_steps)
    kind = classify_range(fetch_start, end)

    e5 = fetch_ephin(fetch_start, end)
    if kind == "historic":
        p5 = fetch_goes_historic(fetch_start, end)
    else:
        p5 = fetch_goes_live(fetch_start, end)

    out = pd.DataFrame({
        "electron": np.log(e5["E150"].clip(lower=EPS)),
        "electron_high": np.log(e5["E300"].clip(lower=EPS)),
    }).join(np.log(p5.clip(lower=EPS)).rename("proton"), how="inner").dropna()

    out.insert(0, "time", out.index.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3])
    out = out.reset_index(drop=True)

    if len(out) == 0:
        raise UnsupportedRangeError("No overlapping electron+proton data found for this range.")
    actual_end = pd.Timestamp(out["time"].iloc[-1])
    if (pd.Timestamp(end) - actual_end) > pd.Timedelta(minutes=20):
        raise UnsupportedRangeError(
            f"SOHO/EPHIN electron data is only available up to {actual_end} "
            f"(near-real-time EPHIN data typically lags 1-2 days behind live GOES proton "
            f"data). Try an end time on/before {actual_end:%Y-%m-%d %H:%M}."
        )
    return out, kind
