# Solar Wind + CME Visualization — Task Guide

**Status:** Active. **Started:** 2026-08-18. **Scope:** the professor's current 3-4 week assignment (see `~/Downloads/CurrentTask.pdf`) — a scoped-down slice of the full plan in `PROJECT_GUIDE.md` (this project's "Pipeline B", field/volume data track).

This file is a **living document** for this specific task — update it as decisions get made and steps get done, so a new chat (or a new machine/account) can pick up exactly where things left off without re-explaining context. `PROJECT_GUIDE.md` stays as the big-picture 16-week reference; this file is the day-to-day one.

---

## 1. What we're building

Take the professor's solar wind + CME simulation data (`.vtk` files) and turn it into:
1. A Blender scene, built via the **SciBlend** add-on (plain Blender cannot open `.vtk` — SciBlend is what makes this possible).
2. **5 camera viewpoints**, placed at real planet positions using **Solar-MACH**, each tracking the CME as it passes.
3. A rendered video (PNG frames → `ffmpeg` → MP4).
4. Later: into Unity (pre-rendered video first — guaranteed; interactive volume as a stretch goal).

**Visual style decision (2026-08-20):** confirmed with the user — build the scientific colormap render (colored by density/tracer field + legend, full 3D not flat slices) as the guaranteed near-term deliverable, matching the professor's literal Week 2 ask and real professional space-weather visualizations (e.g. NOAA/NASA WSA-ENLIL style). Only attempt the more "glowing plasma particle" look (Unity VFX Graph, Option 1 from the brief — one glowing dot per cell, called "best look" but a stretch goal) later, if time remains after the guaranteed pipeline (pre-rendered video in Unity, the brief's Option 3) works end to end. Don't front-load effort into the particle/stretch look before the colormap pipeline is solid.

## 2. The data — verified facts, not the PDF's approximations

Location: `SolarWinds&CME/InputData/` — 21 files, `data.0000.vtk` … `data.0200.vtk` (step 10). **Note:** the original folder sketch said "20 files"; the professor's folder actually contains 21 — flagged, not silently resolved.

Everything below was checked directly with PyVista (`mesh.cell_data`, `mesh.points`), not taken on the PDF's word — the PDF's own numbers were sometimes off (e.g. it says "roughly 1–2.5 AU"; the real inner edge is 0.1):

