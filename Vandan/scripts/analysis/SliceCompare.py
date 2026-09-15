import pyvista as pv

quiet = pv.read('../../input/vtk/data.0050.vtk').slice(normal='z', origin=(0,0,0))
cme   = pv.read('../../input/vtk/data.0180.vtk').slice(normal='z', origin=(0,0,0))

pl = pv.Plotter(shape=(1,2))
pl.subplot(0,0); pl.add_mesh(quiet, scalars='rho', cmap='plasma'); pl.add_text('idx 0050 - quiet - rho')
pl.subplot(0,1); pl.add_mesh(cme,   scalars='tr1',  cmap='plasma'); pl.add_text('idx 0180 - CME peak - tr1')
pl.link_views()
pl.show()