"""Find a volume density/emission pair that survives BOTH the CME peak and its tail.

Why this script exists: the settings shipped in BuildSpaceScene.py (density 15,
emission 4.2) were chosen by a sweep whose pass/fail test was "0% of pixels blown
out". Under Blender's default AgX view transform an overexposed image never
reaches white - it rolls off to a neutral grey plateau near 169 - so that test is
structurally incapable of detecting overexposure. It passed every config, and the
brightest one won. Measured on Mercury frame 170: 81% of the frame sits in a
40-level grey band, interquartile spread = 8 levels out of 256.

Two deliberate differences from TestRenderSettings.py:

1. TWO frames, not one. Frame 170 is blown flat (IQR 8). Frame 185 is currently
   FINE (IQR 143). A fix that rescues 170 by dimming everything would quietly
   destroy 185, and a single-frame test would call that a win. It is the same
   class of mistake as the original metric, so the sweep refuses to make it.

2. Density and emission move in opposite directions. The peak frame's problem is
   OPACITY, not brightness - the camera sits inside dense CME material, so the
   path length through it is enormous. Lowering density lets you see through the
   plasma; raising emission keeps it glowing. _volmat.py drives the two from the
   same normalised value precisely so they can be tuned apart.

Cheap on purpose: 25% resolution and 64 samples is ~1/25th the work (~4 s/frame
instead of ~100 s). Neither resolution nor sample count changes exposure or
opacity, so the answer is identical to a full-size render.

    ~/blender-5.2.0-linux-x64/blender --background \
        ~/BTP_SolarWindCME/BlenderOutputs/SolarWindCME_space.blend \
        --python ~/BTP_SolarWindCME/scripts/experiments/TestBrightness.py
"""

import bpy
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "..", "output", "experiments", "_brightnesstest")
CAM = "Mercury"

# 170 = blown flat today (IQR 8). 185 = good today (IQR 143). A winner has to fix
# the first WITHOUT wrecking the second.
# 80 = one of the 161 frames that are currently empty black sky; the single
# most important question for rho is whether anything shows up there at all.
FRAMES = [80, 170, 185]

# ROUND 3. Rounds 1-2 settled the exposure question and then disqualified the
# field itself. Walking emission/density down 16x (A -> I) did NOT reveal any
# structure at frame 170 - it just produced a darker grey wall - while measurably
# degrading frame 185. The reason is in _volmat.py's own note: tr1 is ~1.0 inside
# CME material and ~0.0 outside, i.e. near-binary. At frame 170 Mercury is
# engulfed, so every ray traverses a long path of uniform tr1=1. Uniform data
# renders as a uniform wall at ANY exposure; the "veins" visible at frame 185 are
# the cloud's boundary, seen from outside it.
#
# So this round tests the field, not the exposure. rho varies continuously
# everywhere - including inside the CME - and is nonzero across the whole domain,
# which is also the only thing that could put anything on screen during frames
# 1-161 (measured: median grey 1, i.e. empty black sky).
#
# rho was rejected earlier for making "opaque fog", but that was measured at
# density=15. Optical depth is density x path, and the domain is ~4 AU across, so
# transparency needs density well under ~0.25. In that optically-thin regime
# brightness tracks emission x path directly, NOT emission/density as in round 2.
#
# (label, grid, from_min, from_max, density, emission)
CONFIGS = [
    # control: the best tr1 config from round 2, for direct comparison
    ("H2", "tr1", 0.0,    1.0,  15.0, 0.50),
    # rho range from the manual calibration in SOLAR_WIND_CME_GUIDE.md 6:
    # auto-range reports [0.0016, 81.08], but 81.08 is a single-voxel outlier and
    # a linear map across it crushes all real structure to zero. 0.02 is where the
    # real data lives.
    ("N",  "rho", 0.0016, 0.02,  0.10, 0.30),
    ("O",  "rho", 0.0016, 0.02,  0.10, 1.00),
    ("P",  "rho", 0.0016, 0.02,  0.30, 0.30),
    ("Q",  "rho", 0.0016, 0.02,  0.30, 1.00),
    ("R",  "rho", 0.0016, 0.02,  1.00, 0.30),
    ("S",  "rho", 0.0016, 0.02,  1.00, 1.00),
]

