import bpy
import os

# Derived from this script's own location, not hardcoded to one machine/user -
# works as long as scripts/scene/ stays inside the Vandan/ folder, wherever that is.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
VDB_SEQUENCE_DIR = os.path.join(BASE_DIR, "input", "vdb_sequence")
FIRST_VDB_FILE = "data.0000.vdb"
# Count the sequence on disk instead of hardcoding it - 21 vs 201 was the whole
# difference between the old step-10 data and the new step-1 data.
import glob as _glob
FRAME_COUNT = len(_glob.glob(os.path.join(VDB_SEQUENCE_DIR, "data.*.vdb")))

GRID_NAME = "rho"
FROM_MIN = 0.0
FROM_MAX = 0.05
AUTO_RANGE = False
EMISSION_STRENGTH = 1.0
COLORMAP = "Inferno (matplotlib)"
ALPHA_MULTIPLIER = 0.15
STEP_SIZE = 0.05
ANISOTROPY = 0.0

OUTPUT_BLEND_PATH = os.path.join(BASE_DIR, "output", "scenes", "SolarWindCME_generated.blend")

# Start from a truly empty scene. NOTE: read_factory_settings() also resets Preferences
# and disables non-bundled extensions like SciBlend - read_homefile() is the real
# "New File" equivalent that clears the scene without touching addon state.
bpy.ops.wm.read_homefile(use_empty=True)
print(f"Sequence length from disk: {FRAME_COUNT} frames")
print("Objects after reset:", list(bpy.data.objects))

# Native Blender operator (not SciBlend-specific) - imports the first frame as a VOLUME object.
bpy.ops.object.volume_import(
    directory=VDB_SEQUENCE_DIR,
    files=[{"name": FIRST_VDB_FILE}],
)
volume_obj = bpy.context.active_object
volume_obj.data.grids.load()  # Bug #4 workaround: grids lazily load, force it now.
print("Imported object:", volume_obj.name, volume_obj.type)
print("Grids found:", [g.name for g in volume_obj.data.grids])

# Equivalent of checking "Sequence" and typing "Frames: 21" in the GUI.
volume_obj.data.is_sequence = True
volume_obj.data.frame_start = 1
# Our files are data.0000..0020 but Blender numbers sequence frames from 1, so
# without -1 every scene frame reads the NEXT file and the volume runs one
# timestep (2.77 days) ahead of the keyframed cameras.
volume_obj.data.frame_offset = -1
volume_obj.data.frame_duration = FRAME_COUNT

# frame_duration above only maps the VDB sequence itself - it doesn't touch the
# scene's playback range, which defaults to 1-250 in a fresh file. Without this,
# playback runs past frame 21 with no volume data left to show.
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = FRAME_COUNT
scene.frame_current = 1

# Match SciBlend's own import behavior: move the object into its own collection.
collection_name = f"{volume_obj.name}_Collection"
volume_collection = bpy.data.collections.get(collection_name)
if not volume_collection:
    volume_collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(volume_collection)
for coll in list(volume_obj.users_collection):
    coll.objects.unlink(volume_obj)
volume_collection.objects.link(volume_obj)

# Register this volume with SciBlend's Filters Generator panel data (VolumeItem),
# same shape its own import operator builds - so the GUI shows correct state if reopened.
settings = bpy.context.scene.filters_volume_settings
settings.last_import_dir = VDB_SEQUENCE_DIR

item = settings.volume_items.add()
item.name = volume_obj.name
item.volume_object = volume_obj
item.last_import_dir = VDB_SEQUENCE_DIR
item.last_import_files.clear()
file_entry = item.last_import_files.add()
file_entry.name = FIRST_VDB_FILE

# Grid metadata doesn't stay loaded across the collection move above - reload right
# before the grid_name enum (whose valid options come from obj.data.grids) reads it.
volume_obj.data.grids.load()
item.grid_name = GRID_NAME
item.from_min = FROM_MIN
item.from_max = FROM_MAX
item.auto_range = AUTO_RANGE
item.clip_min = True
item.clip_max = True
item.alpha_baseline = 0.0
item.alpha_multiplier = ALPHA_MULTIPLIER
item.opacity_unit_distance = 1.0
item.step_size = STEP_SIZE
item.anisotropy = ANISOTROPY
item.emission_strength = EMISSION_STRENGTH
item.colormap = COLORMAP
item.component_mode = 'MAG'
item.slice_invert = False

settings.volume_items_index = len(settings.volume_items) - 1

# Build the actual shader node graph. This is a plain function (not a bpy.ops operator),
# so it runs fine headless with no VIEW_3D context needed.
from bl_ext.blender_org.sciblend.SciBlend.FiltersGenerator.operators.volume_update import ensure_volume_material_for_object
ensure_volume_material_for_object(bpy.context, volume_obj, item)

volume_obj.data.render.space = 'OBJECT'
volume_obj.data.render.clipping = 0.0

os.makedirs(os.path.dirname(OUTPUT_BLEND_PATH), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
print("Saved:", OUTPUT_BLEND_PATH)
