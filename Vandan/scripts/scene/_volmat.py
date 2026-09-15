"""Native Cycles volume material driven by a single VDB grid attribute.

Deliberately does NOT use SciBlend. SciBlend's ensure_volume_material_for_object
silently no-ops on repeat calls (measured: six different emission values produced
byte-identical renders), and it has already required seven separate bug patches in
this project. This graph is ~8 nodes and every one is explainable:

    Attribute(grid) -> MapRange(lo..hi -> 0..1) -> Density   (how thick)
                                                -> ColorRamp -> Emission Color
                                                -> Emission Strength (how bright)

Density and emission are driven separately from the same normalised value, so the
CME can be made translucent-but-glowing rather than the all-or-nothing opaque
white that the SciBlend graph produced.

REVERTED from the two-field (tr1 density / rho*r^2 color+emission) version by
explicit request 2026-08-26: that version fixed the flat-wall look during the
~13 of 201 frames per camera where the camera sits fully engulfed in the CME
(tr1 saturates near 1 throughout the cloud interior once "yes, CME" is
established, so plain tr1 has nothing left to show there - rho*r^2 still
varies inside that region and revealed real structure). But it cost 3-4x
render time (measured: 432s vs 103s on the worst frame) because Cycles
evaluates the full shader graph, including a Texture Coordinate read, at every
ray-marching step through the volume - a real, ongoing cost, not one-time
compile. Traded back for speed given GPU-sharing pressure: accept the flat
look on those ~13/201 frames, keep the original single-field cost everywhere
else.
"""

import bpy


def build_volume_material(volume_obj, grid_name, lo, hi, density, emission, ramp_colors):
    name = f"CME_{grid_name}"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")

    # Reads the named grid out of the VDB. 'tr1' is the CME tracer: ~1.0 inside
    # CME material, ~0.0 in ambient solar wind.
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = 'GEOMETRY'
    attr.attribute_name = grid_name

    # Normalise the raw grid range to 0..1 so density/emission constants below
    # mean the same thing regardless of which field is plugged in.
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.inputs['From Min'].default_value = lo
    mr.inputs['From Max'].default_value = hi
    mr.inputs['To Min'].default_value = 0.0
    mr.inputs['To Max'].default_value = 1.0

    dens = nt.nodes.new("ShaderNodeMath")
    dens.operation = 'MULTIPLY'
    dens.inputs[1].default_value = density

    emit = nt.nodes.new("ShaderNodeMath")
    emit.operation = 'MULTIPLY'
    emit.inputs[1].default_value = emission

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    while len(ramp.color_ramp.elements) > 1:
        ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
    first_pos, first_col = ramp_colors[0]
    ramp.color_ramp.elements[0].position = first_pos
    ramp.color_ramp.elements[0].color = first_col
    for pos, col in ramp_colors[1:]:
        el = ramp.color_ramp.elements.new(pos)
        el.color = col

    nt.links.new(attr.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], dens.inputs[0])
    nt.links.new(mr.outputs['Result'], emit.inputs[0])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(dens.outputs['Value'], vol.inputs['Density'])
    nt.links.new(emit.outputs['Value'], vol.inputs['Emission Strength'])
    nt.links.new(ramp.outputs['Color'], vol.inputs['Emission Color'])
    vol.inputs['Color'].default_value = (0.35, 0.45, 0.85, 1.0)
    nt.links.new(vol.outputs['Volume'], out.inputs['Volume'])

    volume_obj.data.materials.clear()
    volume_obj.data.materials.append(mat)
    return mat
