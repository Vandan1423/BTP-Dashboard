# Pipeline commands

All paths are relative to `~/Documents/BTP/Vandan`. Every script derives its own
directories from its file location, so `cd` into `Vandan` first and the rest works.

```bash
cd ~/Documents/BTP/Vandan
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
```

## A. CME volume pipeline (`tr1`)

```bash
# 1. VTK -> VDB. Needs openvdb, which lives in the conda env, not .venv.
conda activate vdb-convert && python scripts/pipeline/VtkToVdbPipeline.py

# 2. Renumber into a contiguous 0000..0200 sequence Blender can read (hard links).
python3 scripts/pipeline/MakeVdbSequence.py

# 3. Real planet positions via Solar-MACH -> input/ephemeris/camera_positions.csv
../.venv/bin/python scripts/pipeline/GetPlanetsPositions.py

# 4. Build the science scene -> output/scenes/SolarWindCME_generated.blend
$BLENDER --background --python scripts/scene/BuildScene.py

# 5. Add space environment + switch volume to tr1 -> output/scenes/SolarWindCME_space.blend
$BLENDER --background output/scenes/SolarWindCME_generated.blend \
         --python scripts/scene/BuildSpaceScene.py

# 6. Keyframe the four planet cameras
$BLENDER --background output/scenes/SolarWindCME_space.blend \
         --python scripts/render/KeyframeCameras.py

# 7. Render 4096x2048 equirectangular frames -> output/renders/cme_360/<Camera>/
$BLENDER --background output/scenes/SolarWindCME_space.blend \
         --python scripts/render/RenderCameras.py

# 8. Encode -> output/renders/cme_360/<Camera>.mp4
python3 scripts/render/EncodeVideos.py
```

## B. Magnetic field line pipeline

Independent of the VDB path: traces streamlines to `.ply`, which Blender reads natively.

```bash
# 1. Trace streamlines -> input/ply/fieldlines.NNNN.ply
../.venv/bin/python scripts/fieldlines/TraceFieldLines.py

# 2. Build the field line scene -> output/scenes/SolarWindCME_fieldlines.blend
$BLENDER --background output/scenes/SolarWindCME_space.blend \
         --python scripts/fieldlines/BuildFieldLineScene.py

# 3. Render -> output/renders/fieldlines_360/<Camera>/
$BLENDER --background output/scenes/SolarWindCME_fieldlines.blend \
         --python scripts/fieldlines/RenderFieldLines.py

# 4. Encode -> output/renders/fieldlines_360/<Camera>.mp4
python3 scripts/fieldlines/EncodeFieldLineVideos.py
```

## Notes

- **Renders are equirectangular 360°, not flat.** A plain `<video>` tag shows a
  stretched rectangle. They must be mapped onto a sphere.
- `output/renders/cme_flat/` is the older flat 1920x1080 set, kept for reference.
- `output/experiments/` holds the lighting, density, exposure and resolution test
  renders. Nothing in the final pipeline reads from it.
- The GPU box (`10.206.2.253`) still uses the **old** `~/BTP_SolarWindCME/` layout.
  Usage examples inside a few scripts still quote box paths on purpose.
