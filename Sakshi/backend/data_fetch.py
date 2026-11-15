"""
Builds a data.csv-shaped DataFrame (time, electron, electron_high, proton) for an
ARBITRARY user-requested date range, using three date-based regimes:

  - epam: anything up to Aditya-L1's data-availability start (see ADITYA_START below), from
    ACE/EPAM's P8 channel (1.88-4.7 MeV differential flux), per ace_epam_data.py. Used
    uniformly for the WHOLE pre-Aditya span -- including years (pre-2021) where NOAA GOES's
    own clean ">10 MeV integral, pfu" archive would actually have been an exact match to
    the training data's proton definition -- so that every historic range uses a single,
    consistent proton source/vantage point (L1, same as EPHIN) rather than switching sources
    depending on sub-period. NOT a clean match to the training definition -- see that
    module's docstring for the three caveats (energy band, uncalibrated vs. GOES's integral
    definition, shot noise on quiet periods); those apply across this whole regime now, not
    just the post-2020 slice they were originally introduced for.
  - aditya: ADITYA_START through 7-days-ago. Checks already-downloaded local Aditya-L1/
    ASPEX data (aditya_l1/, vendored into this repo) first; if nothing local covers the
    window and PRADAN_USERNAME/PRADAN_PASSWORD are set in this process's environment,
    auto-fetches the missing STEPS L2 CDFs straight from ISRO's PRADAN portal
    (aditya_l1/fetch_aditya_pradan.py -- a scripted Keycloak OAuth2 login, no CAPTCHA,
    using your own PRADAN account) and builds the proton series from them on the spot.
    Without those env vars set, falls back to the same actionable "download it yourself"
    error as before.
  - live: any range whose end falls within the trailing 7 days, from NOAA SWPC's
    real-time GOES-18 json (same >=10 MeV definition). Deliberately kept on GOES rather than
    ACE/EPAM or Aditya-L1: Aditya-L1 can't serve live data at all (same login gate), and
    ACE/EPAM's own real-time feed carries the same shot-noise-on-quiet-periods problem plus
    NOAA's stated plan to eventually retire the real-time ACE relay in favor of DSCOVR -- a
    worse bet for something meant to keep running than GOES, NOAA's own long-term
    operational feed.

Electrons (all three regimes) come from SOHO/EPHIN L2-1MIN via SEPpy, same as the rest of
the analysis tooling -- only the proton source changes by regime.
"""
import os
import datetime as dt
import glob
import sys
import numpy as np
import pandas as pd
import requests

EPS = 1e-4
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(os.path.join(CACHE_DIR, "ephin"), exist_ok=True)

SWPC_LIVE_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-7-day.json"
ADITYA_DIR = os.path.join(os.path.dirname(__file__), "aditya_l1")

# ISRO's own announced start of Aditya-L1/STEPS science data collection (activated 2023-09-10,
# announced 2023-09-18) -- https://www.isro.gov.in/Aditya_L1_collection_of_scientific_data.html
ADITYA_START = dt.datetime(2023, 9, 10)


class UnsupportedRangeError(Exception):
    pass


