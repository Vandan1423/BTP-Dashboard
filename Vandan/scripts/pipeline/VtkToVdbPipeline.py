import pyvista as pv
import numpy as np
import openvdb
import os
import glob
import re
import time

# Derived from this script's own location, not the cwd it's run from -
# works as long as scripts/pipeline/ stays inside the Vandan/ folder, wherever that is.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_DIR = os.path.join(BASE_DIR, "input", "vtk")
OUTPUT_DIR = os.path.join(BASE_DIR, "input", "vdb")

#Read the timesteps off disk rather than hardcoding a range - works for any
#cadence the professor ships.
_files = glob.glob(os.path.join(INPUT_DIR, "data.*.vtk"))
_indices = sorted(int(re.search(r"data\.(\d+)\.vtk$", f).group(1)) for f in _files)
if not _indices:
    raise SystemExit(f"No data.*.vtk found in {INPUT_DIR}")
timesteps = [f"{i:04d}" for i in _indices]
print(f"Found {len(timesteps)} timesteps: {_indices[0]}..{_indices[-1]}")

#Only convert the fields we actually render. All 13 at 201 timesteps is ~40 GB on
#disk and ~870 MB of VRAM per frame; rho+tr1 is roughly a sixth of both, which
#matters a lot on a GPU shared with other people. Set to None to write all fields.
FIELDS = ["rho", "tr1"]

#Read the mesh
mesh = pv.read(os.path.join(INPUT_DIR, "data.0000.vtk"))

#Get the list of all field names before converting cell data to point data
field_names = list(mesh.cell_data.keys())
if FIELDS is not None:
    missing = [f for f in FIELDS if f not in field_names]
    if missing:
        raise SystemExit(f"Requested fields not in data: {missing}. Available: {field_names}")
    field_names = list(FIELDS)
print(f"Writing {len(field_names)} field(s) per file: {field_names}")

#Convert cell data to point data
mesh = mesh.cell_data_to_point_data()

#Extract the upper and lower bounds of mesh
xmin , xmax, ymin, ymax, zmin, zmax = mesh.bounds

#Define a voxel : A volumetric 3D equivalent of a pixel
RESOLUTION = 256
voxel_size = max(xmax-xmin, ymax-ymin, zmax-zmin)/(RESOLUTION-1)

#Define grid of voxels
voxel_grid = pv.ImageData(
    dimensions=(RESOLUTION, RESOLUTION, RESOLUTION),
    spacing=(voxel_size, voxel_size, voxel_size),
    origin=(xmin, ymin, zmin) #origin is not center, its the starting voxel point
)

#Map the indices of the VDB grid to the physical coordinates of the original mesh
transform = openvdb.createLinearTransform(voxelSize = voxel_size)
transform.postTranslate((xmin, ymin, zmin))

#Define the output directory
os.makedirs(OUTPUT_DIR, exist_ok=True)

#Loop for all the input files
_t_start = time.time()
for _n, ts in enumerate(timesteps, 1):
    _t0 = time.time()
    #Read, convert and sample the input for a particular timestamp
    mesh_ts = pv.read(os.path.join(INPUT_DIR, f"data.{ts}.vtk"))

    #Drop unwanted fields BEFORE the expensive steps. Both cell_data_to_point_data()
    #and sample() interpolate every array that is present, so carrying all 13
    #through them just to keep 2 is ~6x of wasted interpolation per file - which
    #over 201 files is hours.
    for _name in list(mesh_ts.cell_data.keys()):
        if _name not in field_names:
            del mesh_ts.cell_data[_name]

    mesh_ts = mesh_ts.cell_data_to_point_data()
    resampled = voxel_grid.sample(mesh_ts)

    #Define a list to collect all the VDB grids for the current timestamp
    grids = []
    for name in field_names:
        values_3d = resampled.point_data[name].reshape((RESOLUTION, RESOLUTION, RESOLUTION), order='F')
        values_3d = np.ascontiguousarray(values_3d)

        grid = openvdb.FloatGrid()
        grid.copyFromArray(values_3d)
        grid.name = name
        grid.transform = transform

        grids.append(grid)

    openvdb.write(os.path.join(OUTPUT_DIR, f"data.{ts}.vdb"), grids=grids)
    _dt = time.time() - _t0
    _eta = (len(timesteps) - _n) * (time.time() - _t_start) / _n / 60
    print(f"[{_n}/{len(timesteps)}] data.{ts}.vtk -> data.{ts}.vdb  {_dt:.1f}s  "
          f"| ETA {_eta:.0f} min", flush=True)

print("Done converting VTK to VDB for all input files")
