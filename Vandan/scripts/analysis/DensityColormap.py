import pyvista as pv
mesh = pv.read('../../input/vtk/data.0180.vtk')
print(mesh)
print('arrays:', list(mesh.cell_data.keys()))
mesh.plot(scalars='rho', cmap='plasma')