def classify_range(start, end):
    """Returns 'epam', 'aditya', 'live', or raises UnsupportedRangeError if the requested
    range straddles more than one of these regimes."""
    now = dt.datetime.utcnow()
    live_floor = now - dt.timedelta(days=7)
    if end < ADITYA_START:
        return "epam"
    if start >= ADITYA_START and end <= live_floor:
        return "aditya"
    if start >= live_floor and end <= now:
        return "live"
    raise UnsupportedRangeError(
        f"Requested range {start} .. {end} straddles more than one supported data regime "
        f"(ACE/EPAM, up to {ADITYA_START:%Y-%m-%d}; Aditya-L1 {ADITYA_START:%Y-%m-%d}.."
        f"{live_floor:%Y-%m-%d}; live GOES, last 7 days). Pick a range that stays within a "
        f"single regime."
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

    try:
        dfe, _ = soho_load(dataset="SOHO_COSTEP-EPHIN_L2-1MIN",
                            startdate=start.strftime("%Y/%m/%d"),
                            enddate=end.strftime("%Y/%m/%d"))
    except Exception as e:
        # seppy's own loader crashes (UnboundLocalError on its internal 'cs_e300'
        # metadata variable) rather than returning gracefully when no EPHIN RL2 file
        # exists yet for a requested date -- confirmed: this is exactly what happens
        # for a date too recent for near-real-time EPHIN publication (it typically
        # lags 1-2 days behind "now"). Translate that into our own clear, actionable
        # error instead of surfacing seppy's internal exception to the user.
        raise UnsupportedRangeError(
            f"Could not load SOHO/EPHIN electron data for {start:%Y-%m-%d} .. {end:%Y-%m-%d} "
            f"-- near-real-time EPHIN data typically lags 1-2 days behind \"now\", so this "
            f"range may just be too recent. Try an earlier end time. (underlying error: {e})"
        )
    if isinstance(dfe, list) or len(dfe) == 0:
        raise UnsupportedRangeError(
            f"No SOHO/EPHIN electron data found for {start:%Y-%m-%d} .. {end:%Y-%m-%d} -- "
            f"near-real-time EPHIN data typically lags 1-2 days behind \"now\", so this "
            f"range may just be too recent. Try an earlier end time."
        )
    e5 = dfe[["E150", "E300"]].resample("5min").mean()
    e5.to_pickle(cache_path)
    return e5


# ---------------------------------------------------------------------------
# Protons: ACE/EPAM, for the whole pre-Aditya-L1 span
# ---------------------------------------------------------------------------

def fetch_epam_historic(start, end):
    from ace_epam_data import load_epam_year

    years = range(start.year, end.year + 1)
    p5 = pd.concat([load_epam_year(y, "P8") for y in years]).sort_index()
    p5 = p5.loc[pd.Timestamp(start):pd.Timestamp(end)]
    # EPAM's native 5-min grid is offset from EPHIN's :00/:05/:10 resample boundaries --
    # see ace_epam_data.py's identical fix for why this resample is needed.
    p5 = p5.resample("5min").mean()
    p5 = p5.interpolate(limit=3).clip(lower=0)
    return p5


# ---------------------------------------------------------------------------
# Protons: Aditya-L1 -- already-downloaded local data first, then PRADAN auto-fetch
# ---------------------------------------------------------------------------

def _fetch_aditya_from_local_csvs(start_ts, end_ts):
    # Only consider raw builds, not a "_phased"/"_phased_causal" variant -- those carry
    # their own baked-in background/rising/falling columns from a specific experiment,
    # which would be irrelevant here since only the `proton` column is read.
    candidates = [p for p in sorted(glob.glob(os.path.join(ADITYA_DIR, "data_*.csv")))
                  if "phased" not in os.path.basename(p)]
    for path in candidates:
        df = pd.read_csv(path)
        if "proton" not in df.columns or "time" not in df.columns:
            continue
        df["time"] = pd.to_datetime(df["time"])
        df = df.set_index("time").sort_index()
        if df.empty or df.index.min() > start_ts + pd.Timedelta(minutes=30) \
                or df.index.max() < end_ts - pd.Timedelta(minutes=30):
            continue  # doesn't actually cover the requested window, just overlaps a sliver
        window = df.loc[start_ts:end_ts, "proton"]
        # the stored column is already ln(flux) -- undo that so build_dataset()'s shared
        # np.log() step below stays uniform across all four regimes.
        raw = np.exp(window)
        return raw.resample("5min").mean().interpolate(limit=3).clip(lower=0)
    return None


def _fetch_aditya_from_pradan(start, end, username, password):
    """Auto-fetch path: log into PRADAN, download any missing STEPS L2 CDFs for the
    requested window straight into aditya_l1/raw/ (persistent -- a repeat request for
    an overlapping window re-downloads nothing), then reuse build_aditya_data.py's own
    CDF-parsing logic (same direction/detector/channel choice: PS/Inner/highest bin,
    see that script's docstring for why) to get a raw proton series."""
    sys.path.insert(0, ADITYA_DIR)
    from fetch_aditya_pradan import login, fetch_day  # noqa: E402
    from build_aditya_data import load_steps_proton  # noqa: E402

    raw_dir = os.path.join(ADITYA_DIR, "raw")
    session = requests.Session()
    login(session, username, password)

    d = start.date()
    any_downloaded = False
    while d <= end.date():
        result = fetch_day(session, d, "PS", raw_dir)
        any_downloaded = any_downloaded or result != "missing"
        d += dt.timedelta(days=1)
    if not any_downloaded:
        raise UnsupportedRangeError(
            f"PRADAN has no STEPS L2 data for {start:%Y-%m-%d} .. {end:%Y-%m-%d} "
            f"(before Aditya-L1 launch, or a genuine catalog gap)."
        )

    proton_raw = load_steps_proton(raw_dir, "PS", "Inner")
    p5 = proton_raw.resample("5min").mean()
    p5 = p5.loc[pd.Timestamp(start):pd.Timestamp(end)]
    return p5.interpolate(limit=3).clip(lower=0)


def fetch_aditya_local(start, end):
    start_ts, end_ts = pd.Timestamp(start), pd.Timestamp(end)
    found = _fetch_aditya_from_local_csvs(start_ts, end_ts)
    if found is not None:
        return found

    username = os.environ.get("PRADAN_USERNAME")
    password = os.environ.get("PRADAN_PASSWORD")
    if not username or not password:
        raise UnsupportedRangeError(
            f"No locally-downloaded Aditya-L1 data covers {start} .. {end}, and no "
            f"PRADAN_USERNAME/PRADAN_PASSWORD are set in this process's environment to "
            f"auto-fetch it (see aditya_l1/fetch_aditya_pradan.py -- needs your own "
            f"PRADAN account). Set those two env vars and restart the server, download "
            f"the window by hand with aditya_l1/build_aditya_data.py, or pick a range "
            f"before {ADITYA_START:%Y-%m-%d} (uses ACE/EPAM instead)."
        )

    try:
        return _fetch_aditya_from_pradan(start, end, username, password)
    except UnsupportedRangeError:
        raise
    except Exception as e:
        raise UnsupportedRangeError(
            f"PRADAN auto-fetch failed for {start:%Y-%m-%d} .. {end:%Y-%m-%d}: {e}"
        )


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
    if kind == "epam":
        p5 = fetch_epam_historic(fetch_start, end)
    elif kind == "aditya":
        p5 = fetch_aditya_local(fetch_start, end)
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
