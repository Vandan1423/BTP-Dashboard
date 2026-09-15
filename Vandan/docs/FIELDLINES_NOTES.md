# Magnetic field-line visualisation

Answers the professor's question: *can we visualise the magnetic field as
streamlines, as a video, and in VR?* — using the same `.vtk` dataset as the
existing `tr1` CME work.

**Nothing in `../Scripts/`, `../vdbOutput/`, `../vdbSequence/` or `../Renders360/`
is read-modify-written by anything in here.** This is a parallel branch of the
pipeline with its own scripts, its own intermediate files and its own render
tree, so the verified end-to-end `tr1` result stays intact.

---

## The one correctness claim that matters

The dataset is PLUTO output in `GEOMETRY SPHERICAL`, so

```
vx1, vx2, vx3 = (v_r, v_theta, v_phi)
Bx1, Bx2, Bx3 = (B_r, B_theta, B_phi)
```

These are components against the **local** spherical basis, which points in a
different direction at every grid point. There is no single global rotation
matrix; the rotation has to be rebuilt per point from that point's own
(theta, phi). `TraceFieldLines.to_cartesian()` does this.

This was **confirmed from the data**, not assumed from PLUTO convention. The
solar wind blows radially outward, so `cos(v, r_hat)` has a known right answer:

| reading the components as | mean `cos(v, r_hat)` |
| --- | --- |
| Cartesian | **+0.005** (noise) |
| spherical | **+1.000** (correct) |

Skipping the rotation still produces plausible-looking curved lines. They are
simply wrong — which is the dangerous failure mode here.

### Independent physics checks on the rotated field

| check | result | meaning |
| --- | --- | --- |
| `\|B\|·r²` at r = 0.2 / 0.4 / 0.8 AU | 0.052 / 0.050 / 0.050 | clean Parker 1/r² falloff |
| `atan(B_phi/B_r)` at r = 0.3 / 1.0 / 2.0 AU | 1.3° / 10.3° / 37.6° | spiral winds up with radius |
| sign of `B_r` vs longitude at 1 AU | flips (+0.056 → −0.058) | heliospheric current sheet |

---

## Pipeline

```
data.NNNN.vtk
  → cell_data_to_point_data()        tracer needs interpolable point data
  → rotate (Bx1,Bx2,Bx3) → Cartesian per-point basis
  → vtkStreamTracer, FIXED seed set  fixed seeds = no inter-frame flicker
  → .tube()                          real geometry, not volume
  → bake RGB into vertex colours
  → fieldlines.NNNN.ply
  → Blender (native .ply import, no SciBlend, no VDB)
  → overlay on the existing tr1 volume scene
  → frame_NNNN.png → .mp4
```

Streamlines are **geometry, not volume**, so this path never touches OpenVDB.
Tracing runs on the native 151×62×182 grid rather than the 256³ VDB resample —
no interpolation loss, and it sidesteps the known `rho`-max-81-vs-real-0.02
resampling artifact.

## Colour encoding

One RGB vertex attribute carries two things, because `.ply` reliably carries
exactly one colour attribute:

- **base colour** = `log|B|` through a cool ramp → **blue → cyan**
- **blended toward orange** where `tr1` (the CME tracer) is high

So: **blue/cyan = ordinary solar-wind field, orange = field threaded by the CME.**
The cool base is deliberate — the `tr1` volume underneath renders in `inferno`
(orange/white), so a blue field reads as a separate object instead of mush.

Colouring by `tr1` alone was tried and rejected: `tr1 ≈ 0` before onset, so every
pre-CME frame rendered solid black.

## Scripts

| script | where it runs | what it does |
| --- | --- | --- |
| `TraceFieldLines.py` | `.venv` (Mac) / `vdb-convert` (GPU box) | `.vtk` → `.ply`, one per timestep |
| `BuildFieldLineScene.py` | Blender | adds lines + emission material to the tr1 space scene |
| `RenderFieldLines.py` | Blender | renders 4 cameras × all frames, resumable |
| `EncodeFieldLineVideos.py` | plain `python3` | PNG sequences → one `.mp4` per planet |

`RenderFieldLines.py` reads overrides from the environment so a smoke test never
leaves a test value in the file:

```
FL_CAMERAS  FL_FRAME_START  FL_FRAME_END  FL_SAMPLES  FL_OUTPUT_DIR
```

## Tuning knobs

| what | where | note |
| --- | --- | --- |
| `SAMPLES` | `RenderFieldLines.py` | 1024 default. 512 = fast look, 4096 = final |
| `EMISSION_STRENGTH` | `BuildFieldLineScene.py` | 1.2. **No re-trace needed** — rerun that script only |
| `TUBE_RADIUS` | `TraceFieldLines.py` | 0.0035 AU. Changing this **does** require a re-trace |
| seed count | `TraceFieldLines.py` | `N_SEED_LON` × `N_SEED_LAT` = 234 seeds → 468 lines |

Seeds are confined to colatitude 38°–142°. The domain only spans 30°–150°; seeds
outside that band exit immediately and give a visibly lopsided picture.

## Two bugs already hit and fixed (do not reintroduce)

1. **`.tube()` emits triangle STRIPS, so `.faces` is empty.** Rebuilding via
   `pv.PolyData(tubes.points, faces=tubes.faces)` silently produces a face-less
   **point cloud** that still writes a valid `.ply` and still opens without
   error — it just renders as dots. Save the tube object directly instead.
2. **Removing a Blender object leaves its mesh datablock behind with 0 users.**
   Over 201 frames that is ~200 orphaned million-poly meshes held in RAM until
   save/reload, which is how a headless render quietly OOMs.
   `RenderFieldLines.swap_fieldlines()` explicitly removes the mesh too.

## Frame mapping

`BuildScene.py` sets the volume's `frame_offset = -1`, so **scene frame N shows
data index N−1**. The field lines use the same mapping. Getting this wrong would
put the field and the CME at different times — which looks plausible and is
wrong.

## Costs (measured)

| | |
| --- | --- |
| trace | ~3.7 s/timestep → ~12 min for 201 |
| `.ply` size | ~35 MB/frame → **~7 GB for 201** |
| render (M3, 4096×2048) | quiet frame ~12 s @32spp; CME-peak frame ~195 s @48spp |

The `.ply` files are intermediates — only the `.mp4`s need to come back from the
GPU box.

## VR

The 4 `.mp4`s drop into the existing Unity `ViewpointSwitcher` rig exactly like
the `tr1` videos, as a second switchable set.

Longer term: unlike the volume, these field lines are **real mesh geometry**, so
the `.ply` files can be imported into Unity directly and viewed with true
head-tracked parallax instead of a projected 360 sphere. That path is open but
not built.
