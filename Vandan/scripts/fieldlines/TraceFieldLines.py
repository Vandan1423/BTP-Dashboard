"""
Magnetic-field streamlines for the solar wind + CME dataset.

Pipeline (deliberately does NOT touch the VDB pipeline at all):

    data.NNNN.vtk
      -> cell_data_to_point_data()          (tracer needs interpolable point data)
      -> rotate (Bx1,Bx2,Bx3) into Cartesian
      -> vtkStreamTracer from a FIXED seed set
      -> .tube()  (real geometry)
      -> bake RGB into vertex colours
      -> fieldlines.NNNN.ply

Blender reads .ply natively, so no SciBlend and no VDB is involved on this path.
The existing tr1 volume pipeline in ../../scripts/fieldlines/ is untouched.

--------------------------------------------------------------------------
WHY THE ROTATION IS PER-POINT AND NOT ONE MATRIX
--------------------------------------------------------------------------
This is the part that matters scientifically, so it is written down here.

PLUTO ran in GEOMETRY SPHERICAL, so its generic component names mean

    vx1, vx2, vx3 = (v_r, v_theta, v_phi)
    Bx1, Bx2, Bx3 = (B_r, B_theta, B_phi)

i.e. each component is measured against the LOCAL spherical basis vectors
r_hat, theta_hat, phi_hat at that point. Those basis vectors point in a
DIFFERENT direction at every single grid point -- r_hat at (1,0,0) points along
+x, while r_hat at (0,1,0) points along +y. So there is no single global
rotation matrix that converts the whole field; the rotation is position
dependent and has to be rebuilt from each point's own (theta, phi).

That is exactly what to_cartesian() below does, using coordinates the .vtk file
already stores in Cartesian form.

CONFIRMED FROM THE DATA (not assumed from PLUTO convention): the solar wind
blows radially outward, so cos(v, r_hat) has a known correct answer.
  reading components as Cartesian -> mean cos = +0.005   (noise)
  reading components as spherical -> mean cos = +1.000   (correct)
Skipping this rotation still produces plausible-looking curved lines. They are
simply wrong. This is the main correctness claim of this script.

Validation that the rotated field is physical:
  |B| * r^2 = 0.052 / 0.050 / 0.050 at r = 0.2 / 0.4 / 0.8 AU   -> Parker 1/r^2
  atan(B_phi/B_r) = 1.3 -> 10.3 -> 37.6 deg at r = 0.3 -> 1.0 -> 2.0 AU
                                                  -> spiral winds up with radius
  B_r flips sign with longitude at 1 AU            -> heliospheric current sheet

Run (Mac):
    /Users/vandannagori/Documents/BTP/.venv/bin/python TraceFieldLines.py
Run (GPU box, inside the vdb-convert conda env):
    python TraceFieldLines.py
"""

import os
import re
import glob
import time

import numpy as np
import pyvista as pv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_DIR = os.path.join(BASE_DIR, "input", "vtk")
OUTPUT_DIR = os.path.join(BASE_DIR, "input", "ply")

# ----------------------------------------------------------------- seeding --
# The seeds MUST be identical on every frame. If you re-seed per frame (or seed
# randomly), each frame's lines land in slightly different places and the
# animation strobes//flickers even though the underlying physics is smooth.
# Fixed seeds -> the same field lines, evolving.
SEED_RADIUS = 0.14        # just outside the r=0.1 inner boundary
N_SEED_LON = 26           # seeds around the equator
N_SEED_LAT = 9            # seeds in latitude
# The domain only spans colatitude 30..150 deg. Seeds outside that band sit in a
# region with no data, exit immediately, and give a visibly lopsided picture.
# Inset a little further so lines start well inside real data.
COLAT_MIN_DEG = 38.0
COLAT_MAX_DEG = 142.0

# ------------------------------------------------------------------ tracing --
MAX_LENGTH = 60.0         # integration length cap, in AU of arc-length
MAX_STEPS = 3000
INITIAL_STEP = 0.01
TUBE_RADIUS = 0.0035      # AU. Tuned down from 0.006: at 4096x2048 equirect the
                          # lines passing near the camera were reading as huge
                          # foreground slabs and hiding the spiral behind them.
TUBE_SIDES = 6            # keep low: this multiplies the vertex count directly

# ----------------------------------------------------------------- colouring --
# Two things are encoded into one RGB attribute, because .ply carries exactly one
# reliable colour attribute:
#   base colour  = log|B|  through a COOL map (blue -> cyan)
#   blend toward HOT_COLOR where tr1 (the CME tracer) is high
# So: blue/cyan = ordinary solar-wind field, orange = field threaded by the CME.
# Cool base is deliberate -- the tr1 volume it overlays is rendered in `inferno`
# (orange/white), so a blue field reads as a separate object instead of mush.
HOT_COLOR = np.array([1.00, 0.45, 0.10])
B_LOG_LO, B_LOG_HI = -2.6, 0.3   # log10|B| clip range, from the measured data
TR1_HI = 0.15                    # tr1 at which a line is fully "CME-threaded"


def build_seed_points():
    """Fixed seed set, confined to the domain's real colatitude band."""
    colat = np.radians(np.linspace(COLAT_MIN_DEG, COLAT_MAX_DEG, N_SEED_LAT))
    lon = np.linspace(0.0, 2.0 * np.pi, N_SEED_LON, endpoint=False)
    c, l = np.meshgrid(colat, lon, indexing="ij")
    c, l = c.ravel(), l.ravel()
    pts = np.column_stack([
        SEED_RADIUS * np.sin(c) * np.cos(l),
        SEED_RADIUS * np.sin(c) * np.sin(l),
        SEED_RADIUS * np.cos(c),
    ])
    return pv.PolyData(pts)


