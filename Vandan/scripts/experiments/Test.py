import os
import numpy as np
import pyvista as pv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_DIR = os.path.join(BASE_DIR, "input", "vtk")

mesh = pv.read(os.path.join(INPUT_DIR, "data.0180.vtk"))
mesh = mesh.cell_data_to_point_data()

print(mesh)