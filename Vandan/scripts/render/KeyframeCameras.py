import bpy
import csv
import os

csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "input", "ephemeris", "camera_positions.csv")

with open(csv_path, newline="") as f:
    rows = list(csv.DictReader(f))
    
print(len(rows), rows[0])

# Frame number comes from a timestep's POSITION in the sorted list, not from
# arithmetic on its index. The old "// 10 + 1" silently assumed step-10 data and
# would map every one of the 201 step-1 files onto ~21 frames.
indices = sorted({int(r["vtk_index"]) for r in rows})
frame_of = {idx: i + 1 for i, idx in enumerate(indices)}
print(f"{len(indices)} timesteps -> frames 1..{len(indices)}")

body_names = ["Mercury", "Venus", "Earth", "Mars"]

cameras = {}
for body in body_names:
    obj = bpy.data.objects.get(body)
    if obj is None:
        cam_data = bpy.data.cameras.new(body)
        obj = bpy.data.objects.new(body, cam_data)
        bpy.context.collection.objects.link(obj)
    cameras[body] = obj
    
for row in rows:
    frame = frame_of[int(row["vtk_index"])]
    obj = cameras[row["body"]]
    obj.location = (float(row["x_au"]), float(row["y_au"]), float(row["z_au"]))
    obj.keyframe_insert(data_path="location", frame=frame)

volume = bpy.data.objects["data.0000"]

for obj in cameras.values():
    constraint = obj.constraints.new(type='TRACK_TO')
    constraint.target = volume
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'

bpy.ops.wm.save_mainfile()