def to_cartesian(mesh, a1, a2, a3):
    """
    Rotate a (radial, colatitudinal, azimuthal) vector field into Cartesian XYZ.

    Each point's own basis is rebuilt from its own position -- see the module
    docstring for why a single global matrix cannot work here.
    """
    P = mesh.points
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    r = np.linalg.norm(P, axis=1)
    r_safe = np.maximum(r, 1e-12)

    theta = np.arccos(np.clip(z / r_safe, -1.0, 1.0))   # colatitude from +z
    phi = np.arctan2(y, x)                              # azimuth in the xy-plane
    st, ct = np.sin(theta), np.cos(theta)
    sp, cp = np.sin(phi), np.cos(phi)

    r_hat = np.column_stack([st * cp, st * sp, ct])
    t_hat = np.column_stack([ct * cp, ct * sp, -st])
    p_hat = np.column_stack([-sp, cp, np.zeros_like(sp)])

    return (mesh.point_data[a1][:, None] * r_hat
            + mesh.point_data[a2][:, None] * t_hat
            + mesh.point_data[a3][:, None] * p_hat)


def winter(t):
    """
    matplotlib's 'winter' colormap, inlined: blue (0,0,1) -> green (0,1,0.5).

    Written out rather than imported so this script needs only numpy + pyvista.
    matplotlib IS currently a transitive dependency of pyvista, but relying on
    that would make the whole trace fail on the shared GPU box if pyvista's deps
    ever shift - for three lines of arithmetic that is not a trade worth making.
    """
    t = t[:, None]
    return np.concatenate([np.zeros_like(t), t, 1.0 - 0.5 * t], axis=1)


def bake_colors(tubes):
    """log|B| -> cool colormap, blended toward HOT_COLOR where tr1 is high."""
    bmag = np.linalg.norm(tubes.point_data["B_cart"], axis=1)
    t = (np.log10(np.maximum(bmag, 1e-12)) - B_LOG_LO) / (B_LOG_HI - B_LOG_LO)
    rgb = winter(np.clip(t, 0.0, 1.0))

    w = np.clip(tubes.point_data["tr1"] / TR1_HI, 0.0, 1.0)[:, None]
    rgb = rgb * (1.0 - w) + HOT_COLOR[None, :] * w

    return (np.clip(rgb, 0.0, 1.0) * 255).astype(np.uint8)


def main():
    files = glob.glob(os.path.join(INPUT_DIR, "data.*.vtk"))
    indices = sorted(int(re.search(r"data\.(\d+)\.vtk$", f).group(1)) for f in files)
    if not indices:
        raise SystemExit(f"No data.*.vtk found in {INPUT_DIR}")
    print(f"Found {len(indices)} timesteps: {indices[0]}..{indices[-1]}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    seed = build_seed_points()
    print(f"Seeds: {seed.n_points} fixed points at r={SEED_RADIUS} AU, "
          f"colat {COLAT_MIN_DEG}..{COLAT_MAX_DEG} deg")

    t_start = time.time()
    for n, idx in enumerate(indices, 1):
        out_path = os.path.join(OUTPUT_DIR, f"fieldlines.{idx:04d}.ply")
        if os.path.exists(out_path):
            print(f"[{n}/{len(indices)}] {idx:04d}: exists, skipping", flush=True)
            continue

        t0 = time.time()
        mesh = pv.read(os.path.join(INPUT_DIR, f"data.{idx:04d}.vtk"))
        mesh = mesh.cell_data_to_point_data()
        mesh["B_cart"] = to_cartesian(mesh, "Bx1", "Bx2", "Bx3")

        lines = mesh.streamlines_from_source(
            seed,
            vectors="B_cart",
            integration_direction="both",
            max_length=MAX_LENGTH,
            max_steps=MAX_STEPS,
            initial_step_length=INITIAL_STEP,
        )

        if lines.n_points == 0:
            print(f"[{n}/{len(indices)}] {idx:04d}: WARNING no streamlines", flush=True)
            continue

        tubes = lines.tube(radius=TUBE_RADIUS, n_sides=TUBE_SIDES)
        rgb = bake_colors(tubes)

        # Strip everything except geometry + colour. The traced lines carry all 13
        # data arrays plus vtk's own Vorticity/Rotation/Normals; writing those into
        # the .ply multiplies file size for data Blender will never read.
        #
        # Strip IN PLACE and save `tubes` itself -- do NOT rebuild via
        # pv.PolyData(tubes.points, faces=tubes.faces). .tube() emits TRIANGLE
        # STRIPS, so .faces is empty ([]) and that rebuild silently produces a
        # face-less POINT CLOUD that still writes a valid .ply and still opens
        # without error. It just renders as dots. The .ply writer triangulates the
        # strips on write, so saving the tube directly is both correct and smaller.
        for _d in (tubes.point_data, tubes.cell_data):
            for _name in list(_d.keys()):
                del _d[_name]
        tubes.point_data["RGB"] = rgb
        tubes.save(out_path, texture="RGB")
        out = tubes

        dt = time.time() - t0
        eta = (len(indices) - n) * (time.time() - t_start) / n / 60
        size_mb = os.path.getsize(out_path) / 1e6
        print(f"[{n}/{len(indices)}] {idx:04d}: {lines.n_cells} lines, "
              f"{out.n_points} verts, {size_mb:.1f} MB, {dt:.1f}s | ETA {eta:.0f} min",
              flush=True)

    print(f"Done in {(time.time() - t_start)/60:.1f} min. Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
