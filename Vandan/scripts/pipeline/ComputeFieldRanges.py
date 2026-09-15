"""Compute a real, reproducible auto-range for the volume shader from the VTK
data itself, instead of hand-tuning numbers by eye or trusting OpenVDB's naive
min/max.

Why not OpenVDB's own auto-range: measured directly (2026-08-26) - `tr1` is
exactly 0 across most of the domain, and OpenVDB marks background-value voxels
INACTIVE. A min/max scan over active voxels on an early frame (before the CME
exists) finds nothing and returns its FLT_MAX/-FLT_MAX initialisers, which
Blender's SciBlend panel displays as inf/-inf. `rho`'s naive max (81.08, from
SOLAR_WIND_CME_GUIDE.md 6) is a single-voxel resampling outlier that crushes
all real structure when used as a linear ceiling.

Percentiles fix both: they ignore rare outliers by construction, and they're
computed from the raw VTK point data directly (not the resampled VDB grid), so
an empty early frame can't return inf - it just contributes zeros to the pool.

Run from the project's .venv (pyvista/numpy live there, not in Blender's bundled
Python):

    cd Vandan && ../.venv/bin/python scripts/pipeline/ComputeFieldRanges.py
"""

import glob
import os
import re

import numpy as np
import pyvista as pv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_DIR = os.path.join(BASE_DIR, "input", "vtk")

# r^2*rho divides out the r^-2 falloff from spherical expansion that makes raw
# rho span ~1800x across the domain (measured) - see the chat discussion this
# script grew out of. tr1 is included as a sanity check: it should come back
# ~0..1, confirming the percentile method reproduces the value already found by
# hand in SOLAR_WIND_CME_GUIDE.md 6.
FIELDS = ["tr1", "r2rho"]
PERCENTILES = [1, 50, 99]

files = sorted(glob.glob(os.path.join(INPUT_DIR, "data.*.vtk")))
if not files:
    raise SystemExit(f"No data.*.vtk found in {INPUT_DIR}")
print(f"Scanning {len(files)} timesteps: "
      f"{os.path.basename(files[0])} .. {os.path.basename(files[-1])}\n")

pools = {f: [] for f in FIELDS}
for path in files:
    idx = re.search(r"data\.(\d+)\.vtk$", path).group(1)
    m = pv.read(path).cell_data_to_point_data()
    r2 = np.sum(m.points ** 2, axis=1)
    for f in FIELDS:
        if f == "r2rho":
            vals = np.asarray(m.point_data["rho"], dtype=np.float64) * r2
        else:
            vals = np.asarray(m.point_data[f], dtype=np.float64)
        pools[f].append(vals)
    print(f"  read {idx}", end="\r", flush=True)
print()

print(f"\n{'field':10s} " + "".join(f"p{p:<9}" for p in PERCENTILES))
results = {}
for f in FIELDS:
    allvals = np.concatenate(pools[f])
    qs = np.percentile(allvals, PERCENTILES)
    results[f] = qs
    print(f"{f:10s} " + "".join(f"{q:<10.4g}" for q in qs))

print("\nCopy into BuildSpaceScene.py:")
lo_tr1, _, hi_tr1 = results["tr1"]
lo_r2, _, hi_r2 = results["r2rho"]
print(f"  DENSITY_FROM_MIN, DENSITY_FROM_MAX = {max(lo_tr1, 0.0):.4g}, {hi_tr1:.4g}")
print(f"  COLOR_FROM_MIN, COLOR_FROM_MAX     = {lo_r2:.4g}, {hi_r2:.4g}")
