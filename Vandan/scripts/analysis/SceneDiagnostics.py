"""
Diagnostic / sanity-check overlay for the solar wind + CME scene.

Purpose: make the camera layout physically legible. Adds a Sun sphere at the
origin, a marker sphere riding on each planet camera, and an orbit trail per
body, all inside a "Diagnostics" collection that is disabled for render.

Nothing here touches the volume, the SciBlend material, or any render setting -
this is viewport furniture only, and it is safe to delete the collection when
you're done. Re-running the script rebuilds it from scratch.

Run from Blender's Scripting tab (Text Editor -> Run Script) with
SolarWindCME_generated.blend open, AFTER KeyframeCameras.py has run.
"""

import bpy
import bmesh

# ---------------------------------------------------------------- settings --

BODIES = ["Mercury", "Venus", "Earth", "Mars"]
COLLECTION_NAME = "Diagnostics"

# The camera gizmo is drawn CAMERA_DISPLAY_SIZE Blender units long. The default
# of 1.0 = 1 AU, which is 3x Mercury's entire orbit - that is the single reason
# the viewport looks unreadable. Pure decoration: changes zero rendered pixels.
CAMERA_DISPLAY_SIZE = 0.05

# 1 Blender unit = 1 AU throughout this scene. The real Sun is only 0.00465 AU
# in radius - invisible at this zoom - so this marker is ~10x oversized. It
# still sits well inside the sim's hollow inner boundary at r = 0.1 AU, so it
# never intersects actual data.
SUN_RADIUS = 0.05
PLANET_RADIUS = 0.02
TRAIL_THICKNESS = 0.004

# Colour + emission strength per marker (emission = visible with no lights).
COLORS = {
    "Sun":     ((1.00, 0.75, 0.20), 5.0),
    "Mercury": ((0.65, 0.62, 0.58), 2.0),
    "Venus":   ((0.95, 0.85, 0.60), 2.0),
    "Earth":   ((0.25, 0.50, 1.00), 2.0),
    "Mars":    ((0.90, 0.35, 0.20), 2.0),
}

# Hide the volume + slicer in the viewport so the layout is actually visible.
# Flip to False and re-run to bring them back (or click the eye in the outliner).
HIDE_VOLUME = True

# Make Numpad-0 work: the file currently has scene.camera = None. RenderCameras.py
# sets this itself per camera, so this is harmless. Set to None to skip.
ACTIVE_CAMERA = "Earth"

# Each camera's near clip is 0.1 AU, so the nearest 0.1 AU of plasma around each
# planet is invisible to it. That is a real render effect, not a display one -
# leave as None to change nothing, or set e.g. 0.001 to see close-in plasma.
CLIP_START = None

SAVE_FILE = False

# ---------------------------------------------------------------- helpers ---

def emission_material(name, rgb, strength):
    """Get-or-create an emission material. Also sets the Solid-shading colour."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*rgb, 1.0)
    emit.inputs["Strength"].default_value = strength
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def sphere_mesh(name, radius):
    """Build a UV sphere via bmesh - no bpy.ops, so it needs no 3D-view context."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    return mesh


def poly_curve(name, points, thickness):
    """A tube through a list of (x, y, z) - used for the orbit trails."""
    curve = bpy.data.curves.new(name, type='CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = thickness
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)          # a new spline starts with 1 point
    for i, (x, y, z) in enumerate(points):
        spline.points[i].co = (x, y, z, 1.0)    # POLY points are 4D (w = weight)
    return bpy.data.objects.new(name, curve)


# ------------------------------------------------------------------- build --

scene = bpy.context.scene

# 1. Wipe any previous run so re-running doesn't pile up .001 duplicates.
old = bpy.data.collections.get(COLLECTION_NAME)
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)

diag = bpy.data.collections.new(COLLECTION_NAME)
scene.collection.children.link(diag)
diag.hide_render = True     # never pollutes the real 4096-sample renders

# 2. Shrink the camera gizmos. This is the actual fix for the confusion.
for body in BODIES:
    cam = bpy.data.objects.get(body)
    if cam is None or cam.type != 'CAMERA':
        print(f"WARNING: camera '{body}' not found - skipping")
        continue
    cam.data.display_size = CAMERA_DISPLAY_SIZE
    if CLIP_START is not None:
        cam.data.clip_start = CLIP_START

# 3. Sun at the origin. The volume object sits at (0,0,0) and every camera's
#    Track To constraint aims at it, so this sphere marks exactly what they look at.
rgb, strength = COLORS["Sun"]
sun = bpy.data.objects.new("Sun_Marker", sphere_mesh("Sun_Marker", SUN_RADIUS))
sun.data.materials.append(emission_material("Mat_Sun", rgb, strength))
diag.objects.link(sun)

# 4. Sample each camera's keyframed position across the whole timeline, so the
#    orbit trails come from the same data the cameras actually use - no CSV reread.
original_frame = scene.frame_current
tracks = {body: [] for body in BODIES}
for frame in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(frame)
    for body in BODIES:
        cam = bpy.data.objects.get(body)
        if cam is not None:
            tracks[body].append(tuple(cam.location))
scene.frame_set(original_frame)

# 5. A marker sphere per planet, plus its orbit trail.
for body in BODIES:
    cam = bpy.data.objects.get(body)
    if cam is None or not tracks[body]:
        continue
    rgb, strength = COLORS[body]
    mat = emission_material(f"Mat_{body}", rgb, strength)

    marker = bpy.data.objects.new(f"{body}_Marker", sphere_mesh(f"{body}_Marker", PLANET_RADIUS))
    marker.data.materials.append(mat)
    # Copy Location instead of re-keyframing: the marker inherits the camera's
    # animation for free and can never drift out of sync with it.
    con = marker.constraints.new(type='COPY_LOCATION')
    con.target = cam
    diag.objects.link(marker)

    trail = poly_curve(f"{body}_Orbit", tracks[body], TRAIL_THICKNESS)
    trail.data.materials.append(mat)
    diag.objects.link(trail)

# 6. Get the volume out of the way so the layout is visible.
if HIDE_VOLUME:
    for obj in bpy.data.objects:
        if obj.type == 'VOLUME' or obj.name.startswith("Slicer_"):
            obj.hide_set(True)

if ACTIVE_CAMERA:
    scene.camera = bpy.data.objects.get(ACTIVE_CAMERA)

# ----------------------------------------------------------------- report ---

print("\n--- scene geometry (1 Blender unit = 1 AU) ---")
volume = next((o for o in bpy.data.objects if o.type == 'VOLUME'), None)
if volume:
    dims = tuple(round(v, 3) for v in volume.dimensions)
    print(f"volume '{volume.name}' at {tuple(round(v,3) for v in volume.location)}, dimensions {dims}")
for body in BODIES:
    pts = tracks[body]
    if not pts:
        continue
    dists = [sum(c * c for c in p) ** 0.5 for p in pts]
    print(f"{body:8s} r = {min(dists):.3f} .. {max(dists):.3f} AU   "
          f"start {tuple(round(c,3) for c in pts[0])} -> end {tuple(round(c,3) for c in pts[-1])}")
print(f"active camera: {scene.camera.name if scene.camera else None}")
print("--- done ---\n")

if SAVE_FILE:
    bpy.ops.wm.save_mainfile()
    print("Saved.")