TEST_RESOLUTION_PCT = 25
TEST_SAMPLES = 64

scene = bpy.context.scene

# METAL on the Mac, CUDA on the A30 - assigning the wrong one raises TypeError,
# and a non-matching device loop silently disables everything and falls back to CPU.
COMPUTE_TYPE = 'METAL' if sys.platform == 'darwin' else 'CUDA'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = COMPUTE_TYPE
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == COMPUTE_TYPE)
print("DEVICES ENABLED ->", [(d.name, d.type) for d in prefs.devices if d.use], flush=True)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_percentage = TEST_RESOLUTION_PCT
scene.cycles.samples = TEST_SAMPLES
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
try:
    scene.cycles.denoising_use_gpu = True
except Exception as e:
    print("  NOTE: denoising_use_gpu unavailable:", e)

# ---- report what is actually in this .blend ---------------------------------
# The first run of this script failed with "no material with a Principled Volume
# node". Two things were wrong with that check: it gated on Material.use_nodes,
# which Blender 5.2 deprecates (it warns, and is unreliable), and it failed
# silently-ish instead of saying what IS here. Both fixed: the scan below never
# touches use_nodes, and it always prints an inventory before deciding.
print("=== MATERIALS IN THIS FILE ===", flush=True)
for m in bpy.data.materials:
    nodes = list(m.node_tree.nodes) if m.node_tree else []
    print(f"  {m.name!r}: {[n.bl_idname for n in nodes]}", flush=True)

print("=== VOLUME OBJECTS ===", flush=True)
for o in bpy.data.objects:
    if o.type == 'VOLUME':
        slots = [s.material.name if s.material else None for s in o.material_slots]
        try:
            grids = [g.name for g in o.data.grids]
        except Exception as e:
            grids = f"<unreadable: {e}>"
        print(f"  {o.name!r}: material_slots={slots} grids={grids}", flush=True)
print("", flush=True)

# ---- locate the volume material by structure, not by name ------------------
# Looking it up as bpy.data.materials["CME_tr1"] would break silently the moment
# VOLUME_GRID changes in BuildSpaceScene.py. The one thing that is actually
# invariant is that it is the material containing a Principled Volume node.
# Matched on bl_idname as well as .type, since only bl_idname is guaranteed stable.
mat = vol = None
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in m.node_tree.nodes:
        if n.bl_idname == 'ShaderNodeVolumePrincipled' or n.type == 'VOLUME_PRINCIPLED':
            mat, vol = m, n
            break
    if mat:
        break

if mat is None:
    # Not a crash-and-guess: name the most likely cause from what we just printed.
    legacy = [m.name for m in bpy.data.materials if m.node_tree and any(
        n.bl_idname in ('ShaderNodeVolumeScatter', 'ShaderNodeVolumeAbsorption',
                        'ShaderNodeEmission') for n in m.node_tree.nodes)]
    print("!!! No Principled Volume node anywhere in this .blend.", flush=True)
    if legacy:
        print(f"!!! Found volume-ish materials built a DIFFERENT way: {legacy}", flush=True)
        print("!!! That means this .blend predates _volmat.py - it is still using the", flush=True)
        print("!!! old SciBlend-style graph. Rebuild it with BuildSpaceScene.py.", flush=True)
    else:
        print("!!! No volume material at all. The .blend on this machine is out of", flush=True)
        print("!!! sync with scripts/experiments/ - rebuild it with BuildSpaceScene.py.", flush=True)
    raise SystemExit(1)

nt = mat.node_tree
print(f"Volume material: {mat.name!r}", flush=True)


