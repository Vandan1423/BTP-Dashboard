"""
Timesteps are dates, and dates are planet positions.

The .vtk files carry no time of their own. The mapping came from the professor
and is the same one the frontend's timing.js uses:

    t(N) = 2024-09-18 02:52:02.428 UTC + N x 23936 s

For a date that IS one of the run's 201 timesteps, the positions are read from
camera_positions.csv -- that file is Solar-MACH's output for exactly those
dates, the same numbers keyframed into the Blender cameras, so re-querying JPL
could only add a network failure. Any other date goes to Solar-MACH live.

The form works to the minute, and index 169 is 22:31:46, so a date within a
minute of a timestep is taken to mean that timestep.
"""
from __future__ import annotations

import csv
from datetime import datetime, timedelta

EPOCH = datetime(2024, 9, 18, 2, 52, 2, 428000)
STEP_SECONDS = 23936
LAST_INDEX = 200
BODIES = ["Mercury", "Venus", "Earth", "Mars"]


def datetime_for(index: int) -> datetime:
    return EPOCH + timedelta(seconds=index * STEP_SECONDS)


def label(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def parse(value: str) -> datetime:
    value = (value or "").strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    raise ValueError(f"expected YYYY-MM-DD HH:MM, got {value!r}")


def matching_index(dt: datetime, tolerance_s: float = 60.0) -> int | None:
    """The timestep this date refers to, if it refers to one."""
    n = round((dt - EPOCH).total_seconds() / STEP_SECONDS)
    if not 0 <= n <= LAST_INDEX:
        return None
    if abs((dt - datetime_for(n)).total_seconds()) > tolerance_s:
        return None
    return n


def from_csv(path: str, index: int) -> dict | None:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if int(row["vtk_index"]) != index:
                continue
            x, y, z = float(row["x_au"]), float(row["y_au"]), float(row["z_au"])
            out[row["body"]] = {"x": x, "y": y, "z": z, "r": (x * x + y * y + z * z) ** 0.5}
    return out if all(b in out for b in BODIES) else None
