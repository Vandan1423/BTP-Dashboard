"""
Where Mercury, Venus, Earth and Mars were at one moment, from Solar-MACH.

Runs inside the environment that has solarmach (`BTP/.venv` on the Mac). The
service calls it only for a date that is NOT already one of the run's
timesteps; those are read straight from camera_positions.csv, which is this
same query's output for exactly those dates.

    python solarmach_positions.py --datetime "2024-11-08 02:15:00" --output positions.json

The coordinate conversion is copied from
Vandan/scripts/pipeline/GetPlanetsPositions.py and must stay identical to it.
Solar-MACH returns Carrington longitudes, which rotate with the Sun; adding back
the Sun's sidereal rotation since the run's first timestep gives an inertial
frame, which is the frame the Blender cameras and the CSV are in. Without that,
Earth appears to lap the Sun twice in 55 days (SOLAR_WIND_CME_GUIDE.md §8).
"""
import argparse
import json
import sys
import time
from datetime import datetime

import numpy as np
from solarmach import SolarMACH

SIDEREAL_ROTATION_DAYS = 25.3783
SIDEREAL_RATE_DEG_PER_DAY = 360 / SIDEREAL_ROTATION_DAYS
START_TIME = datetime(2024, 9, 18, 2, 52, 2, 428000)
BODIES = ["Mercury", "Venus", "Earth", "Mars"]
VSW = [400, 400, 400, 400]


def to_cartesian(r, lat_deg, lon_deg):
    theta = np.radians(90 - lat_deg)
    phi = np.radians(lon_deg)
    return (float(r * np.sin(theta) * np.cos(phi)),
            float(r * np.sin(theta) * np.sin(phi)),
            float(r * np.cos(theta)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datetime", required=True, help="UTC, YYYY-MM-DD HH:MM:SS")
    ap.add_argument("--output", required=True)
    ap.add_argument("--retries", type=int, default=3)
    args = ap.parse_args()

    when = datetime.strptime(args.datetime, "%Y-%m-%d %H:%M:%S")
    elapsed_days = (when - START_TIME).total_seconds() / 86400
    print(f"[solar-mach] querying JPL Horizons for {args.datetime} UTC", flush=True)

    sm = None
    for attempt in range(1, args.retries + 1):
        try:
            sm = SolarMACH(date=args.datetime, body_list=BODIES, vsw_list=VSW)
            break
        except Exception as e:
            if attempt == args.retries:
                print(f"@@error message=Solar-MACH failed after {attempt} attempts: {type(e).__name__}: {e}", flush=True)
                return 2
            wait = 5 * attempt
            print(f"[solar-mach] attempt {attempt} failed ({type(e).__name__}); retrying in {wait}s", flush=True)
            time.sleep(wait)

    out = {}
    for _, row in sm.coord_table.iterrows():
        body = row["Spacecraft/Body"]
        lon = row["Carrington longitude (°)"] + SIDEREAL_RATE_DEG_PER_DAY * elapsed_days
        x, y, z = to_cartesian(row["Heliocentric distance (AU)"], row["Carrington latitude (°)"], lon)
        out[body] = {"x": x, "y": y, "z": z, "r": float(np.sqrt(x * x + y * y + z * z))}
        print(f"[solar-mach] {body}: x={x:.3f} y={y:.3f} z={z:.3f} AU", flush=True)

    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print("@@done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
