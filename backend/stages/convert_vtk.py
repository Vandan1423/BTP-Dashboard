"""
VTK -> VDB for ONE uploaded timestep, on the PINNED grid.

Runs inside the environment that has openvdb (the `vdb-convert` conda env on
the Mac). The service calls it as a subprocess and reads its stdout.

    python convert_vtk.py --input data.0184.vtk --output volume.vdb --grid grid.json

This is `Vandan/scripts/pipeline/VtkToVdbPipeline.py` for a single file, with
the one difference that matters: the voxel grid is NOT computed from this
file. The batch converter works out bounds, voxel size and transform once from
data.0000.vtk and shares them across every file by construction. A per-upload
job that recomputed them from the uploaded file's own bounds would land the
volume in a slightly different space from the Sun, the planets and the cameras,
and nothing would error -- the render would just be quietly wrong. So the grid
comes from grid.json, which tools/pin_grid.py derived from data.0000.vtk and
checked against the archived data.0000.vdb.

Lines starting with @@ are for the service; everything else is the human log.
"""
import argparse
import json
import sys
import time

import numpy as np
import openvdb
import pyvista as pv

FIELDS = ["rho", "tr1"]
# The CME tracer is ~1 inside ejected material and ~0 elsewhere, so this is a
# count of voxels that hold CME, not a tuning knob.
TRACER_THRESHOLD = 0.1


def emit(tag, **kw):
    body = " ".join(f"{k}={v}" for k, v in kw.items())
    print(f"@@{tag} {body}".rstrip(), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--output")
    ap.add_argument("--grid", required=True)
    ap.add_argument("--measure", help="only report tracer occupancy of an existing .vdb")
    args = ap.parse_args()

    if args.measure:
        return measure(args.measure)
    if not args.input or not args.output:
        ap.error("--input and --output are required unless --measure is given")

    with open(args.grid) as f:
        grid = json.load(f)
    R = int(grid["resolution"])
    vs = float(grid["voxel_size"])
    origin = tuple(float(v) for v in grid["origin"])

    t_all = time.time()

    # ---- read -------------------------------------------------------------
    t0 = time.time()
    print(f"[vtk2vdb] reading {args.input}", flush=True)
    try:
        mesh = pv.read(args.input)
    except Exception as e:  # a file that is not VTK at all
        emit("error", message=f"could not read the file as VTK: {type(e).__name__}: {e}")
        return 2
    t_read = time.time() - t0

    available = list(mesh.cell_data.keys())
    missing = [f for f in FIELDS if f not in available]
    if missing:
        emit("error", message=f"the file has no {', '.join(missing)} field; it has {', '.join(available) or 'no cell fields'}")
        return 3
    print(f"[vtk2vdb] {type(mesh).__name__}, {mesh.n_cells:,} cells, fields {available}", flush=True)
    emit("progress", value=0.25)

    # ---- is this the same domain? -------------------------------------------
    # Not an error: resampling into the pinned box is exactly what should happen.
    # But a different domain means a different simulation, and that is worth
    # saying out loud in the log rather than discovering from the render.
    b = mesh.bounds
    pinned = grid["bounds"]
    worst = max(abs(float(b[i]) - float(pinned[i])) for i in range(6))
    if worst > 1e-3 * max(abs(float(p)) for p in pinned):
        emit("warn", message=(
            f"domain bounds differ from the pinned grid by up to {worst:.4f} AU; "
            f"resampling into the pinned box anyway"))
    else:
        print("[vtk2vdb] domain matches the pinned grid", flush=True)

    for name in list(mesh.cell_data.keys()):
        if name not in FIELDS:
            del mesh.cell_data[name]

    # ---- cell data -> point data ------------------------------------------
    t0 = time.time()
    print("[vtk2vdb] cell_data_to_point_data: rho, tr1", flush=True)
    mesh = mesh.cell_data_to_point_data()
    t_c2p = time.time() - t0
    emit("progress", value=0.32)

    # ---- resample onto the pinned grid --------------------------------------
    t0 = time.time()
    print(f"[vtk2vdb] resampling to {R}^3 on the PINNED grid from {grid['source']}", flush=True)
    print(f"[vtk2vdb] voxel {vs!r} AU, origin {origin}  <- reused, not recomputed", flush=True)
    image = pv.ImageData(dimensions=(R, R, R), spacing=(vs, vs, vs), origin=origin)
    resampled = image.sample(mesh)
    t_resample = time.time() - t0
    emit("progress", value=0.9)

    # ---- write ---------------------------------------------------------------
    t0 = time.time()
    transform = openvdb.createLinearTransform(voxelSize=vs)
    transform.postTranslate(origin)
    grids = []
    arrays = {}
    for name in FIELDS:
        values = resampled.point_data[name].reshape((R, R, R), order="F")
        values = np.ascontiguousarray(values, dtype=np.float32)
        arrays[name] = values
        g = openvdb.FloatGrid()
        g.copyFromArray(values)
        g.name = name
        g.transform = transform
        grids.append(g)
    openvdb.write(args.output, grids=grids)
    t_write = time.time() - t0

    tracer_voxels = int(np.count_nonzero(arrays["tr1"] > TRACER_THRESHOLD))
    total = R ** 3
    fraction = tracer_voxels / total
    print(f"[vtk2vdb] tr1 > {TRACER_THRESHOLD} in {tracer_voxels:,} of {total:,} voxels ({fraction * 100:.2f}%)", flush=True)
    print(f"[vtk2vdb] wrote {args.output} in {time.time() - t_all:.1f}s "
          f"(read {t_read:.1f}, cell->point {t_c2p:.1f}, resample {t_resample:.1f}, write {t_write:.1f})", flush=True)
    emit("occupancy", fraction=f"{fraction:.6f}", voxels=tracer_voxels, total=total,
         rho_max=f"{float(arrays['rho'].max()):.6g}")
    emit("progress", value=1.0)
    return 0


def measure(path):
    """Occupancy of a volume converted elsewhere -- an archived timestep."""
    t0 = time.time()
    result = {}
    for name in FIELDS:
        g = openvdb.read(path, name)
        lo, hi = g.evalActiveVoxelBoundingBox()
        dims = [max(0, hi[i] - lo[i] + 1) for i in range(3)]
        if min(dims) == 0:
            result[name] = np.zeros(0, dtype=np.float32)
            continue
        a = np.zeros(dims, dtype=np.float32)
        g.copyToArray(a, ijk=lo)
        result[name] = a
    voxels = int(np.count_nonzero(result["tr1"] > TRACER_THRESHOLD))
    total = 256 ** 3
    rho_max = float(result["rho"].max()) if result["rho"].size else 0.0
    print(f"[vtk2vdb] tr1 > {TRACER_THRESHOLD} in {voxels:,} of {total:,} voxels "
          f"({voxels / total * 100:.2f}%), measured in {time.time() - t0:.1f}s", flush=True)
    emit("occupancy", fraction=f"{voxels / total:.6f}", voxels=voxels, total=total, rho_max=f"{rho_max:.6g}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