def node_feeding(target, socket_name):
    """The node whose output is plugged into vol's named input.

    Follows the link backwards rather than indexing nodes[] or inputs[N].
    Hard-coded indices are exactly what broke SciBlend three separate times in
    this project - a graph edit shifts them and the failure is silent.
    """
    for l in nt.links:
        # Compare by NAME, not identity. Blender's RNA constructs a fresh Python
        # wrapper on every attribute access, so `l.to_node is vol` is False even
        # when both refer to the same node - which is exactly how the first
        # version of this function failed. Node names are unique within a tree,
        # so this is the reliable comparison.
        if l.to_node.name == target.name and l.to_socket.name == socket_name:
            return l.from_node
    print(f"  !!! nothing feeds {socket_name!r}. Full graph:", flush=True)
    for l in nt.links:
        print(f"      {l.from_node.name}.{l.from_socket.name}"
              f"  ->  {l.to_node.name}.{l.to_socket.name}", flush=True)
    available = [s.name for s in target.inputs]
    raise RuntimeError(
        f"Nothing feeds {target.name}.{socket_name!r}. Available: {available}")


dens_node = node_feeding(vol, 'Density')
emit_node = node_feeding(vol, 'Emission Strength')
# Walk further back: Math <- MapRange <- Attribute. Same link-following rule,
# so a graph edit in _volmat.py can't silently shift an index out from under us.
map_node = node_feeding(dens_node, 'Value')
attr_node = node_feeding(map_node, 'Value')
print(f"Density driven by  : {dens_node.name} ({dens_node.type})", flush=True)
print(f"Emission driven by : {emit_node.name} ({emit_node.type})", flush=True)
print(f"Range node         : {map_node.name} ({map_node.type})", flush=True)
print(f"Attribute node     : {attr_node.name} -> grid {attr_node.attribute_name!r}", flush=True)

# inputs[1] is the MULTIPLY node's second slot - the constant _volmat.py bakes in.
print(f"Current values     : density={dens_node.inputs[1].default_value}, "
      f"emission={emit_node.inputs[1].default_value}\n", flush=True)

# ---- camera ----------------------------------------------------------------
cam_obj = bpy.data.objects[CAM]
scene.camera = cam_obj
# The camera sits at its planet's exact position, so that planet's sphere would
# enclose it and fill the frame with its own interior. Hide the body you stand on.
for body in ("Mercury", "Venus", "Earth", "Mars"):
    p = bpy.data.objects.get(f"Planet_{body}")
    if p is not None:
        p.hide_render = (body == CAM)

os.makedirs(OUT_DIR, exist_ok=True)
print(f"{scene.render.resolution_x * TEST_RESOLUTION_PCT // 100}x"
      f"{scene.render.resolution_y * TEST_RESOLUTION_PCT // 100} at {TEST_SAMPLES} samples, "
      f"{len(CONFIGS)} configs x {len(FRAMES)} frames = {len(CONFIGS) * len(FRAMES)} renders\n",
      flush=True)

t_all = time.time()
for label, grid, lo, hi, density, emission in CONFIGS:
    attr_node.attribute_name = grid
    map_node.inputs['From Min'].default_value = lo
    map_node.inputs['From Max'].default_value = hi
    dens_node.inputs[1].default_value = density
    emit_node.inputs[1].default_value = emission

    for frame in FRAMES:
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT_DIR, f"{label}_f{frame}.png")
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"{label:3s} grid={grid:4s} range={lo}-{hi} density={density:<5} "
              f"emission={emission:<5} frame {frame:3d}"
              f"  -> {time.time() - t0:5.1f}s", flush=True)

print(f"\nDone in {time.time() - t_all:.0f}s. Wrote {len(CONFIGS) * len(FRAMES)} PNGs to {OUT_DIR}")
print("Nothing else was changed - this script does not save the .blend.", flush=True)
