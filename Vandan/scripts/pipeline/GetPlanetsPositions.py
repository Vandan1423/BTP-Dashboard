from solarmach import SolarMACH
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import os
import glob
import re

# Derived from this script's own location, not the cwd it's run from -
# works as long as scripts/pipeline/ stays inside the Vandan/ folder, wherever that is.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUTPUT_CSV = os.path.join(BASE_DIR, "input", "ephemeris", "camera_positions.csv")

#Constants
SIDEREAL_ROTATION_DAYS = 25.3783
SIDEREAL_RATE_DEG_PER_DAY = 360 / SIDEREAL_ROTATION_DAYS

#Define a function to convert from carrington coordinates to cartesian coordinates
def to_cartesian(r, lat_deg, lon_deg):
    theta = np.radians(90 - lat_deg)
    phi = np.radians(lon_deg)
    x = r * np.sin(theta) * np.cos(phi)
    y = r * np.sin(theta) * np.sin(phi)
    z = r * np.cos(theta)
    return x, y, z


#Define the start time and timesteps
start_time = datetime(2024, 9, 18, 2, 52, 2, 428000)
seconds_per_index = 598400 / 25

#Define the time indices - read them off disk instead of hardcoding a range, so
#this works unchanged whether the professor ships 21 files at step 10 or 201 at
#step 1. Hardcoded cadence is what silently desynced the volume from the cameras.
# Set this when the .vtk files live on another machine - SolarMACH output is pure
# astronomy with no machine dependency, so the CSV is normally generated on the
# laptop and copied to the GPU box rather than installing solarmach there.
# Format: (first, last_inclusive, step), e.g. (0, 200, 1).
INDEX_OVERRIDE = (0, 200, 1)

INPUT_DIR = os.path.join(BASE_DIR, "input", "vtk")
if INDEX_OVERRIDE is not None:
    _a, _b, _step = INDEX_OVERRIDE
    indices = list(range(_a, _b + 1, _step))
else:
    _files = glob.glob(os.path.join(INPUT_DIR, "data.*.vtk"))
    indices = sorted(int(re.search(r"data\.(\d+)\.vtk$", f).group(1)) for f in _files)
if not indices:
    raise SystemExit(f"No data.*.vtk found in {INPUT_DIR} and no INDEX_OVERRIDE set")
print(f"Found {len(indices)} timesteps: {indices[0]}..{indices[-1]} "
      f"(step {indices[1]-indices[0] if len(indices) > 1 else 'n/a'})")

#Define the body list and vsw list for the SolarMACH class
body_list = ["Mercury", "Venus", "Earth", "Mars"]
vsw_list = [400, 400, 400, 400]

import time

#Each SolarMACH() call fetches all 4 bodies from JPL Horizons (ssd.jpl.nasa.gov)
#in one constructor call, so 201 timesteps is 201 outer calls / ~804 body lookups
#server-side. JPL is a shared government server with no SLA to us - it WILL
#occasionally stall or drop a connection (measured: one request hung until
#macOS's own ~6 minute TCP timeout fired). A bare loop with no retry means one
#bad request anywhere in 804 throws away every result computed before it.
MAX_RETRIES = 5
BASE_BACKOFF_SEC = 10  # doubles each retry: 10, 20, 40, 80, 160

def fetch_with_retry(date_str):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return SolarMACH(date=date_str, body_list=body_list, vsw_list=vsw_list)
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = BASE_BACKOFF_SEC * (2 ** (attempt - 1))
            print(f"  JPL request failed ({type(e).__name__}: {e}) "
                  f"- retry {attempt}/{MAX_RETRIES} in {wait}s", flush=True)
            time.sleep(wait)

#Resumable: skip any vtk_index that already has all 4 bodies written to the CSV
#from a previous run. The position for a given index depends only on that index's
#date, so a row fetched by an earlier (even differently-scoped) run is still
#valid data - nothing needs to be recomputed, only what's genuinely missing.
existing_indices = set()
if os.path.exists(OUTPUT_CSV):
    _existing = pd.read_csv(OUTPUT_CSV)
    _counts = _existing.groupby("vtk_index").size()
    existing_indices = set(_counts[_counts >= len(body_list)].index.astype(int))
    print(f"Resuming: {len(existing_indices)} timestep(s) already complete in "
          f"{os.path.basename(OUTPUT_CSV)}, skipping those", flush=True)

_wrote_header = os.path.exists(OUTPUT_CSV)
_t_start = time.time()
_done = 0
for _n, N in enumerate(indices, 1):
    if N in existing_indices:
        continue
    t = start_time + timedelta(seconds=N*seconds_per_index)
    date_str = t.strftime("%Y-%m-%d %H:%M:%S")
    sm = fetch_with_retry(date_str)
    _done += 1
    _eta = (len(indices) - _n) * (time.time() - _t_start) / _done / 60 if _done else float("nan")
    print(f"[{_n}/{len(indices)}] idx {N} ({date_str})  ETA {_eta:.1f} min", flush=True)

    rows = []
    for _, row in sm.coord_table.iterrows():
        elapsed_days = (N * seconds_per_index) / 86400
        inertial_lon = row["Carrington longitude (°)"] + SIDEREAL_RATE_DEG_PER_DAY * elapsed_days
        x, y, z = to_cartesian(
            row["Heliocentric distance (AU)"],
            row["Carrington latitude (°)"],
            inertial_lon,
        )
        rows.append({
            "vtk_index": N,
            "date": date_str,
            "body": row["Spacecraft/Body"],
            "x_au": x,
            "y_au": y,
            "z_au": z,
        })

    #Append this timestep's rows to disk IMMEDIATELY, all 4 bodies in one write -
    #so a crash on the NEXT index still leaves every prior index safely on disk,
    #instead of losing the whole run's progress like the crash that motivated this.
    pd.DataFrame(rows).to_csv(OUTPUT_CSV, mode='a', header=not _wrote_header, index=False)
    _wrote_header = True

positions_df = pd.read_csv(OUTPUT_CSV)
print(f"Done. {len(positions_df)} rows, {positions_df['vtk_index'].nunique()} timesteps -> {OUTPUT_CSV}")
