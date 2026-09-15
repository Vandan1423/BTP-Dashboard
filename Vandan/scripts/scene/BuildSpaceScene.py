"""
Adds the visual space environment on top of the science scene, and switches the
volume from `rho` (density) to `tr1` (the CME tracer).

Run it with SolarWindCME_generated.blend open - it reads that scene, adds the Sun,
the four planets, a starfield world and lighting, retunes the volume, and saves to
a SEPARATE file so the original stays untouched:

    blender --background output/scenes/SolarWindCME_generated.blend \
            --python scripts/scene/BuildSpaceScene.py

Why tr1 instead of rho: `rho` is nonzero everywhere, so at 1 AU the camera sits
permanently inside opaque fog and can never see the Sun, the planets or the stars.
`tr1` is ~1.0 only inside CME material and ~0.0 elsewhere, so space stays clear
until the CME actually arrives - which is the whole point of the shot.
"""

import bpy
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _volmat import build_volume_material

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
CSV_PATH = os.path.join(BASE_DIR, "input", "ephemeris", "camera_positions.csv")
OUTPUT_BLEND_PATH = os.path.join(BASE_DIR, "output", "scenes", "SolarWindCME_space.blend")

BODIES = ["Mercury", "Venus", "Earth", "Mars"]

# ------------------------------------------------------------------ scale --
# 1 Blender unit = 1 AU. At true scale Earth's radius is 4.3e-5 AU, which from
# another planet is far smaller than one pixel - literally invisible. So every
# body here is deliberately oversized, which is standard practice in
# heliospheric visualisation (NASA/NOAA space-weather renders do the same).
# These are the numbers to quote if the professor asks "is this to scale?" - the
# POSITIONS are physically real, the RADII are not.
# HARD CEILING on SUN_RADIUS: the simulation domain's inner boundary is r = 0.1 AU.
# A Sun larger than that would poke into / occlude real data and stop being
# defensible. 0.08 stays inside it while reading as genuinely huge - about 9.2 deg
# seen from 1 AU, roughly 18 full moons across.
SUN_RADIUS = 0.08          # ~17x the real Sun
PLANET_RADIUS = 0.03       # ~700x oversized
# Viewport-only gizmo size for the camera 'pyramid'. Blender's default is 1.0 =
# 1 AU, which is 3x Mercury's whole orbit - that alone makes the viewport
# unreadable. Changes ZERO rendered pixels; it is decoration, like an icon size.
CAMERA_DISPLAY_SIZE = 0.03

# Approximate visual colours. Replace with real texture maps later (see
# apply_texture() at the bottom) - the sphere geometry does not change.
PLANET_COLOR = {
    "Mercury": (0.62, 0.58, 0.54, 1.0),
    "Venus":   (0.90, 0.78, 0.52, 1.0),
    "Earth":   (0.22, 0.42, 0.75, 1.0),
    "Mars":    (0.75, 0.34, 0.20, 1.0),
}

SUN_COLOR = (1.0, 0.72, 0.28, 1.0)
SUN_EMISSION_STRENGTH = 120.0
SUN_LIGHT_POWER = 2000.0   # watts; tune this if planets look too dark/blown out

# Voronoi, not Noise. A noise texture pushed through a threshold has no usable
# setting here - measured: 0.70 covers the sky in white blobs, 0.76 gives nothing
# at all, because the Fac distribution is too sharp. Voronoi places exactly one
# feature point per cell, so STAR_SCALE controls star COUNT and STAR_SIZE
# controls star SIZE, independently and predictably.
STAR_SCALE = 60.0
STAR_SIZE = 0.13
STAR_BRIGHTNESS = 2.5

