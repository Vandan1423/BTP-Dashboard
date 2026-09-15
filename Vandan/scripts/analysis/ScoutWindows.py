"""Find WHEN each planet actually sees the CME, before committing to a full render.

Measured on the completed Mercury sequence: only frames 166-178 show the CME
engulfing the camera, and frames 1-164 are empty black sky (median grey = 1).
That is 13 useful frames out of 201. Rendering all 201 for the remaining cameras
would spend most of the GPU budget on an empty starfield.

The window does NOT transfer between cameras. Mercury is at 0.39 AU, Venus 0.72,
Earth 1.00, Mars 1.52 - the CME front reaches each at a different time, so each
camera has its own arrival. Mars may not see it at all inside 201 frames.

So: render every 5th frame at 256x128 / 16 samples, which is only about
1/500th the work of a real frame, and read off where the volume actually appears.
Brightness does not depend on resolution or samples, so a thumbnail answers the
"is anything on screen" question exactly as well as a 4K frame.

    ~/blender-5.2.0-linux-x64/blender --background \
        ~/BTP_SolarWindCME/BlenderOutputs/SolarWindCME_space.blend \
        --python ~/BTP_SolarWindCME/scripts/analysis/ScoutWindows.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "experiments", "_scout")

CAMERAS = ["Venus", "Earth", "Mars"]
FRAMES = list(range(1, 202, 5))

SCOUT_RESOLUTION_PCT = 6      # 4096x2048 -> 245x122
SCOUT_SAMPLES = 16

# The shipped settings, restated explicitly. TestBrightness.py never saved the
# .blend so these are what is on disk anyway, but a scout that silently inherited
# some experimental value would produce a window map for settings nobody is going
# to render with.
GRID = "tr1"
FROM_MIN, FROM_MAX = 0.0, 1.0
DENSITY, EMISSION = 15.0, 4.2

scene = bpy.context.scene

COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = SCOUT_RESOLUTION_PCT
scene.cycles.samples = SCOUT_SAMPLES
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.cycles.use_denoising = False      # pointless at 16 samples, and it costs time

# ---- restore the shipped volume settings ------------------------------------
mat = vol = None
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in m.node_tree.nodes:
        if n.bl_idname == 'ShaderNodeVolumePrincipled':
            mat, vol = m, n
            break
    if mat:
        break
if mat is None:
    raise SystemExit("No Principled Volume material found")
nt = mat.node_tree


def node_feeding(target, socket_name):
    """Follow the link backwards. Names, not identity - bpy hands back a fresh
    wrapper on each access, so `is` comparison silently fails."""
    for l in nt.links:
        if l.to_node.name == target.name and l.to_socket.name == socket_name:
            return l.from_node
    raise RuntimeError(f"Nothing feeds {target.name}.{socket_name!r}")


dens_node = node_feeding(vol, 'Density')
emit_node = node_feeding(vol, 'Emission Strength')
map_node = node_feeding(dens_node, 'Value')
attr_node = node_feeding(map_node, 'Value')

attr_node.attribute_name = GRID
map_node.inputs['From Min'].default_value = FROM_MIN
map_node.inputs['From Max'].default_value = FROM_MAX
dens_node.inputs[1].default_value = DENSITY
emit_node.inputs[1].default_value = EMISSION
print(f"Volume: grid={GRID} range={FROM_MIN}-{FROM_MAX} "
      f"density={DENSITY} emission={EMISSION}", flush=True)

os.makedirs(OUT_DIR, exist_ok=True)
total = len(CAMERAS) * len(FRAMES)
print(f"{len(CAMERAS)} cameras x {len(FRAMES)} frames = {total} scout renders\n", flush=True)

t_all = time.time()
done = 0
for cam_name in CAMERAS:
    cam_obj = bpy.data.objects.get(cam_name)
    if cam_obj is None or cam_obj.type != 'CAMERA':
        print(f"WARNING: camera {cam_name!r} not found - skipping", flush=True)
        continue
    scene.camera = cam_obj
    # Hide the body the camera is standing on; its sphere would enclose the lens.
    for body in ("Mercury", "Venus", "Earth", "Mars"):
        p = bpy.data.objects.get(f"Planet_{body}")
        if p is not None:
            p.hide_render = (body == cam_name)

    for frame in FRAMES:
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT_DIR, f"{cam_name}_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)
        done += 1
    print(f"{cam_name}: {len(FRAMES)} frames done "
          f"({time.time() - t_all:.0f}s elapsed)", flush=True)

print(f"\nDone in {time.time() - t_all:.0f}s. {done} thumbnails in {OUT_DIR}")
print("Nothing was changed on disk - this script does not save the .blend.", flush=True)
