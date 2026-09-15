"""
Write grid.json: the voxel grid every uploaded file is resampled onto.

Derives the grid exactly the way Vandan/scripts/pipeline/VtkToVdbPipeline.py
does -- bounds of data.0000.vtk, 256 voxels along the longest edge -- and then
checks the answer against the transform stored in the archived data.0000.vdb.
If the two disagree, the archive was converted on a different grid and the
file is not written: pinning the wrong numbers is precisely the silent failure
this exists to prevent.

Run once per machine, in the environment with openvdb:

    python tools/pin_grid.py --vtk <Vandan>/input/vtk/data.0000.vtk \
                             --vdb <Vandan>/input/vdb/data.0000.vdb \
                             --out grid.json
"""
import argparse
import json
import math
import os
import sys

import openvdb
import pyvista as pv

RESOLUTION = 256


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vtk", required=True)
    ap.add_argument("--vdb", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    mesh = pv.read(args.vtk)
    xmin, xmax, ymin, ymax, zmin, zmax = (float(v) for v in mesh.bounds)
    voxel = max(xmax - xmin, ymax - ymin, zmax - zmin) / (RESOLUTION - 1)
    origin = (xmin, ymin, zmin)

    grids, _ = openvdb.readAll(args.vdb)
    t = grids[0].transform
    vdb_voxel = t.voxelSize()[0]
    vdb_origin = t.indexToWorld((0, 0, 0))

    ok = math.isclose(vdb_voxel, voxel, rel_tol=1e-9) and all(
        math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12) for a, b in zip(vdb_origin, origin))
    print(f"from {os.path.basename(args.vtk)}: voxel {voxel!r}, origin {origin}")
    print(f"from {os.path.basename(args.vdb)}: voxel {vdb_voxel!r}, origin {tuple(vdb_origin)}")
    if not ok:
        print("MISMATCH: the archived volume was not converted on this grid. Not writing.")
        return 1

    out = {
        "resolution": RESOLUTION,
        "voxel_size": voxel,
        "origin": list(origin),
        "bounds": [xmin, xmax, ymin, ymax, zmin, zmax],
        "units": "AU",
        "source": os.path.basename(args.vtk),
        "verified_against": os.path.basename(args.vdb),
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(f"match. wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