# ----------------------------------------------------------------- volume --
# REVERTED to single-field tr1 by explicit request 2026-08-26, trading back the
# ~13/201-frames-per-camera flat-wall look (camera fully engulfed in the CME,
# where tr1 saturates near 1 throughout the interior and has nothing left to
# show) for the original ~3-4x faster render cost. The two-field version
# (tr1 density / rho*r^2 color+emission, in git history / output/renders/cme_360_r2rho on
# the GPU box) fixed that flat-wall case but cost real, ongoing render time -
# Cycles evaluates the full shader graph, including a Texture Coordinate read,
# at EVERY ray-marching step through the volume, not once per pixel. See
# _volmat.py's docstring for the full tradeoff.
VOLUME_GRID = "tr1"
VOLUME_FROM_MIN = 0.0
VOLUME_FROM_MAX = 1.0      # tr1 is near-binary, so the true data range IS 0..1
# DENSITY LOWERED 15.0 -> 8.0, measured 2026-08-26 via scripts/scene/TestDensity.py +
# TestFinal.py (local Mac, Earth camera, frame 171 = vtk idx 170, near-peak CME).
# Root cause of the "flat wall" look was NOT tone-mapping (AgX vs Standard only
# moved the IQR 23->30, visually indistinguishable) - it was density=15 making
# the CME optically thick enough that rays saturate (fully absorbed/emitting)
# almost everywhere tr1 is non-trivial, killing path-length-dependent structure
# before tone-mapping ever sees it. Sweeping density alone (emission held at
# 4.2, Standard transform) gave a monotonic, MUCH bigger effect than exposure
# ever did: IQR 53 (d=15) -> 75 (d=8) -> 96 (d=4, but 12.4% pixels now clipped
# white) -> 106 (d=2, 16.2% clipped). d=8.0 chosen as the safe point: the big
# structure win with negligible clipping (0.1%). Visually confirmed too - d=15
# renders as a soft featureless blob, d=8 shows real internal shape.
VOLUME_DENSITY = 8.0
VOLUME_EMISSION = 4.2

# inferno (matplotlib), 7 stops, sRGB->linear converted for Blender's linear
# color sockets - see GeneratingColormapsUsingPython/ for the generator. Chosen
# over the previous hand-picked violet/magenta/yellow ramp per direct request:
# reads as "hot charged plasma" without matching the Sun's own orange-white
# (which would erase the visual separation between the two), and is a named,
# reproducible scientific colormap rather than an eyeballed gradient.
VOLUME_RAMP = [
    (0.000, (0.0001, 0.0000, 0.0011, 1.0)),
    (0.167, (0.0323, 0.0030, 0.1112, 1.0)),
    (0.333, (0.1893, 0.0117, 0.1536, 1.0)),
    (0.500, (0.5005, 0.0383, 0.0891, 1.0)),
    (0.667, (0.8474, 0.1411, 0.0186, 1.0)),
    (0.833, (0.9688, 0.4669, 0.0106, 1.0)),
    (1.000, (0.9737, 0.9963, 0.3735, 1.0)),
]

# What the .blend should look like the moment it is opened by a human.
RESOLUTION_X = 4096
RESOLUTION_Y = 2048
DEFAULT_CAMERA = "Earth"
DEFAULT_FRAME = None        # None = jump to the first frame with CME material

SPACE_COLLECTION = "SpaceScene"

scene = bpy.context.scene


def safe_set(node, socket_name, value):
    """Set a node socket BY NAME, never by index.

    Blender renumbers Principled BSDF sockets between versions - hardcoded
    indices are exactly what broke SciBlend three separate times in this project.
    Looking sockets up by name and skipping missing ones fails loudly-but-safely
    instead of silently writing to the wrong input.
    """
    socket = node.inputs.get(socket_name)
    if socket is None:
        print(f"  NOTE: socket '{socket_name}' not found on {node.bl_idname} - skipped")
        return False
    socket.default_value = value
    return True


def get_collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        scene.collection.children.link(coll)
    return coll