| Property | Value |
|---|---|
| Format | Legacy binary VTK, `STRUCTURED_GRID` |
| Dimensions | 151 × 62 × 182 (r × θ × φ) → 1,656,150 cells |
| File size | ~106 MB each (~2.2 GB for all 21) |
| Coordinates | **Pre-baked to Cartesian** — the file stores explicit (x,y,z) per point. No manual spherical→Cartesian resampling needed (unlike the old torus data). |
| Radius (r) | **0.1 to 2.1** (code units — inner boundary of 0.1 AU is the textbook signature of **EUHFORIA**; unconfirmed, ask professor) |
| Colatitude (θ) | 30°–150°, i.e. **±60° latitude** around the ecliptic |
| Longitude (φ) | full 360° |
| Data location | **Cell data**, not point data (matches the PDF's warning) |
| Arrays (13) | `rho, vx1, vx2, vx3, Bx1, Bx2, Bx3, prs, tr1, tr2, tr3, tr4, tr5` |

**Vector-field basis caveat (added 2026-08-24 — see §6 for full writeup):** `vx1-3`/`Bx1-3` are almost certainly components in the local **spherical** basis `(v_r,v_θ,v_φ)`/`(B_r,B_θ,B_φ)`, not Cartesian — inferred from PLUTO's `x1,x2,x3` naming convention under `GEOMETRY SPHERICAL`. Doesn't affect the 7 scalar fields, and doesn't affect vector fields used as Magnitude. Would matter for per-axis (X/Y/Z) component modes or direction-dependent rendering (streamlines/arrows) — not yet built, deliberately deferred since nothing in current scope needs it.

**The CME is already inside our 21 samples** — confirmed by scanning all 21 timesteps for `rho`, `prs`, and tracer (`tr1`/`tr2`) evolution:

| idx range | What's happening |
|---|---|
| 0–160 | Quiet background wind. `rho` max ~90, `vx1` max ~3.05, all tracers zero, `vx2`/`vx3`/`Bx2` ≈ 0 (purely radial background flow). |
| 160→170 | CME onset — `tr1` switches on (595,938 cells become nonzero). |
| **180** | **CME peak** — `rho` max 98.6, `prs` max jumps to 109 (vs. ~9 background), `vx1` max jumps to 5.9. `vx2`, `vx3` (non-radial velocity), and `Bx2` (out-of-radial field) all activate, and a second tracer `tr2` switches on alongside `tr1` — consistent with a real 3D **flux-rope** structure, not just a density blob. |
| 190–200 | Fading. |

This matters directly for the pipeline: we don't need to guess where to point cameras or when to start the "interesting" part of the animation — **idx ~160–190 is the event**.

### Open questions for the professor (unconfirmed — don't build final claims on these)
- Exact radius units/scale (is 1.0 = 1 AU? what does 0.1 correspond to physically?)
- Which simulation code produced this (EUHFORIA is our working hypothesis from the 0.1 AU inner boundary, not confirmed)
- ~~What real date/time does idx 0 correspond to, and what's the cadence between indices~~ — **resolved 2026-08-24, provided directly by the professor (via chat, not embedded in the `.vtk` files — confirmed by direct byte-search that the files carry no time metadata at all).** Formula: `t(N) = start_time + (N/25) * 598400 sec`, where `N` is the same index number as the filename's `NNNN` (e.g. `data.0180.vtk` → `N=180`). Simplifies to `t(N) = start_time + N * 23936 sec`. `start_time = 2024-09-18 02:52:02.428` (timezone not stated by the professor — **assumed UTC**, since that's what SPICE/Solar-MACH expect; flag/confirm later if it matters). Given directly for VTK indices 0, 1, 10, 25, 50 — generalizes cleanly to any `N`, including our actual stride-10 files (`N = 0, 10, 20, ..., 200`).
- What do `tr1` vs `tr2` specifically represent (e.g. CME core vs. sheath)?
- **Is the simulation grid expressed in a Carrington (Sun-corotating) frame, an inertial frame, or something else?** Solar-MACH's positions come out in Carrington longitude/latitude by default — if the sim grid uses a different frame, planet positions and the CME won't line up correctly without an explicit conversion.

### Solar-MACH usage notes (verified 2026-08-18)

- `SolarMACH(date=..., body_list=...)` takes **one single date/time**, not a range — it's a snapshot ephemeris tool, not a trajectory tool. To animate cameras across our timesteps, **we loop over dates ourselves** and collect results (see snippet in chat log / next session).
- **Always pass `vsw_list` explicitly** (one solar-wind speed in km/s per body, e.g. `400`). If left as the default `[]`, Solar-MACH tries to auto-fetch live measurements from ACE over the network for the Parker-spiral calculation, which crashed with a library bug several layers deep (`speasy`/`pyistp`/`pycdfpp`) — not something we can fix, just avoid triggering it.
- `sm.coord_table` columns (confirmed by direct query, 3-body test): `Spacecraft/Body, Carrington longitude (°), Carrington latitude (°), Heliocentric distance (AU), Longitudinal separation to Earth's longitude, Latitudinal separation to Earth's latitude, Vsw, Magnetic footpoint longitude (Carrington)`. **This is spherical (lon/lat/r) in the Carrington frame, not Cartesian x/y/z** — we'll need to convert ourselves, and first confirm the sim grid's frame matches (see open question above).

## 3. Environment status (as of 2026-08-18)

| Tool | Status |
|---|---|
| Blender | **5.2.0 LTS installed**, not on `PATH` yet |
| `.venv` | Was broken (created under a folder later renamed `Internship`→`BTP`, silently broken `pip`). **Recreated fresh** at `BTP/.venv` using pyenv Python 3.13.12. |
| ffmpeg | ✅ **Installed** (Homebrew) |
| poppler (`pdftotext`) | ✅ **Installed** (Homebrew) |
| pyvista | ✅ **Installed**, 0.48.4 |
| spiceypy | ✅ **Installed**, 8.2.0 |
| solarmach | ✅ **Installed**, 0.5.4 |
| SciBlend add-on | ✅ **Installed**, v1.3.0, via extensions.blender.org (official Blender extensions platform, not a manual GitHub zip — bundles its own Python deps in a `wheels/` folder rather than using `BTP/.venv`). Source lives at `~/Library/Application Support/Blender/5.2/extensions/blender_org/sciblend/` — read directly on 2026-08-23 to diagnose issues, see §6. |
| `vdb-convert` conda env | ✅ **Installed** (2026-08-23) via Miniforge (`brew install miniforge` → `conda init zsh`) — `conda create -n vdb-convert -c conda-forge python=3.11 openvdb pyvista numpy`. Confirmed `import openvdb` works. Lives in conda's central env store, **not** inside `BTP/` (unlike `.venv` — activate with `conda activate vdb-convert` from anywhere). |

## 4. Folder layout (current)

```
BTP/
├── .venv/                      ← fixed, pyenv 3.13.12
├── PROJECT_GUIDE.md            ← the full 16-week plan (reference only)
├── SOLAR_WIND_CME_GUIDE.md     ← this file
└── SolarWinds&CME/
    ├── InputData/               ← 21 real .vtk files from the professor
    ├── Scripts/
    │   ├── VtkToVdbPipeline.py     ← VTK → OpenVDB conversion, run in the `vdb-convert` conda env (see §6)
    │   ├── GetPlanetsPositions.py  ← real-date + Solar-MACH + inertial Cartesian conversion (see §8) — renamed from SolarMach.py, moved here 2026-08-24
    │   ├── camera_positions.csv    ← output: 84 rows (4 bodies × 21 timesteps), columns vtk_index/date/body/x_au/y_au/z_au
    │   └── KeyframeCameras.py      ← Blender-internal script (run inside Blender's Scripting tab, not standalone): reads the CSV, creates/keyframes the 4 camera objects, adds Track To constraints (see §8)
    ├── vdbOutput/               ← 21 generated .vdb files, data.0000.vdb … data.0200.vdb (4.2 GB total)
    ├── vdbSequence/             ← 21 hard links, contiguous naming, for Blender's native Sequence import (see §6)
    ├── GeneratingColormapsUsingPython/  ← colormap generation scripts (DensityColormap.py, tr1ColormapForCME.py) — not yet documented in this guide
    └── BlenderOutputs/
        └── SolarWindCME.blend  ← the real, saved working file: volume sequence imported (21-frame Sequence), 4 cameras keyframed + Track To constrained (see §8)
```

**Decision (2026-08-18):** the old `TorusSimulation`/`PyPLUTO`/`Internship` legacy work (2D axisymmetric torus, single timestep) was removed from the project folder. It had a confirmed pre-existing data-reading bug (PyPLUTO hardcodes big-endian for `.vtk` files, but this file's own `vtk.out` sidecar declares little-endian; neither decoding cleanly reproduced known-good values) that wasn't worth chasing since it's not part of the current task. **Nothing is permanently lost** — a full backup of the pre-restructure `BTP` folder (old scripts, old data, the original broken `.venv`) lives at `~/Documents/BTP_backup_2026-08-18/`.

**Note (2026-08-24):** the folder layout above reflects a user-driven restructure partway through this session — `SolarMach/` folder was merged into `Scripts/`, and a real `BlenderOutputs/SolarWindCME.blend` now exists (earlier "verified working" Blender state from §6/§8 had only ever existed in an unsaved session and had to be rebuilt from scratch once this was discovered).

## 5. The plan (adapted from `CurrentTask.pdf`'s 4-week checklist)

- [x] Inspect the real data directly (not just trust the PDF) — done, see §2
- [x] Fix the broken `.venv`
- [x] Install `ffmpeg`, `poppler` (Homebrew)
- [x] Install `pyvista`, `solarmach`, `spiceypy` into `.venv`
- [x] Obtain and install the **SciBlend** add-on into Blender — done via extensions.blender.org
- [x] Read SciBlend's README (2026-08-19) — see notes below
- [x] Practice: load one `.vtk` timestep in Python with `pyvista`, inspect it (`print(mesh)`), import into Blender via SciBlend, color it — done 2026-08-23, went well beyond "practice": found a real limitation in SciBlend's mesh-based pipeline and pivoted the approach. See §6.
- [x] Write a VTK → OpenVDB conversion script (`SolarWinds&CME/Scripts/VtkToVdbPipeline.py`, run inside the `vdb-convert` conda env) — done 2026-08-23, built step-by-step by the user (not handed a finished script — see `feedback_collaboration_style` memory on why this matters). Reads `data.0180.vtk` with pyvista, converts cell data to point data, resamples onto a 256³ cubic-voxel grid via `pv.ImageData.sample()` (trilinear interpolation, chosen over nearest-neighbor for visual smoothness — see rationale below), reshapes with `order="F"` to match VTK's point ordering, writes a named `rho` grid to `SolarWinds&CME/vdbOutput/data.0180.vdb` with a matching linear transform (voxel size + translation) so it lines up spatially. Currently only the `rho` field — `tr1` etc. still to be added as additional named grids in the same file.
- [x] Get one real timestep (idx 180, the CME peak) looking right in Blender as a true 3D volume, not just the outer/inner boundary shell — done 2026-08-23. Imported `vdbOutput/data.0180.vdb` (rho only) via SciBlend's **Filters Generator → Import VDB Sequence**; after fixing a SciBlend bug (see §6 "Bug #3"), the volume rendered in the Blender viewport showing real internal lobed structure (not a hollow shell) — **the core hypothesis behind the OpenVDB pivot is confirmed working.** Independently verified by comparing a matplotlib mid-Z-slice (`rho_3d[:, :, 128]`) of the resampled array against the original mesh — user confirmed the pattern looks consistent, not flipped/scrambled.
- [x] Generalize `VtkToVdbPipeline.py` from writing only `rho` to writing **all 13 real fields** as separate named `FloatGrid`s in the same `.vdb` file — done 2026-08-24. Kept all 13 as scalars rather than combining the vector fields into `Vec3SGrid`s (deferred — see §6 vector-basis note). Verified via `openvdb.readAllGridMetadata()`.
- [x] Loop the whole script over all 21 timesteps — done 2026-08-24. Restructured so geometry (bounds/voxel grid/transform) is computed **once** and shared across every file, guaranteeing identical voxel space by construction rather than by coincidence. All 21 `.vdb` files confirmed on disk (`data.0000.vdb` … `data.0200.vdb`, 4.2 GB total). See §6 for the full writeup, including a 4th SciBlend bug found and fixed along the way.
- [x] Import the full 21-timestep sequence into Blender via SciBlend, confirm it plays as a scrubbable animation — done 2026-08-24, after fixing three more SciBlend bugs and one sequence-naming mismatch. `rho` and `tr1` both confirmed rendering correctly across all 21 frames. See §6.
- [x] ~~Calibrate manual ranges for other fields~~ — **dropped 2026-08-24 by user decision.** Only affects Blender's manual display range for fields not currently in use; doesn't block or affect Solar-MACH/camera work at all. Revisit only if/when a specific field (`prs`, `vx*`, `Bx*`, `tr2-5`) actually gets used for rendering.
- [x] Pick the viewpoint bodies (2026-08-24) — **Mercury, Venus, Earth, Mars**, the only planets whose real orbital distance falls inside our simulation domain (0.1–2.1 AU); Jupiter+ would sit outside the simulated volume entirely. A 5th viewpoint (candidates discussed: STEREO-A, Parker Solar Probe, L1/DSCOVR) is **deliberately deferred** — proceeding with 4 for now, add the 5th later.
- [x] Open Solar-MACH (test date), read positions for the 4 bodies — done 2026-08-24, see §8
- [x] Pull positions across the sequence (Solar-MACH) — done 2026-08-24, see §8. `GetPlanetsPositions.py` computes real Cartesian (AU) positions for all 4 bodies × all 21 timesteps and saves `camera_positions.csv`.
- [x] Animate 4 cameras in Blender by reading `camera_positions.csv` and keyframing each camera's location per frame — done 2026-08-24, see §8. Also added Track To constraints so cameras aim at the volume. Caught and fixed a real physics bug along the way (raw Carrington longitude ≠ true position) — see §8 for the full writeup.
- [ ] **Next up:** render to PNG frames, encode to MP4 with `ffmpeg`
- [ ] (Later) Unity — pre-rendered video path first

### SciBlend README notes (checked 2026-08-19, from github.com/SciBlend/SciBlend)

- **Components:** Advanced Core (import: `.x3d .vtk .vtu .pvtu .vtp .pvtp .nc .nc4 .shp`, static + time-varying), Shader Generator (colormaps/shaders from data attributes), Legend Generator (compositor-based colorbars), Grid Generator, Shapes/Notes Generators, Compositor (camera/render helpers).
- **Confirms what we need:** `.vtk` import including animated/time-varying sequences, colormap-by-attribute, legend generation, and camera/compositor tooling — covers our whole pipeline end to end within one add-on.
- **Open question, verify hands-on rather than assume:** the README describes mesh/shader-based visualization (colormap applied to a mesh/point representation), not an explicit raymarched "3D volume" renderer. Our `rho`/`prs` fields fill the *whole* 3D grid, not just a surface — need to see in practice whether Advanced Core imports our structured grid as a point cloud / mesh with per-cell vertex colors (workable) or expects surface-like data. This is exactly what the next checklist step (practice import) will answer.
- No Solar-MACH or planet-camera-specific features — expected, that part is entirely our own scripting on top of SciBlend's plain camera/compositor tools.
- Workflow the README recommends: (optional) ParaView preprocessing → SciBlend import → Shader Generator → Grid/Shapes/Notes → Legend Generator → Compositor/render. We can likely skip the optional ParaView step since our data is already clean structured-grid Cartesian.

## 6. SciBlend deep-dive & the shift to volumetric (OpenVDB) rendering (2026-08-23)

This session did the "practice import" checklist step for real, hit a hard limitation, and made an intentional pivot. Read this section before touching SciBlend again.

**What we tried first:** imported `data.0180.vtk` via SciBlend's **Advanced Core → VTK import**, then tried to color it via **Shader Generator**.

**Bug #1 — only `rho` showed up in Attributes, not the other 12 arrays.** Root cause found by reading the add-on's own source (`SciBlend/operators/vtk/operators.py`, `_read_grid()`): it uses VTK's legacy `vtkDataSetReader` but never calls `reader.ReadAllScalarsOn()`. VTK's legacy readers have a decades-old default of loading only the *first* `SCALARS` array per data section unless told otherwise — so only `rho` (the first array PLUTO writes under `CELL_DATA`) ever made it into Blender. Fixed by the user directly (options given: patch `operators.py` to add `reader.ReadAllScalarsOn()` / `reader.ReadAllVectorsOn()` before `reader.Update()`, or convert `.vtk`→`.vtu` and use the XML reader path instead, which doesn't have this default). **Confirmed fixed** — Attributes panel now shows all 13: `cell_Bx1, cell_Bx2, cell_Bx3, cell_prs, cell_rho, cell_tr1..tr5, cell_vx1, cell_vx2, cell_vx3` (SciBlend prefixes cell-data arrays with `cell_`). Note: this is a patch to the *installed add-on copy* on this machine — if SciBlend is ever updated/reinstalled and arrays vanish from Attributes again, re-apply this fix (exact method used wasn't confirmed back — check `operators.py` for `ReadAllScalarsOn()` first before re-diagnosing from scratch).

**Bug #2 (structural, not fixable via settings) — the mesh only shows the boundary skin.** Also confirmed by reading the source: `_process_face`/`_create_mesh` in the same file explicitly cull any face shared between two neighboring cells, keeping only faces on the true boundary of the domain (`is_boundary()`). So Advanced Core turns our volumetric grid into a Blender mesh shaped like a hollow eggshell — colored data is only ever visible on the outer surface (r=2.1) and, through the missing-polar-cap holes (see colatitude discussion), the inner surface (r=0.1). **Any interior structure — including the flux-rope-like feature at idx 180 — is completely invisible**, no matter what Shader Generator/colormap settings are used, because there is no polygon there to color. This directly conflicts with the guide's "full 3D, not flat slices" visual-style decision (§1) for any CME state that doesn't happen to touch both radial boundaries.

**Plasma colormap:** SciBlend ships 16 built-in ParaView-style colormaps (`SciBlend/ShaderGenerator/colors.json`) — Viridis and Inferno are there, Plasma is not. Generated the real matplotlib "plasma" colormap (64 stops, via the `.venv`'s matplotlib) and saved it in the same ParaView JSON format SciBlend expects, at `SolarWinds&CME/plasma_colormap.json`. Load it via Shader Generator's **Import Colormaps** button. **This import is session-only** (merged into an in-memory dict, not persisted) — must re-import every time Blender is reopened.

**Result with the shell-only approach:** colored `cell_rho` and `cell_tr1` on the outer/inner shell of `data.0180.vtk` (CME peak) — visually matched the earlier pyvista slice plot. Notably, the `tr1` tracer blob appeared on *both* the outer and inner visible shells at roughly the same angular position, telling us the CME plume spans the *entire* radial range of the domain at this timestep — a real finding, but still only tells us about the boundary, not the interior.

**Decision (2026-08-23):** pivot to true volumetric (OpenVDB) rendering rather than the lighter-weight alternative (a point cloud built from cell centers, which would also solve the "see inside" problem but as discrete dots rather than continuous fog). Rationale: matches real space-weather visualizations (NOAA/NASA WSA-ENLIL-style renders are volumetric for the same reason — a CME has no hard surface), and directly targets what the mesh-skin approach structurally cannot do.

**How volumetric rendering fits in SciBlend:** it has a separate, genuine volume-import path — `SciBlend/FiltersGenerator/operators/volume_import.py`, operator `FILTERS_OT_volume_import_vdb_sequence` — which calls Blender's native `bpy.ops.object.volume_import` to load `.vdb` (OpenVDB) file sequences as real Blender `VOLUME` objects (raymarched under EEVEE/Cycles, so light can pass through and reveal interior structure). **SciBlend does not include any VTK→VDB converter** — that conversion is on us.

**VDB environment setup (done 2026-08-23):** no pip wheel exists for `openvdb` or `pyopenvdb` (confirmed via `pip install --dry-run`, both fail). Homebrew's `openvdb` formula exists and is bottled, but its formula source has zero mentions of Python — it does **not** build Python bindings at all. conda-forge does. Installed via:
```
brew install miniforge
conda init zsh   # then restart terminal
conda create -n vdb-convert -c conda-forge python=3.11 openvdb pyvista numpy
conda activate vdb-convert
python -c "import openvdb; print('OpenVDB OK')"   # confirmed working
```
This env is separate from both `BTP/.venv` (pyenv) and system Python, and lives in conda's own central env store — not inside the project folder. Must `conda activate vdb-convert` fresh in any new terminal session before using it.

**Resolved (2026-08-23): resolution and resampling method.** Went with **256³ voxels**, sized from the largest bounding-box extent so voxels are cubic (equal size in x/y/z — per-axis extents would stretch the CME's shape). Resampling method: **trilinear interpolation** (cell data averaged onto points via `cell_data_to_point_data()`, then `pv.ImageData.sample()`), not nearest-neighbor — deliberately chosen over the "more honest" blocky option because this grid is spherical (cells near r=0.1 are physically tiny, near r=2.1 physically huge), so nearest-neighbor would show visible faceting; trilinear matches real WSA-ENLIL-style renders, appropriate since the deliverable is a visualization, not quantitative analysis. Confirmed side effect: this smooths the peak `rho` value down from the raw ~98.6 (idx 180) to ~81 after resampling — acceptable, since Blender's color/opacity mapping will be calibrated to the resampled data's own range, not the raw number.

**Gotchas hit while building the script (`Scripts/VtkToVdbPipeline.py`), for reference if redone:**
- The mesh's Z extent (±1.819, narrower — see colatitude 30 to 150 degree discussion in §2) is smaller than X/Y (±2.1), so one cubic voxel size for all axes makes the voxel grid overshoot the mesh's real Z bounds (ends up ±1.819 to +2.381) — harmless, those extra voxels just get zero/invalid data (`resampled.point_data['vtkValidPointMask']` flags exactly this).
- `sample()` adds two extra arrays beyond the original 13: `vtkValidPointMask` and `vtkGhostType` (housekeeping, ignorable).
- VTK's flat point-data arrays need `reshape((RES,RES,RES), order="F")` (x varies fastest) to fold back into 3D correctly, then `np.ascontiguousarray(..., dtype=np.float32)` before `openvdb`'s `copyFromArray()` (needs C-contiguous float32, not the Fortran-ordered result of the reshape).
- `openvdb.createLinearTransform()`'s parameter is `voxelSize` (camelCase) — a `voxel_size=` kwarg throws `TypeError`.
- `pv.ImageData`'s `origin=` is the grid box's corner, not the coordinate-system origin (the Sun sits at (0,0,0), which ends up mid-grid, not at the origin corner) — set `origin=(xmin, ymin, zmin)` to cover the mesh's actual bounding box.

**Confirmed working (2026-08-23): imported into Blender, interior structure visible.** Imported `vdbOutput/data.0180.vdb` (rho only) via Filters Generator → Import VDB Sequence. Hit one more SciBlend bug on the way (**Bug #3**, below); after patching it, the volume rendered as a soft fog with real internal lobed structure visible from outside the bounding box — a genuinely different result from the Bug #2 hollow-eggshell look, confirming interior CME structure is no longer hidden. Cross-checked with a matplotlib mid-Z-slice of the resampled `rho_3d` array compared against the original mesh — user confirmed the pattern looked consistent.

**Bug #3 — `_ensure_slice_cube_material()` crashes on import in Blender 5.2.** SciBlend's Filters Generator tries to build a helper "slice cube" gizmo object (meant for cutting cross-sections through the volume interactively) and assigns its material's Principled BSDF node inputs by hardcoded numeric index (`principled_bsdf.inputs[5].default_value = (0.0, 0.0, 0.0)`, etc.). Blender's Principled BSDF socket layout has changed across versions (sockets added/reordered), so in Blender 5.2, index 5 is now a **boolean** socket, not a color/vector — crashes with `TypeError: NodeSocketBool.default_value expected True/False or 0/1, not tuple`. File: `SciBlend/FiltersGenerator/operators/volume_update.py`. **Fixed** (Claude applied the patch directly, at the user's request, since this is a third-party add-on bug, not pipeline code the user is learning) by adding a `_safe_set(socket, value)` helper (try/except around the assignment, skips silently on type mismatch) and routing every `principled_bsdf.inputs[N]`/`material_output.inputs[N]` assignment in that function through it. This is, like Bug #1, a patch to the *installed add-on copy* on this machine — re-apply if SciBlend is ever updated/reinstalled and the same crash reappears. Note: the actual CME density/color shader logic (Map Range, density control node group, color ramp) mostly uses **named** socket lookups (e.g. `density_ctrl.inputs['Base Density']`), not raw indices, so it wasn't affected by this bug and wasn't touched.

**Bug #4 — Filters Generator's `Grid:` dropdown showed `(no grids)` (found 2026-08-23, root-caused and fixed 2026-08-24).** Re-surfaced once we generalized to all 13 fields and went back to verify in Blender. Root cause, found by reading `SciBlend/FiltersGenerator/operators/volume_import.py` and `properties/volume_item.py`: Blender lazily loads OpenVDB grid metadata — `obj.data.grids` only actually populates once something triggers evaluation/display (e.g. viewing Blender's own native Object Data properties tab, reachable via `Add > Volume > Import OpenVDB`, not `File > Import` — Blender has no volume entry there). SciBlend's import operator reads `obj.data.grids` synchronously right after `bpy.ops.object.volume_import(...)`, before that lazy load happens, silently swallows the resulting empty-list exception (`except Exception: pass`), and the dropdown never recovers on its own. Confirmed via a clean-restart test: fresh Blender + SciBlend-only import → reproducible `(no grids)`; visiting the native Object Data tab first (which forces the load) → SciBlend's own dropdown then also works. **Fixed** by adding `obj.data.grids.load()` right after the `bpy.ops.object.volume_import(...)` call in `volume_import.py` — same installed-add-on-copy caveat as Bugs #1 and #3 (re-apply if SciBlend is ever updated/reinstalled and grids stop showing again). Verified fixed on a fresh Blender restart with a direct SciBlend import of the new 13-grid `data.0180.vdb` — all 13 names showed immediately.

**Also noted, still unresolved/deprioritized:** the "slice cube" gizmo (`Slicer_5f9b9aac` object) turned out to be a custom shader-based cutaway system (boolean inside/outside test wired into the volume shader), not a literal cutting plane — abandoned as a verification method in favor of the matplotlib/pyvista comparison above; may be worth revisiting later once we actually want to use it for its intended purpose (an artistic cutaway shot) rather than for verification.

**Vector-field basis caveat (2026-08-24, deliberately deferred, not a bug):** `vx1,vx2,vx3` and `Bx1,Bx2,Bx3` are almost certainly components in the **local spherical basis** `(v_r,v_θ,v_φ)`/`(B_r,B_θ,B_φ)`, not Cartesian — inferred with high confidence from PLUTO's generic-coordinate-direction naming convention (`x1,x2,x3` = `r,θ,φ` under `GEOMETRY SPHERICAL`), not yet independently confirmed against a `definitions.h`/`pluto.ini` (professor hasn't provided one). Doesn't affect the 7 scalar fields at all, and doesn't affect vector fields used as Magnitude (basis-invariant — SciBlend's own "Vector Component" dropdown defaults to Magnitude, so current usage is fine as-is). Would matter for SciBlend's X/Y/Z per-component modes or any true directional visualization (streamlines/arrows) — those need a per-point spherical→Cartesian vector rotation (using each point's own θ,φ, derivable from its already-Cartesian coordinates) applied before resampling, which has not been built. Revisit before using per-axis component modes or direction-dependent rendering.

**Full 13-field, 21-timestep VDB sequence completed (2026-08-24).** `VtkToVdbPipeline.py` restructured: one-time setup (reference mesh read from `data.0180.vtk`, `field_names`, bounds, `voxel_grid`, `transform`) followed by a loop over `timesteps = [f"{i:04d}" for i in range(0, 201, 10)]` that re-reads each `.vtk`, resamples onto the shared `voxel_grid`, builds all 13 named `FloatGrid`s, and writes `data.{ts}.vdb`. Ran to completion, verified on disk: all 21 files present, 4.2 GB total.

**Sequence-naming mismatch (2026-08-24) — Blender's native volume "Sequence" mechanism only auto-increments the filename's digit run by 1 per frame; it has no concept of a stride.** Our real files are `data.0000.vdb ... data.0200.vdb` (step 10), incompatible with this. Fix: `SolarWinds&CME/vdbSequence/` contains 21 **hard links** (`data.0000.vdb ... data.0020.vdb`, contiguous) pointing at the real stride-10 files in `vdbOutput/`. Hard links, not symlinks — confirmed by testing that a symlinked sequence still looked for `data.0001.vdb` inside `vdbOutput/` (which doesn't exist there), because a symlink resolves to its target's real directory before Blender/OpenVDB compute sibling frame filenames, silently defeating the whole point. A hard link is a second real directory entry for the same file, no indirection, zero extra disk space. Real filenames in `vdbOutput/` (mapping to actual PLUTO timestep numbers) stay untouched; `vdbSequence/` is a disposable "view for Blender," regenerable any time:
```bash
cd ~/Documents/BTP/SolarWinds\&CME
mkdir -p vdbSequence
i=0
for f in $(ls vdbOutput/data.*.vdb | sort -V); do
  n=$(printf "%04d" $i)
  ln "$f" "vdbSequence/data.$n.vdb"
  i=$((i+1))
done
```
**Correct import workflow:** import **only** `vdbSequence/data.0000.vdb` (not all 21 — selecting all 21 in the file browser creates 21 separate full-resolution Volume objects instead of one lazy sequence, and crashed Blender with ~9GB RAM usage partway through). After import, manually check the `Sequence` box in the native Object Data Properties panel, then manually type `Frames: 21` — it does **not** auto-populate.

**Bug #5 — "Update Material" button did nothing, silently.** Console spammed `UILayout.operator(): unknown operator 'filters.volume_regenerate_material'` on every UI redraw. Root cause: the operator class `FILTERS_OT_volume_regenerate_material` (`SciBlend/FiltersGenerator/operators/volume_list_operators.py`) was fully implemented but never imported/registered in the add-on's top-level `SciBlend/__init__.py` — omitted from both the import statement and the `filters_classes` registration tuple, while its three sibling operators were included. **Fixed** by adding it to both lists.

**Bug #6 — Emission Color never wired to the value-driven Color Ramp, so the volume rendered flat white (or invisible), regardless of the actual field value.** Diagnosed by reading the generated shader node graph directly in Blender's Shading tab: Color Ramp's `Color` output only fed Principled Volume's `Color` input (scattering/absorption tint — needs external scene light to be visible), while `Emission Color` (the socket that makes a volume self-glow with no light needed) was left a static, disconnected white. Root cause in `ensure_volume_material_for_object()`, `SciBlend/FiltersGenerator/operators/volume_update.py` — only `nt.links.new(cr.outputs[0], pv.inputs[0])` existed. **Fixed** by adding `nt.links.new(cr.outputs[0], pv.inputs[7])` (Emission Color) right after.

**Bug #7 — Auto Range returned `inf`/`-inf` for any frame other than the one used at import.** `_resolve_vdb_filepath_for_frame()` in `volume_update.py` indexed into `item.last_import_files`, which only ever has **one entry** (the correct import workflow above selects a single file). For any frame past the first, the index clamped back to 0 — so range computation always re-read `data.0000.vdb` regardless of the actual current frame, and since that frame's `tr1` is fully quiescent, the scan found zero active values, returning `FLT_MAX`/`-FLT_MAX` (shown as `inf`/`-inf`). **Fixed** by rewriting the function to construct the target filename via digit-run substitution on the base filename (the same logic Blender's own native sequence mechanism uses internally), verifying the file exists before using it. Confirmed: `Compute Range` at frame 19 (→ `data.0018.vdb`) now correctly returns `tr1`'s real `[0,1]` range.

**Design note, not a bug: don't rely on Auto Range during animation playback.** Even with Bug #7 fixed, recomputing the range every frame during playback would re-normalize each frame against its own data — making quiet background frames look "fully lit" relative to themselves, defeating the point of watching intensity grow over time. **Correct workflow: Auto Range off, a fixed range set manually once, used for every frame.**

**Range-calibration finding — `rho`'s auto-computed max is a large, non-representative outlier.** `Compute Range` on `rho` returns `[0.0016, 81.08]`, but a **linear** map across that full span crushed all real structure down near zero — the CME blob (confirmed present and well-shaped via Blender's native Solid-mode grayscale preview, independent of SciBlend's shader entirely) was invisible in Rendered mode at this range, even after boosting `Alpha Multiplier` to 10x. Manually capping `From Max` down to **`0.02`** (Auto Range off) revealed a correctly-shaped, colored blob matching the Solid-mode preview exactly. The ~4000x gap between where real structure lives (`~0.02`) and the reported max (`81.08`) is suspicious enough to flag for later: likely a numerical resampling artifact (a spurious spike at one or a few voxels, plausibly from trilinear interpolation near the domain's inner boundary or poles in the original spherical grid) rather than real physics — worth checking against the raw `.vtk` data if it matters for a correctness claim later, but not blocking now. **Working manual ranges found so far:** `tr1`: `From Min 0.00 / From Max 1.00` (already well-behaved). `rho`: `From Min 0.0016 / From Max 0.02`. Other fields (`tr2-5`, `prs`, `vx*`, `Bx*`) haven't been calibrated — check each individually before use, the same outlier risk may apply.

**Confirmed working end-to-end (2026-08-24):** with all of the above applied — hard-linked contiguous sequence, `Frames: 21` set manually, `Sequence` checked, Auto Range off with the manual ranges above, `Emission: 1.0`, material Regenerated — both `rho` and `tr1` render correctly across the full 21-frame sequence in Rendered viewport shading, matching their Solid-mode shapes. **This is the verification goal from the top of this section, now complete.**

**Next concrete step (where to pick up):** range calibration for other fields dropped by user decision 2026-08-24 (not needed for current scope). Moving directly to Solar-MACH: query planet positions for a test date in Python, using `solarmach` (already installed in `BTP/.venv`) for Mercury, Venus, Earth, Mars (already picked, see §5).

## 8. Solar-MACH — real dates and camera positions (2026-08-24)

**Real timing metadata obtained directly from the professor (via chat, not the files — see §2, the `.vtk` files carry none):**
```
start_time = 2024-09-18 02:52:02.428   (assumed UTC — not stated, but needed by SPICE/Solar-MACH)
t(N) = start_time + (N / 25) * 598400 sec = start_time + N * 23936 sec
```
where `N` is the same index as the filename's `NNNN` (e.g. `data.0180.vtk` → `N=180`). Verified in Python (`t180 = start_time + timedelta(seconds=180 * 598400/25)` → `2024-11-06 23:40:02.428`, matching a hand calculation). This resolves the previously-open "no time metadata" question from §2.

**Frame-alignment assumption (flagged, not confirmed):** Solar-MACH returns positions in the **Carrington frame** (Sun-corotating). Whether the sim's own φ=0 longitude is aligned with Carrington's φ=0 is unconfirmed (same open question as §2's "which frame is the sim grid in?"). Working assumption: **treat them as aligned** — reasonable given the EUHFORIA hypothesis (that code typically drives its inner boundary from Carrington-frame solar wind maps). If wrong, the whole camera layout would need a single longitude-offset rotation to fix, not a rebuild. Revisit if the professor confirms otherwise.

**Pipeline built (`SolarWinds&CME/SolarMach/SolarMach.py`), step by step by the user:**
1. `start_time` + the time-formula above → real `datetime` per VTK index.
2. `to_cartesian(r, lat_deg, lon_deg)` — standard physics spherical→Cartesian (`θ = 90° - lat`, `φ = lon`), applied to Solar-MACH's `(Heliocentric distance (AU), Carrington latitude, Carrington longitude)` columns. Output is in **AU**, same units as the input distance — no unit conversion happens in this step.
3. `vsw_list` passed explicitly (`[400,400,400,400]` km/s placeholder) for all 4 bodies — required, see §2's Solar-MACH usage notes (empty list triggers a live-network crash).
4. Looped over all 21 timesteps (`indices = list(range(0, 201, 10))`) × 4 bodies (Mercury, Venus, Earth, Mars — picked in §5), producing 84 rows, saved to `camera_positions.csv` (columns: `vtk_index, date, body, x_au, y_au, z_au`).

**Coordinate-space compatibility check (2026-08-24):** confirmed the AU-based positions share the same raw-number convention as the volume's Blender coordinates — `VtkToVdbPipeline.py`'s OpenVDB transform was built directly from the mesh's own code-unit bounds with no unit conversion, and Blender's Scene Unit Scale was confirmed still at the default `1.0` (checked directly in Scene Properties, not assumed) — so a bare AU number typed into an Object's Location field lands in the same space as the volume, regardless of Blender's cosmetic "m" unit label.

**Verified visually in Blender:** placed a test Empty at Earth's idx-180 (CME peak) position — `(0.145, 0.978, 0.064)` — via the N-panel Transform fields. Viewed against the `tr1` volume in **Solid** shading (Blender's native grayscale density preview, independent of SciBlend's shader — same technique used in §6 to verify the CME's shape without fighting material/emission tuning) at timeline frame 19 (→ `data.0180.vdb`, confirmed via the frame↔file mapping established in §6's Bug #7 fix). Result: the marker sits near the origin at a plausible order of magnitude (not past the domain boundary, not on top of the Sun), in the general vicinity of the visible `tr1` structure. **Caveat:** this confirms the pipeline isn't obviously broken (no sign flip / axis swap / unit mismatch) — it does *not* independently confirm the CME's real physical source location relative to Earth, since no such reference data exists yet to check against.

**This also gives circumstantial evidence for another open §2 question ("is 1.0 = 1 AU in the sim's code units?"):** Earth's real heliocentric distance came out to 0.991 AU, and the sim domain spans r ∈ [0.1, 2.1] — consistent with a domain running from just inside Mercury's orbit to just past Mars, which lines up with why exactly those 4 bodies were picked in §5. Not proof, but supports treating code units as AU.

**Camera keyframing in Blender, done 2026-08-24 (`KeyframeCameras.py`, run inside Blender's Scripting tab — `bpy` only exists inside Blender's own bundled Python, a separate interpreter from `.venv`/conda, so this can't run via plain `python3`).** Built step by step:
1. Read `camera_positions.csv` with the stdlib `csv` module (not pandas — unavailable in Blender's bundled interpreter).
2. Get-or-create 4 camera objects named Mercury/Venus/Earth/Mars via `bpy.data.cameras.new()` + `bpy.data.objects.new()` + `.objects.link()` (the `bpy.data` API, not `bpy.ops`, since it's context-free and deterministic — matters if this ever runs headless via `--background`). Checking `bpy.data.objects.get(body)` first makes rerunning the script safe (no duplicate `.001` objects).
3. Loop over all 84 CSV rows: `frame = vtk_index // 10 + 1` (matching `vdbSequence`'s numbering), set `obj.location`, then `obj.keyframe_insert(data_path="location", frame=frame)` — an exact keyframe at every one of the 21 frames, not sparse/interpolated.
4. Added a **Track To** constraint per camera (target = the volume object `data.0000`, `track_axis='TRACK_NEGATIVE_Z'`, `up_axis='UP_Y'`, Blender's own defaults for this exact camera-aiming use case) so cameras automatically aim at the volume every frame — procedural, no rotation keyframes needed. Caveat: the volume object itself doesn't move (only its internal data evolves per frame), so this aims at the domain's center, not literally the CME's moving substructure — a reasonable approximation since the event stays roughly domain-centered, not a claim of pixel-perfect tracking.

Gotcha hit along the way: `bpy.ops.text.run_script()` (Run Script) and Blender's interactive Python Console panel execute in **separate, unconnected namespaces** — a variable set by running the script text-block is invisible from the console (`NameError`), even though both look like the same session. Fix used: launch Blender from Terminal (`/Applications/Blender.app/Contents/MacOS/Blender path/to/file.blend`) so `print()` output lands somewhere visible, instead of vanishing (no console window when launched normally from macOS Finder/Dock).

**Real bug caught and fixed: raw Carrington longitude ≠ real planetary position over time.** Feeding SolarMACH's `Carrington longitude (°)` straight into the spherical→Cartesian conversion made Earth's camera appear to complete ~2 full revolutions around the Sun in just 55.4 days — caught by eye, comparing Earth's camera position at frames 0/11/21 in Blender. Root cause: Carrington longitude is referenced to whatever currently faces Earth, so any body's value is dominated by Earth's own sub-solar point sweeping around the rotating Sun (~27.2753-day synodic rotation — 55.4/27.2753 ≈ 2.03, matching the observed pattern almost exactly), not the target body's real orbital motion.

**Professor explicitly denied a `spiceypy`/SPICE-kernel fix and requires camera positions to come specifically from SolarMACH** — a hard constraint, not a style preference. First fix attempt used SolarMACH's own `Longitudinal/Latitudinal separation to Earth's longitude/latitude` columns (isolates real relative motion since the fast Earth-common term cancels in the subtraction) — verified working (Mercury/Venus/Mars all showed physically plausible, consistent-direction motion matching predicted relative orbital rates), but pins Earth artificially fixed at reference longitude 0°, and only gives *relative* geometry among the 4 tracked bodies.

**Final fix — the "sidereal unwind":** each body's own raw Carrington longitude, plus a correction term for the Sun's known sidereal rotation rate, recovers a true independent inertial-frame position for every body (including Earth, which now moves realistically instead of being pinned) — entirely from SolarMACH's own `Carrington longitude/latitude` + `Heliocentric distance` columns, plus one fixed published astronomical constant (not live/external data, so still fully SolarMACH-compliant):
```
Ω_sidereal = 360° / 25.3783 days ≈ 14.1844°/day
inertial_longitude(t) = Carrington_longitude(t) + Ω_sidereal × elapsed_days
```
(Carrington latitude is used unchanged — the Sun's rotation is about its own axis, so latitude isn't affected.) Validated two ways: (1) applying the formula to Earth's own directly-measured Carrington rate (−13.20°/day between two adjacent dates) recovers +0.98°/day, matching Earth's known real orbital rate (0.9856°/day) almost exactly; (2) after regenerating the full 21-timestep CSV, Earth/Venus/Mars's observed angular rates over the full run matched their predicted real orbital rates to within ~1–2% (Earth 0.994 vs 0.986°/day, Venus 1.585 vs 1.602°/day, Mars 0.522 vs 0.524°/day), and all four bodies showed consistent same-direction (prograde) motion — Mercury's larger deviation from its *mean* rate (3.396 vs 4.093°/day) is expected given its high orbital eccentricity, not a red flag. **Confirmed working end-to-end in Blender** after rerunning `KeyframeCameras.py` against the corrected CSV — no more reversed/fast-cycling motion, cameras track correctly.

Along the way, also caught that `Scripts/KeyframeCameras.py` on disk had fallen out of sync with what was actually running in Blender's internal text-block (only the CSV-read portion had been saved externally) — re-synced so the full script (CSV read → camera creation → keyframing → Track To) exists as a real, complete, standalone file matching the rest of the project's pipeline scripts.

**Next up:** render to PNG frames, encode to MP4 with `ffmpeg` (see checklist above).

## 9. How we're working on this

Collaborative style for this task: **user drives, Claude guides** — concepts get explained, then the user runs the actual command themselves and sees the real output, rather than Claude running everything silently. Claude periodically stops to ask the user to explain a concept back, to rehearse defending the project to the professor. See Claude's memory (`feedback_collaboration_style` and `project_btp_solar_wind_cme`) for the persistent version of this context.

## 10. Mid-sem deliverable: the web dashboard (scoped 2026-09-02, professor meeting)

**Meeting outcome.** Professor approved the existing work (the `tr1` CME videos, the B-field streamline videos, and the Unity XR simulation on the Mac). New assignment, and **this is what the mid-sem evaluation is on**: a web dashboard with two features.

**What was explicitly discussed and ruled OUT:** a "upload a full `.vtk` sequence → get a video back" service. Reason given to the professor and accepted by him: (a) the pipeline's field names, domain bounds, colormap ranges, camera set and scene composition are all tuned to *this* dataset — a different simulation means re-tuning, not a re-run; (b) a full 4-viewpoint sequence render is 13–14 hours, which no web request can wait on. **Scoped down instead to single-frame, on-demand rendering** (Feature 2 below) — the professor accepted a multi-minute wait per frame after being told the worst measured single-viewpoint frame cost ~500 s.

### Feature 1 — explore the ALREADY-rendered videos (no rendering at request time)

Assets that already exist and just need serving:

| Asset | Path | Size |
|---|---|---|
| CME (`tr1`) frames | `Renders360/{Mercury,Venus,Earth,Mars}/frame_NNNN.png` | 201 × 4, ~3.2 MB each, **4.9 GB** |
| CME videos | `Renders360/{body}.mp4` | 6.7–12 MB each |
| Field-line frames | `FieldLines/Renders360/{body}/frame_NNNN.png` | 201 × 4, ~4.8 MB each, **4.9 GB** |
| Field-line videos | `FieldLines/Renders360/{body}_fieldlines.mp4` | 43–71 MB each |
| Camera geometry | `Scripts/camera_positions.csv` | 84 rows (regenerate at 201 for full cadence) |

**CRITICAL, easy to get wrong: every render is 4096×2048 EQUIRECTANGULAR 360°, not a flat frame.** `BuildSpaceScene.py` sets every camera to `PANO`/`EQUIRECTANGULAR`. A plain HTML5 `<video>` tag will show a stretched, distorted rectangle and look broken. The player MUST be a 360 viewer (three.js sphere with the video/PNG as texture, exactly like the Unity `CMESphere`). Turn this into a selling point: drag-to-look is a real feature and it is the *same asset* the VR build uses.

Professor-named requirements: switch viewpoint, slow/fast playback, jump to a frame, view the same exact frame at different viewpoints side by side. He also asked what else could be added — ranked list:

*Must-have (he asked for these):* 360 drag-to-look + optional flatten-to-rectangle toggle; viewpoint switcher (Mercury/Venus/Earth/Mars); speed control; frame scrubber with exact-frame jump; synced side-by-side compare of two viewpoints at one frame.

*High-value additions (cheap, uses assets we already have):*
- **Layer switch: CME volume (`tr1`) ↔ magnetic field lines** — two complete render sets already exist. Possibly a cross-fade slider between them.
- **Real UTC timestamp readout** — frame → real date via the professor's formula (`2024-09-18 02:52:02.428 + N × 23936 s`, §8). Shows "2024-11-06 23:40 UTC", not "frame 19". Scientifically defensible, nearly free.
- **Synced 2×2 grid** — all four planets, same frame, locked playback. This is the strongest visual answer to "compare side by side".
- **CME phase markers on the scrubber** — annotate onset (idx 160), peak (180), fade (190–200) from §2's verified findings. Shows the physics is understood, not just rendered.
- **Solar-MACH orbital mini-map** — small top-down plot of the 4 real planet positions at the current frame, straight out of `camera_positions.csv`, with the active viewpoint highlighted. Ties the video back to real heliospheric geometry; likely the single most impressive addition.
- **Per-frame metadata panel** — samples, resolution, grid, density/emission, camera XYZ in AU, render time. A reproducibility receipt.
- Full-res PNG download of the current frame; keyboard shortcuts (←/→ step, space, 1–4 viewpoints).

*Stretch:* A/B frame pin + difference view; "open this frame/viewpoint in the VR build" hand-off.

**Real engineering constraint for Feature 1:** do NOT serve the 3.2 MB originals to the scrubber — scrubbing 201 frames would be unusable. Pre-generate downscaled proxies (~1024×512 WebP/JPEG) for scrubbing and compare, and fetch the full 4096×2048 PNG only on demand (zoom / download). One-off ffmpeg batch, cheap.

### Feature 2 — upload ONE `.vtk` → render that single frame at selected viewpoints

Flow: upload one `.vtk` → pick viewpoints (any subset of Mercury/Venus/Earth/Mars) → pick quality → job queued → returns a stack of PNGs → explore them in the same 360 viewer.

Pipeline per job (all pieces already exist, they need wiring, not inventing):
1. `VtkToVdbPipeline.py` logic → one `.vdb` with `rho` + `tr1` (256³ resample).
2. `GetPlanetsPositions.py` logic → camera XYZ for that timestamp via Solar-MACH.
3. Open the existing `BlenderOutputs/SolarWindCME_space.blend` as a **template**, point the volume at the new `.vdb`, set camera + planet positions for the single frame — do NOT rebuild the scene from scratch per job.
4. `RenderCameras.py` logic → one PNG per selected viewpoint.

**Three known traps, all silent-failure class — write these into the implementation:**
- **Pin the voxel-grid geometry as constants.** `VtkToVdbPipeline.py` computes bounds/voxel size/transform ONCE from `data.0000.vtk` and shares them across every file *by construction*. A per-upload job must reuse those same pinned numbers, NOT recompute from the uploaded file's own bounds — otherwise the volume silently lands in a different space from the Sun, planets and cameras.
- **`frame_offset = -1`.** The sequence off-by-one fix from §6/§8 exists because Blender numbers sequences from 1. A single-frame job has no sequence — load the VDB as a static volume and verify the correct data is showing, rather than inheriting the offset blindly.
- **Timestamp is not in the file.** The `.vtk` files carry no time metadata (§2), but Solar-MACH needs a real datetime to place cameras. Plan: parse `NNNN` from the `data.NNNN.vtk` filename → apply the §8 time formula → pre-fill an **editable** date field in the upload form so arbitrary files still work. This is a design decision the professor should be told about explicitly.

**Quality preset is the difference between a usable dashboard and an unusable one.** Measured in §, not guessed: 256 spp vs 512 spp came out at **PSNR 52 dB — visually identical** with OpenImageDenoise on; 4096 spp → 256 spp was a measured **15.9×** speedup. Worst observed CME-peak frame: 636 s (10.6 min) at 4096 spp on the A30. So offer:
- **Preview (256 spp)** — default. ~30 s quiet frame, ~4–5 min worst-case CME frame, per viewpoint.
- **Publication (4096 spp)** — opt-in, up to ~10 min per viewpoint, ~40 min for all four.
Both numbers are defensible because they were measured on this exact scene. Re-measure the VTK→VDB conversion step per single file — that cost was never isolated and it sits in front of every job.

*Output-exploration features:* grid of returned viewpoints → click into the 360 viewer; any-two compare; ZIP / per-image download; the parameter receipt (samples, resolution, grid, date, camera XYZ); the orbital mini-map for that timestamp; live job log (the render scripts already print per-frame timings); queue position + ETA from measured times; "re-render at publication quality" button.

### Where it runs — decide before building

> **⚠️ SUPERSEDED same day — see "Hosting decision SETTLED" below.** Kept for the reasoning only; the conclusion here (Mac-hosted, SSH tunnel) was overturned once the campus-network port test passed. Do not build from this section.


- The full 201-file `.vtk` set, Blender+CUDA and the A30 live **only on the GPU box** `10.206.2.253` (Ubuntu, **no sudo**, **shared GPU that has already OOM'd once**). The Mac has only the 21 step-10 files.
- No sudo ⇒ no Docker, no systemd, no Redis service. Use **FastAPI + a SQLite job table + one serialized worker process** under `tmux`/`nohup`. Serializing renders is not laziness, it is the mitigation for the shared-GPU OOM.
- `10.206.2.253` is a private LAN IP. Demo path: `ssh -L 8000:localhost:8000 <user>@10.206.2.253`, then open `http://localhost:8000` on the Mac. No firewall changes, no sudo.
- **Build it host-agnostic and have a full local-Mac fallback ready for the evaluation.** A live demo that depends on campus wifi + a GPU another student can fill up is a demo that can fail in front of the examiner. Feature 1 is 100% static assets and can run entirely offline on the Mac; Feature 2 can fall back to Metal at Preview quality on the 21-file subset.
- Solar-MACH does a network query. Confirm outbound internet works from the GPU box, or ship a precomputed position cache.

### Other open items
- 102 MB per `.vtk` upload — needs a chunked/resumable upload, a size cap and a clear progress bar; expect 1–3 min on campus wifi.
- Storage: ~9.8 GB of PNGs already on disk; proxies add a little more. Check free space on whichever host serves them.
- Suggested stack: **FastAPI + SQLite + a static frontend using three.js** for the 360 viewer (same technique as the Unity `CMESphere`, so the knowledge transfers both ways).

**Status: scoped only. Nothing built yet — deliberate, this session was discussion + documentation by user request.**

### Architecture decision (2026-09-02, user's call — endorsed)

> **⚠️ SUPERSEDED same day — see "Hosting decision SETTLED" below.** The two-service Mac-backend/box-render split was replaced by a single box-hosted stack. **One idea survives and still applies:** keep the render worker behind a narrow interface (bytes + params in, PNGs out) so the Mac parachute is a config swap, not a rewrite. The six numbered design points below (async job API, own job state, `/health`, streaming upload, single process on demo day, bearer token) also all still apply.


**Two independent services, split by what each machine uniquely has:**

```
Browser  ──►  Mac: FastAPI backend + frontend  ──►  GPU box: render service (FastAPI)
              - serves Feature 1 static assets      - ONLY runs the pipeline
                (4.9 GB PNGs + mp4s already here)   - vtk bytes + params in, PNGs out
              - job DB, request/response, UI        - knows nothing about users,
              - proxies Feature 2 to the box          sessions, videos, or Feature 1
```

**Why this split is correct:** the Mac already holds every rendered asset, so **Feature 1 has zero dependency on the GPU box** — if the box is down or the campus network dies mid-evaluation, the pre-rendered half of the demo still works completely. The GPU box holds the only copy of the 201 `.vtk` files plus Blender/CUDA, so Feature 2 must run there. Nothing is on the wrong machine.

**The biggest payoff, and the reason to keep the render service strictly pure:** if its interface is genuinely narrow (bytes + params in, PNGs out), the local-Mac fallback becomes a **one-line config change** — run the same service on the Mac against Metal at Preview quality and point the backend at `localhost` instead of the tunnel. Any leakage of session/user/video concerns into the render service destroys that property.

**Six decisions to lock in before writing code:**

1. **Never a blocking POST.** A render is 30 s–10 min; the SSH link to this box has dropped repeatedly across sessions. Job submission must return immediately and be polled:
   ```
   POST   /jobs            (multipart: .vtk + viewpoints + quality + datetime) -> {job_id}
   GET    /jobs/{id}       -> {status, stage, progress, log_tail, eta_s}
   GET    /jobs/{id}/artifacts            -> [viewpoint names]
   GET    /jobs/{id}/artifacts/{name}.png -> the PNG
   DELETE /jobs/{id}       -> cleanup scratch files
   GET    /health          -> {gpu_free_vram, queue_depth, blender_ok}
   ```
   A dropped tunnel then costs a reconnect, not a lost render.
2. **The GPU box owns its own job state** (its own SQLite), and the Mac DB *mirrors* it for the UI. Otherwise closing the laptop lid kills an in-flight render. The box's worker must run under `tmux`/`nohup`, not in the foreground of an SSH session.
3. **`/health` is not optional here.** The A30 is shared and has already OOM'd from another user holding 22.6 GB. Reporting free VRAM and queue depth lets the UI say "GPU busy, queued behind another user" instead of surfacing a mystery failure at the evaluation.
4. **Stream the 102 MB upload, don't buffer it.** It is a double hop (browser → Mac → box), so the user waits for two transfers; stream through rather than reading it into memory on the Mac. If the tunnel proves slow, fall back to `rsync` over the existing SSH (resumable — the reason it was chosen over `scp` before).
5. **Serve the built frontend from the Mac's FastAPI for the demo.** Two dev servers is fine while building; on evaluation day one process to start is one thing to go wrong.
6. **A shared bearer token on the render service.** It sits on a campus LAN with other users. Five minutes of work.

*Time-pressure simplification, if the second service becomes a schedule risk:* drop the HTTP service and have the Mac backend `ssh` in to run a job script per request, with `rsync` for files. Loses progress polling and the clean fallback swap — take it only if the deadline demands it.

### Hosting decision SETTLED (2026-09-02): everything runs on the GPU box

**Decisive test passed.** `python3 -m http.server 8000 --bind 0.0.0.0` on `10.206.2.253` was reachable from the Mac (`HTTP/1.0 200 OK`) **and from an iPhone on campus wifi**. No host firewall blocks non-SSH ports, and no sudo was needed to bind 8000. **The whole dashboard — FastAPI backend, frontend, static asset serving, SQLite, and the render pipeline — runs on the box.** Campus-network-only access is a requirement, not a limitation, so no TLS/public-exposure story is needed.

**⚠️ SECURITY LESSON FROM THAT TEST — never repeat it.** The test server was started from `~`, which published the entire home directory to the campus network, including `.ssh/`, `.bash_history`, `.claude.json` and `.config/`. Anyone on campus could have fetched a private key over plain HTTP. **Rule for this project: every static server binds to a dedicated, purpose-built directory (e.g. `~/BTP_SolarWindCME/dashboard/public/`), never `~`, and never a parent of anything secret.** FastAPI's `StaticFiles(directory=...)` must be pointed at that folder explicitly.

**Box environment confirmed (2026-09-02):**

| Check | Result |
|---|---|
| Port 8000 from campus LAN | ✅ reachable, Mac + phone |
| Disk on `/home` | **15 TB, 12 TB free** — storage is a non-issue |
| `Renders360/{Mercury,Venus,Earth,Mars}/` | ✅ present on box |
| `FieldLines/Renders360/{4 cameras}/` | ✅ present on box — the field-line GPU run *did* happen (previously recorded as "not started") |
| `BlenderOutputs/SolarWindCME_space.blend` | ✅ present — resolves the §10 open item |
| Python on box | 3.10.12 |
| `curl` | **not installed**, no sudo to add it — use `wget` or `python3 -m urllib` for HTTP checks |
| Outbound internet (Solar-MACH) | ⚠️ still unverified — the curl test never ran |

**⚠️ `SolarWindCME_space.blend` differs between machines:** box copy is **257,533 bytes (Aug 29)**, Mac copy is **222 KB (Aug 26)**. The box's is newer. Feature 2 uses this file as its render template, so **establish which is authoritative before building** — a stale template silently produces subtly wrong renders.

**Bonus resource for the dashboard's ETA feature:** `~/render.log`, `render2.log`, `render3.log`, `render5.log` and `vdb_convert.log` on the box hold real per-frame A30 timings across the full 201-frame runs. Mine these for a measured per-frame cost model instead of guessing ETAs.

### Measured costs, final (2026-09-02)

**VTK→VDB for one 102 MB file (Mac M3): 11.2 s total** — read 2.5 s, `cell_data_to_point_data` 0.1 s, 256³ resample 8.5 s. This is ~1% of a job; the earlier worry that conversion might dominate is dead. It is a per-upload cost, not per-viewpoint.

**Mac vs A30, matched settings** (4096×2048, 256 spp, bounces 1, step 3.0, near-peak CME frame): Mac M3 Air **526.8 s**, A30 **264 s** → **the Mac is 2.0× slower**. Per 4-viewpoint job: Mac 35.1 min vs A30 17.6 min. Resolution scales near-linearly (measured 62.8 and 59.9 s/Mpx), so 2048×1024 costs ~1/4 of 4096×2048 — **the resolution lever is stronger than the machine lever**, worth remembering if the box is ever unavailable.

Running on the box at 4096×2048/256 spp, a worst-case 4-viewpoint job is **~18 min end to end**; at 2048×1024, **~4.5 min**.

**The Mac stays as the parachute.** It holds all 9.8 GB of rendered assets plus Blender, the scripts and the `.blend`, so it can run the identical stack if the box is down, the shared A30 is full, or campus wifi fails during the evaluation — all three of which have happened once already. Do not delete local assets.

### Blockers cleared (2026-09-02) — all three resolved

**1. Security exposure: no credentials leaked.** `~/.ssh/` on the box contains only `known_hosts` and `known_hosts.old` — **no private keys**. The accidental home-directory exposure leaked nothing authenticating. (The dedicated-public-directory rule above still stands permanently.)

**2. `SolarWindCME_space.blend` — the BOX copy is authoritative.** Determined from timestamps, not preference:
- Mac copy: **Aug 26 08:44**, but the Mac's own `BuildSpaceScene.py` was last edited **Aug 26 21:56** — the local `.blend` predates the script that generates it by ~13 h, so it was built *before* the final density=8.0 / emission=4.2 / Standard-transform tuning was written in. **Stale by construction.**
- Box copy: **Aug 29 14:40**, regenerated after that tuning, and it is the file that fed the `render5.log` run which produced the `.mp4`s the professor approved.

Action: treat the box copy as the single source of truth for the Feature 2 render template, and refresh the Mac's copy from it so the parachute doesn't fly a stale scene.

**3. Outbound internet on the box: OK** (`wget --spider https://pypi.org` succeeded). Solar-MACH can run live queries for camera placement — no precomputed position cache needed. Note `curl` is absent and there's no sudo; use `wget` or `python3 -m urllib`.

### Cost model for the Feature 2 ETA — use the real logs, not an average

`render5.log` records the full 804-frame run (4 cameras × 201 frames, **4096 spp**, bounces 1, step 3.0, 4096×2048): **total 405.2 min → 30.2 s/frame average.** But that average is dangerously misleading, because per-frame cost is dominated by *how much CME material is in shot*:

| Frame type (4096 spp, A30) | Cost |
|---|---|
| Quiet, pre-CME | ~12 s |
| CME peak (frame 169) | **636 s** |
| CME fading (Mars 184→201) | 63.9 s → 28.9 s |
| **Run average** | 30.2 s |

A 50× spread. A flat-average ETA would tell a user "30 seconds" and then take ten minutes.

**Proposed feature — content-aware ETA, and it is nearly free.** The VTK→VDB step already reads the whole file in 2.5 s and takes 11.2 s total. While it is in memory, compute a cheap CME-occupancy statistic (e.g. fraction of cells with `tr1 > 0.1`, and/or max `rho`), then map that to a predicted render cost using a curve fitted from the real logs. The user gets an ETA grounded in their *own* uploaded data instead of a guess, and the dashboard can honestly say "this is a dense frame, expect ~8 minutes."

Extract the training data for that curve with:
```bash
grep -hoE "\] [A-Za-z]+ frame [0-9]+: [0-9.]+s" ~/render*.log \
  | sed -E 's/\] ([A-Za-z]+) frame ([0-9]+): ([0-9.]+)s/\1,\2,\3/' \
  > ~/render_timings.csv && wc -l ~/render_timings.csv
```
Gives `camera,frame,seconds` across every logged run — pair each frame index with its `tr1` occupancy from the source `.vtk` and the curve fits itself.

### Render service BUILT (2026-09-15) — `Dashboard/backend`

Feature 2's backend exists and runs the real pipeline end to end on the Mac. `Dashboard/backend/README.md` is the source of truth for running it; this records the decisions.

**Standard library, not FastAPI — a deliberate deviation from the plan above.** FastAPI was installed in neither environment, and the box has no sudo and no curl. `http.server` + `sqlite3` + `subprocess` means `python3 serve.py` runs on the box's 3.10 with nothing installed. The API contract is unchanged, so moving to FastAPI later touches one file.

**Each stage runs in the interpreter that already has its dependencies:** conversion in the `vdb-convert` conda env (openvdb), Solar-MACH in `BTP/.venv`, rendering in Blender. The service only orchestrates.

**Verified on the Mac, not assumed:**

| Check | Result |
|---|---|
| Pinned grid (`grid.json`) vs archived `data.0000.vdb` transform | identical (voxel 0.016467539469401042 AU) |
| Service converts `data.0170.vtk` vs archived `data.0170.vdb` | max diff rho 3.7e-9, tr1 2.2e-16; 12.1 s |
| Live Solar-MACH for index 169's date vs CSV row 169 | identical to 3 d.p.; 9.8 s |
| Corrected Mac template render vs approved Earth frame 171 | visually matching |
| Upload of real 101.6 MB `data.0170.vtk`, Venus, 2048×1024 preview | done in 78.7 s, render 64.2 s |
| Service stopped mid-render, restarted | resumed: volume reused, finished viewpoint skipped |
| DELETE during render | Blender killed, files removed, 0.6 s |
| 16 API validation / path-traversal / Range checks | all pass |

**The three §10 traps, as implemented:** the grid is pinned from `grid.json` and never recomputed from an upload (a mismatched domain logs a warning); the volume is loaded static with `frame_offset = 0`; the date is read from the filename or form and a timestep date uses `camera_positions.csv`, any other date queries Solar-MACH live.

**The Mac's template is stale, and the service corrects it at render time** rather than trusting it: density 15.0 → 8.0, emission 4.0 → 4.2 (read from `BuildSpaceScene.py` by `ast`, not copied), AgX → Standard, sequence → static volume, keyframes cleared. The box copy should still be synced to the Mac per the blocker note above.

**Still open for the box:** paths in `config.example.json` are placeholders until `serve.py --check` passes there; `grid.json` must be re-pinned there; the 360 viewer needs the Mac's `output/renders` folder names (`cme_360/…`), which the box's `Renders360/` does not use.

**Mac measurement worth quoting:** Mercury at index 170, 2048×1024, 256 spp took 215.7 s — the engulfed-camera case is the expensive one, as the logs predicted.
