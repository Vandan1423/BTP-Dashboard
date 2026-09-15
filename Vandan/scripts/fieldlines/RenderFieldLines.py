"""
Renders the field-lines-over-CME 360 sequence for all 4 planet cameras.

    blender --background output/scenes/SolarWindCME_fieldlines.blend \
            --python FieldLines/scripts/fieldlines/RenderFieldLines.py

Writes to output/renders/fieldlines_360/<Camera>/frame_NNNN.png -- a SEPARATE tree from
the existing ../../output/renders/cme_360/, so the verified tr1-only frames cannot be mixed
into or overwritten by this run.

Resumable: rerunning skips frames whose .png already exists.

Loop order is FRAME-MAJOR (frame outer, camera inner), unlike the tr1
RenderCameras.py which is camera-major. Reason: the field-line mesh has to be
swapped from disk every frame, and frame-major imports each .ply once for all 4
cameras instead of four times. Per-camera resume still works because the
skip-check is per (camera, frame).
"""

import os
import re
import glob
import sys
import time
import bpy

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
PLY_DIR = os.path.join(BASE_DIR, "input", "ply")
OUTPUT_DIR = os.path.join(BASE_DIR, "output", "renders", "fieldlines_360")

FIELDLINE_OBJ_NAME = "FieldLines"
MATERIAL_NAME = "FieldLineMat"

# Every knob below can be overridden from the shell without editing this file,
# so a smoke test never risks leaving a test value committed in the real run:
#   FL_CAMERAS=Earth FL_FRAME_START=181 FL_FRAME_END=181 FL_SAMPLES=128 \
#     blender --background ... --python RenderFieldLines.py
CAMERA_NAMES = os.environ.get("FL_CAMERAS", "Mercury,Venus,Earth,Mars").split(",")
FRAME_START = int(os.environ.get("FL_FRAME_START", 1))
FRAME_END = os.environ.get("FL_FRAME_END")   # None -> take the range from the .blend
FRAME_END = int(FRAME_END) if FRAME_END else None

# ---- quality -------------------------------------------------------------
# Carried over from the measured tr1 benchmark (see ../../scripts/fieldlines/RenderCameras.py):
# on the A30 at frame 170, 256 spp vs 512 spp came out at PSNR 52 dB - i.e.
# visually identical, samples were never the limiting factor once denoising was
# on. The previous run used 4096 by explicit choice and took a full night for 804
# frames. 1024 is the middle ground here; raise to 4096 for a final deliverable,
# drop to 512 for a fast look.
SAMPLES = int(os.environ.get("FL_SAMPLES", 4096))
VOLUME_BOUNCES = 1
VOLUME_STEP_RATE = 3.0
ADAPTIVE_THRESHOLD = 0.02
DEVICE = 'GPU'
OUTPUT_DIR = os.environ.get("FL_OUTPUT_DIR", OUTPUT_DIR)

scene = bpy.context.scene
if FRAME_END is None:
    FRAME_END = scene.frame_end

# ---- map scene frame -> .ply on disk -------------------------------------
# BuildScene.py sets frame_offset = -1, so scene frame N shows data index N-1.
# The field lines must use the SAME mapping or the field and the CME will be
# offset from each other in time - which would look plausible and be wrong.
ply_by_index = {}
for f in glob.glob(os.path.join(PLY_DIR, "fieldlines.*.ply")):
    ply_by_index[int(re.search(r"fieldlines\.(\d+)\.ply$", f).group(1))] = f
if not ply_by_index:
    raise SystemExit(f"No fieldlines.*.ply in {PLY_DIR}. Run TraceFieldLines.py first.")
available = sorted(ply_by_index)
print(f"Field-line frames available: {len(available)} ({available[0]}..{available[-1]})")