def make_sphere(name, radius, collection):
    """Create (or reuse) a smooth UV sphere. Re-running the script rebuilds
    cleanly instead of stacking duplicate objects on top of each other."""
    existing = bpy.data.objects.get(name)
    if existing is not None:
        bpy.data.objects.remove(existing, do_unlink=True)

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)

    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=radius)
    bm.to_mesh(mesh)
    bm.free()

    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def make_emission_material(name, color, strength):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    safe_set(em, "Color", color)
    safe_set(em, "Strength", strength)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def make_planet_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    safe_set(bsdf, "Base Color", color)
    safe_set(bsdf, "Roughness", 0.85)
    safe_set(bsdf, "Metallic", 0.0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# =============================================================== the scene ==

space = get_collection(SPACE_COLLECTION)

# ---- Sun -------------------------------------------------------------------
# Two objects doing two different jobs: an emissive sphere you can SEE, and a
# point light that actually LIGHTS the planets. An emissive mesh alone would
# light them too, but far more noisily - Cycles samples a real light much better.
sun = make_sphere("Sun", SUN_RADIUS, space)
sun.location = (0.0, 0.0, 0.0)
sun.data.materials.clear()
sun.data.materials.append(make_emission_material("SunMat", SUN_COLOR, SUN_EMISSION_STRENGTH))
print(f"Sun: radius {SUN_RADIUS} AU at origin")

existing_light = bpy.data.objects.get("SunLight")
if existing_light is not None:
    bpy.data.objects.remove(existing_light, do_unlink=True)
light_data = bpy.data.lights.new("SunLight", type='POINT')
light_data.energy = SUN_LIGHT_POWER
light_data.color = SUN_COLOR[:3]
light_data.shadow_soft_size = SUN_RADIUS
sun_light = bpy.data.objects.new("SunLight", light_data)
space.objects.link(sun_light)
sun_light.location = (0.0, 0.0, 0.0)
print(f"SunLight: {SUN_LIGHT_POWER}W point light at origin")

# ---- Planets ---------------------------------------------------------------
# Same CSV, same frame mapping, same physically-derived positions the cameras
# already use - so each planet sphere sits exactly where its camera sits.
with open(CSV_PATH, newline="") as f:
    rows = list(csv.DictReader(f))
# Same position-based frame mapping the cameras use - the planets must land on
# exactly the same frames as the cameras they sit with.
_indices = sorted({int(r["vtk_index"]) for r in rows})
frame_of = {idx: i + 1 for i, idx in enumerate(_indices)}
print(f"Read {len(rows)} position rows from {os.path.basename(CSV_PATH)} "
      f"-> {len(_indices)} timesteps, frames 1..{len(_indices)}")

planets = {}
for body in BODIES:
    obj = make_sphere(f"Planet_{body}", PLANET_RADIUS, space)
    obj.data.materials.clear()
    obj.data.materials.append(make_planet_material(f"Mat_{body}", PLANET_COLOR[body]))
    planets[body] = obj

for row in rows:
    body = row["body"]
    if body not in planets:
        continue
    frame = frame_of[int(row["vtk_index"])]
    obj = planets[body]
    obj.location = (float(row["x_au"]), float(row["y_au"]), float(row["z_au"]))
    obj.keyframe_insert(data_path="location", frame=frame)

for body, obj in planets.items():
    print(f"Planet_{body}: radius {PLANET_RADIUS} AU, keyframed across {len(rows)//len(BODIES)} frames")

# ---- Starfield -------------------------------------------------------------
# Procedural on purpose: no external HDRI to download, nothing to break when the
# file moves between the Mac and the GPU box. A high-frequency noise pushed
# through a very narrow colour ramp leaves only sparse bright specks = stars.
world = bpy.data.worlds.get("SpaceWorld") or bpy.data.worlds.new("SpaceWorld")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()

w_out = nt.nodes.new("ShaderNodeOutputWorld")
w_bg = nt.nodes.new("ShaderNodeBackground")
w_ramp = nt.nodes.new("ShaderNodeValToRGB")
w_vor = nt.nodes.new("ShaderNodeTexVoronoi")
w_coord = nt.nodes.new("ShaderNodeTexCoord")

w_vor.feature = 'F1'
w_vor.distance = 'EUCLIDEAN'
safe_set(w_vor, "Scale", STAR_SCALE)
safe_set(w_vor, "Randomness", 1.0)

# Voronoi's Distance output is ~0 exactly at each cell's feature point and grows
# outward. White at 0 fading to black by STAR_SIZE therefore paints one small
# round dot per cell - a star. Larger STAR_SIZE = fatter stars.
w_ramp.color_ramp.elements[0].position = 0.0
w_ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
w_ramp.color_ramp.elements[1].position = STAR_SIZE
w_ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)

safe_set(w_bg, "Strength", STAR_BRIGHTNESS)

