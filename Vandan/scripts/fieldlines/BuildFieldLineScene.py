"""
Adds the magnetic-field streamlines on top of the EXISTING, already-verified
tr1 space scene. Nothing in ../../scripts/fieldlines/ is modified and no existing .blend is
overwritten - this reads SolarWindCME_space.blend and saves to a new file.

    blender --background output/scenes/SolarWindCME_space.blend \
            --python FieldLines/scripts/fieldlines/BuildFieldLineScene.py

Produces output/scenes/SolarWindCME_fieldlines.blend, containing everything the
tr1 scene had (volume sequence, Sun, planets, starfield, 4 keyframed cameras)
plus one field-line mesh object for frame 1. RenderFieldLines.py swaps that mesh
out per frame at render time.

The .ply files carry their colour baked into a POINT-domain colour attribute
named 'Col' (Blender's PLY importer always names it that). The material below is
just: Color Attribute -> Emission -> Output. All the science decisions - what is
blue, what is orange - were already made in TraceFieldLines.py; nothing here
reinterprets the data.
"""

import os
import glob
import bpy

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
PLY_DIR = os.path.join(BASE_DIR, "input", "ply")
OUTPUT_BLEND_PATH = os.path.join(BASE_DIR, "output", "scenes", "SolarWindCME_fieldlines.blend")

MATERIAL_NAME = "FieldLineMat"
FIELDLINE_OBJ_NAME = "FieldLines"
# Emission strength. The lines sit in the same frame as the tr1 volume, which is
# itself emissive - too high and the field washes the CME out, too low and the
# lines vanish against the starfield. Started at 3.0, which blew out to flat
# saturated cyan in the first 4096x2048 test render; 1.2 keeps the blue->cyan
# |B| gradient readable. Retune HERE rather than in the trace script - changing
# it does NOT require re-tracing, only re-running this script.
EMISSION_STRENGTH = 1.2


def build_material():
    mat = bpy.data.materials.get(MATERIAL_NAME)
    if mat is None:
        mat = bpy.data.materials.new(MATERIAL_NAME)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"          # the name Blender's .ply importer assigns
    attr.location = (-320, 0)

    emis = nt.nodes.new("ShaderNodeEmission")
    emis.inputs["Strength"].default_value = EMISSION_STRENGTH
    emis.location = (-100, 0)

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (120, 0)

    nt.links.new(attr.outputs["Color"], emis.inputs["Color"])
    nt.links.new(emis.outputs["Emission"], out.inputs["Surface"])
    return mat


def import_ply(path, mat):
    bpy.ops.wm.ply_import(filepath=path)
    obj = bpy.context.selected_objects[0]
    obj.name = FIELDLINE_OBJ_NAME
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    # The lines are pure emitters used as visible geometry. Letting a million
    # emissive triangles also act as shadow casters / secondary light sources
    # inside a volumetric scene costs real render time for an effect nobody can
    # see - the tr1 volume's look was tuned without them.
    obj.visible_shadow = False
    obj.visible_diffuse = False
    obj.visible_glossy = False
    return obj


def main():
    plys = sorted(glob.glob(os.path.join(PLY_DIR, "fieldlines.*.ply")))
    if not plys:
        raise SystemExit(
            f"No fieldlines.*.ply in {PLY_DIR}. Run TraceFieldLines.py first.")
    print(f"Found {len(plys)} field-line frames")

    mat = build_material()
    obj = import_ply(plys[0], mat)
    print(f"Imported {obj.name}: {len(obj.data.vertices)} verts, "
          f"{len(obj.data.polygons)} polys")
    print("Color attributes:", [a.name for a in obj.data.color_attributes])
    print("Scene frame range:", bpy.context.scene.frame_start,
          "..", bpy.context.scene.frame_end)
    print("Cameras present:", [o.name for o in bpy.data.objects if o.type == 'CAMERA'])

    os.makedirs(os.path.dirname(OUTPUT_BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
    print("Saved:", OUTPUT_BLEND_PATH)


if __name__ == "__main__":
    main()
