# Vandan — Solar wind + CME visualization

Simulation data (`.vtk`) from a PLUTO MHD run, turned into 360° renders of a
coronal mass ejection seen from four planets.

```
Vandan/
├── docs/
│   ├── PROJECT_GUIDE.md          full ~16-week BTP plan
│   ├── SOLAR_WIND_CME_GUIDE.md   living guide for the current task — read first
│   ├── PIPELINE_COMMANDS.md      how to run every stage
│   └── FIELDLINES_NOTES.md       magnetic field line pipeline notes
│
├── input/                        everything the pipeline consumes
│   ├── vtk/                      21 raw PLUTO timesteps, idx 0000–0200  (2.1 GB)
│   ├── vdb/                      201 converted volumes, rho + tr1       (5.3 GB)
│   ├── vdb_sequence/             same files, renumbered for Blender (hard links)
│   ├── ply/                      21 traced magnetic field line meshes   (723 MB)
│   └── ephemeris/                camera_positions.csv from Solar-MACH
│
├── output/                       everything the pipeline produces
│   ├── scenes/                   .blend files
│   ├── renders/
│   │   ├── cme_360/              MAIN tr1 set: 4 cameras × 201 frames + .mp4
│   │   ├── fieldlines_360/       magnetic field line set, same shape
│   │   └── cme_flat/             older flat 1920×1080 set, reference only
│   ├── experiments/              lighting/density/exposure/resolution tests
│   └── logs/
│
├── scripts/
│   ├── pipeline/                 VTK → VDB, sequence renumber, Solar-MACH
│   ├── scene/                    build the Blender scenes
│   ├── render/                   keyframe cameras, render, encode
│   ├── fieldlines/               the independent streamline pipeline
│   ├── analysis/                 diagnostics, colormaps, slice comparison
│   └── experiments/              one-off render tests
│
└── unity/                        AstroViz XR projects (Unity)             (7.1 GB)
```

Every script computes its directories from its own file location, so the tree can
be moved as a whole but the folder names above must not be renamed individually.

**The renders are 4096×2048 equirectangular 360°, not flat frames.** They only
look correct mapped onto the inside of a sphere.