nt.links.new(w_coord.outputs["Generated"], w_vor.inputs["Vector"])
nt.links.new(w_vor.outputs["Distance"], w_ramp.inputs["Fac"])
nt.links.new(w_ramp.outputs["Color"], w_bg.inputs["Color"])
nt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])
print(f"Starfield world: Voronoi scale {STAR_SCALE}, star size {STAR_SIZE}")

# ---- Volume: rho -> tr1 ----------------------------------------------------
volume_obj = next((o for o in bpy.data.objects if o.type == 'VOLUME'), None)
if volume_obj is None:
    print("ERROR: no VOLUME object in this scene - open the generated .blend, not an empty file")
else:
    # OFF-BY-ONE FIX. Our hard links are data.0000..0020, but Blender's volume
    # sequence assumes the first file of a sequence is numbered 1, not 0 - so at
    # scene frame 1 it looks for data.0001.vdb and every frame reads one file
    # ahead. Verified against the data: tr1 is exactly zero at vtk idx 150 and
    # 160, yet frame 17 rendered fully engulfed, which is idx 170's content.
    # Left unfixed, the cameras and the volume are one timestep (2.77 days) apart.
    volume_obj.data.frame_offset = -1

    # Blender loads OpenVDB grid metadata lazily; force it before we name a grid.
    volume_obj.data.grids.load()
    available = [g.name for g in volume_obj.data.grids]
    if VOLUME_GRID not in available:
        print(f"ERROR: grid '{VOLUME_GRID}' not in {available}")
    else:
        build_volume_material(
            volume_obj, VOLUME_GRID,
            VOLUME_FROM_MIN, VOLUME_FROM_MAX,
            VOLUME_DENSITY, VOLUME_EMISSION, VOLUME_RAMP,
        )
        print(f"Volume: grid={VOLUME_GRID}, range {VOLUME_FROM_MIN}-{VOLUME_FROM_MAX}, "
              f"density={VOLUME_DENSITY}, emission={VOLUME_EMISSION} (native Cycles material)")

# ---- make the saved file self-describing -----------------------------------
# Without this the .blend opens in EEVEE (which cannot render panoramic cameras
# at all, and handles volumes completely differently), with no active camera, on
# frame 1 - which is the spin-up frame, before the solar wind has even crossed
# the domain. Opening it would show an empty scene and look broken. The render
# scripts set all of this at runtime anyway; saving it just means what you see
# on open is what you actually get.
scene.render.engine = 'CYCLES'
scene.cycles.samples = 256          # sane default for a GUI F12; scripts override
scene.cycles.volume_bounces = 1
scene.cycles.volume_step_rate = 3.0
scene.render.resolution_x = RESOLUTION_X
scene.render.resolution_y = RESOLUTION_Y
# Standard, not AgX (Blender's default since 4.0). Measured 2026-08-26: at the
# same density, Standard's IQR was consistently wider than AgX's (53 vs 50 at
# d=15; 75 vs 59 at d=8) with no extra highlight clipping - AgX's filmic rolloff
# is tuned for photographic "look", which works against reading scientific
# volumetric data honestly. RenderCameras.py also sets this explicitly at
# runtime; setting it here too keeps a GUI F12 on this file representative.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = 0.0

for _body in BODIES:
    _cam = bpy.data.objects.get(_body)
    if _cam is not None and _cam.type == 'CAMERA':
        _cam.data.type = 'PANO'
        _cam.data.panorama_type = 'EQUIRECTANGULAR'
        _cam.data.display_size = CAMERA_DISPLAY_SIZE

scene.camera = bpy.data.objects.get(DEFAULT_CAMERA)
scene.frame_current = DEFAULT_FRAME if DEFAULT_FRAME else max(1, int(len(_indices) * 0.85))
print(f"Scene defaults: engine=CYCLES, camera={DEFAULT_CAMERA}, frame={scene.frame_current}, "
      f"cameras=PANO/EQUIRECTANGULAR, res={RESOLUTION_X}x{RESOLUTION_Y}")

os.makedirs(os.path.dirname(OUTPUT_BLEND_PATH), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
print("Saved:", OUTPUT_BLEND_PATH)