def ply_for_frame(frame):
    """Exact match when the full sequence exists; nearest lower index otherwise.

    On the GPU box all 201 indices exist and this is always an exact hit. On the
    Mac only 21 (step-10) inputs are present, and the fallback lets a local smoke
    test render any frame instead of crashing on a missing file.
    """
    idx = frame - 1
    if idx in ply_by_index:
        return ply_by_index[idx], idx
    lower = [i for i in available if i <= idx]
    pick = lower[-1] if lower else available[0]
    return ply_by_index[pick], pick


def swap_fieldlines(path):
    """Replace the field-line object with this frame's mesh."""
    old = bpy.data.objects.get(FIELDLINE_OBJ_NAME)
    if old is not None:
        mesh = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        # Removing the object alone leaves the mesh datablock behind with 0 users.
        # Over 201 frames that is ~200 orphaned million-poly meshes held in RAM
        # until save/reload - which is how a headless render quietly OOMs.
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)

    bpy.ops.wm.ply_import(filepath=path)
    obj = bpy.context.selected_objects[0]
    obj.name = FIELDLINE_OBJ_NAME
    obj.data.materials.clear()
    obj.data.materials.append(bpy.data.materials[MATERIAL_NAME])
    obj.visible_shadow = False
    obj.visible_diffuse = False
    obj.visible_glossy = False
    return obj


# ---- render settings (same as the verified tr1 run) ----------------------
COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)
print('DEVICES ENABLED ->', [(d.name, d.type) for d in prefs.devices if d.use])

scene.render.engine = 'CYCLES'
scene.cycles.device = DEVICE
scene.cycles.samples = SAMPLES
scene.cycles.volume_bounces = VOLUME_BOUNCES
scene.cycles.volume_step_rate = VOLUME_STEP_RATE
scene.cycles.adaptive_threshold = ADAPTIVE_THRESHOLD
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0.0
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
try:
    scene.cycles.denoising_use_gpu = True
except Exception as _e:
    print("  NOTE: denoising_use_gpu unavailable:", _e)
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = 100
print(f"CONFIRMED -> engine={scene.render.engine}, device={scene.cycles.device}, "
      f"samples={scene.cycles.samples}, "
      f"res={scene.render.resolution_x}x{scene.render.resolution_y}")

os.makedirs(OUTPUT_DIR, exist_ok=True)
for cam_name in CAMERA_NAMES:
    os.makedirs(os.path.join(OUTPUT_DIR, cam_name), exist_ok=True)

total = len(CAMERA_NAMES) * (FRAME_END - FRAME_START + 1)
done = 0
batch_start = time.time()

for frame in range(FRAME_START, FRAME_END + 1):
    targets = []
    for cam_name in CAMERA_NAMES:
        out_path = os.path.join(OUTPUT_DIR, cam_name, f"frame_{frame:04d}.png")
        if os.path.exists(out_path):
            done += 1
            print(f"[{done}/{total}] {cam_name} frame {frame}: exists, skipping", flush=True)
        else:
            targets.append((cam_name, out_path))
    if not targets:
        continue

    scene.frame_set(frame)
    path, used_idx = ply_for_frame(frame)
    swap_fieldlines(path)

    for cam_name, out_path in targets:
        cam_obj = bpy.data.objects.get(cam_name)
        if cam_obj is None or cam_obj.type != 'CAMERA':
            print(f"WARNING: camera '{cam_name}' not found - skipping")
            done += 1
            continue
        scene.camera = cam_obj

        # Each camera sits at its planet's exact position, so that planet's sphere
        # would enclose the camera and fill the frame with its own interior.
        for body in CAMERA_NAMES:
            planet = bpy.data.objects.get(f"Planet_{body}")
            if planet is not None:
                planet.hide_render = (body == cam_name)

        scene.render.filepath = out_path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        elapsed = time.time() - t0
        done += 1
        eta = (total - done) * (time.time() - batch_start) / max(done, 1) / 60
        print(f"[{done}/{total}] {cam_name} frame {frame} (ply {used_idx:04d}): "
              f"{elapsed:.1f}s | ETA {eta:.0f} min", flush=True)

print(f"Done. Total {(time.time() - batch_start)/60:.1f} min. Output: {OUTPUT_DIR}")
