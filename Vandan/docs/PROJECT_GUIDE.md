# BTP Project Guide
## Turning Real Astronomical Simulation Data Into an Interactive, Visual Experience

**Author:** Vandan Nagori
**Date:** July 2026
**Duration:** One semester (~16 weeks)

---

## Part 0 — How to read this document

This document is meant to be read from start to finish, once, before you write any code. It is long on purpose. After that first read you will mostly come back to three sections: **Part 5** (what data to ask your professor for), **Part 10** (the week-by-week schedule), and **Part 14** (the glossary, whenever a word confuses you).

I have written it assuming you are comfortable with Python but are a genuine beginner in Blender and Unity. So when I use a graphics or game-engine word for the first time, I explain it in plain language right there, and it also appears in the glossary at the end.

A note on honesty: this document contains some blunt assessments of the code that currently exists in your `TorusSimulation` folder. None of that is criticism of you — you were learning, and the approach you tried is one that many people try. But you cannot plan the next four months on top of a foundation that does not work, so I have to tell you exactly what is broken and why. That is Part 2.

---

## Part 1 — What we are actually building

### 1.1 The goal in one paragraph

Your professor will hand you files full of numbers — the output of real astrophysics simulations, and real spacecraft trajectory records from space agencies. Right now those numbers can only be understood by a specialist looking at a graph. Your job is to turn them into something a normal person can *experience*: a 3D world they can fly through, where they can watch a spacecraft actually swing around Jupiter and get flung out toward Saturn, or watch hot magnetized gas spiral into a black hole and launch a jet. Not a static picture. Not a chart. A moving, explorable, interactive experience — eventually one you can put on in a VR headset, and possibly one that gets projected onto the dome of a planetarium.

### 1.2 Breaking that down into concrete deliverables

By the end of the semester you should have four things:

**Deliverable 1: A reusable pipeline (a piece of software).** This is a Python program. You give it a folder of raw simulation data and a small configuration file describing what you want to see, and it automatically produces a Blender 3D scene, renders it into an animation, and encodes it into a video. No manual clicking in Blender. This matters because it means adding the fifth, sixth, and seventh scenario later costs hours instead of weeks.

**Deliverable 2: Rendered movies.** High-quality video files produced by that pipeline. These are what you show in a presentation, embed in your report, and — in a modified square "fisheye" format — what a planetarium could project.

**Deliverable 3: An interactive Unity application.** This is the part that makes your project different from a normal planetarium show. The viewer is not watching a fixed film; they can move the camera, change the speed of time, jump to a specific date, click on a planet to see real data about it, switch between viewpoints, and toggle things on and off.

**Deliverable 4: A VR version of that application.** The same experience, but in a headset, where you can reach out and grab the solar system with your hands.

### 1.3 Why the "pipeline" idea matters so much

I want to spend a moment on this because it is the single most important structural decision in the project.

Imagine you do it the manual way. You open Blender, you import some data, you click around for two days, you build a beautiful scene of an accretion disk, you render it. Wonderful. Now your professor says "great, now do the same for a galaxy collision." You start again from zero. Two more days. Then "now do a supernova." Two more days. Then he sends you an updated version of the accretion disk data, and all two days of clicking are wasted because your work was in the clicking, not in the code.

Now imagine the pipeline way. You spend a week writing code that reads a data file and builds the Blender scene automatically. The first scenario takes a week — slower than the manual way. But the second scenario takes an afternoon. The third takes an hour. And when the data gets updated, you re-run one command.

Over sixteen weeks with several scenarios and inevitable data revisions, the pipeline approach wins overwhelmingly. It is also a far more impressive thing to submit: "I built a tool that converts astrophysical simulation output into interactive visualizations" is a stronger claim than "I made some videos."

---

## Part 2 — Where you are right now (an honest assessment)

I read every file in your `TorusSimulation` folder, including decompressing the `.blend` file to inspect its internal structure. Here is exactly what is there and what state it is in.

### 2.1 What works

**`step1_read_data.py`** loads the PLUTO data with PyPLUTO and prints diagnostics — grid shapes, coordinate ranges, minimum and maximum values. It works fine. It does not produce any output file; it is purely for inspection. That is fine, that is what it is for.

**`step2_plot.py`** is genuinely good work. It loads the data, converts from the spherical coordinate system the simulation used into flat 2D coordinates, and draws two side-by-side colour maps — density on the left, magnetic field strength on the right, both on a logarithmic scale. I looked at the resulting `torus_2d_plot.png` and it is correct: you can clearly see the classic kidney-shaped cross-section of a magnetized torus centred at about six units from the black hole, with the magnetic field concentrated in a tighter region inside it. This file proves your data reading and your physics understanding are sound.

### 2.2 What does not work — and this is the important part

**`torus_render.png` is a completely black image.** I checked every single pixel. There are zero non-black pixels in the entire 1920×1080 frame. Nothing was rendered.

Here is exactly why, and I want to explain it carefully because understanding this failure teaches you something fundamental about 3D graphics.

**The concept you need first: what a 3D mesh actually is.** A 3D shape in Blender (or any 3D software) is built from three levels of structure:

1. **Vertices** — individual points floating in space. Just coordinates. `(1.5, 0.0, 2.3)`.
2. **Edges** — lines connecting pairs of vertices. "Vertex 5 connects to vertex 6."
3. **Faces** (also called polygons) — flat surfaces bounded by three or more edges. "Vertices 5, 6, 7, and 8 form a square patch."

**A renderer only draws faces.** Vertices and edges are invisible in a final render — they are construction scaffolding that you see in the editing viewport, but they have no surface area, so there is nothing for light to bounce off. If your object has vertices but no faces, the render is empty. Not "faint" or "wrong-looking." Empty.

**Now look at what line 81 of `step4_blender_scene.py` does:**

```python
profile_mesh.from_pydata(profile_verts, [], [])
```

The three arguments to `from_pydata` are, in order: the list of vertices, the list of edges, and the list of faces. You passed 1,500 vertices, an **empty list of edges**, and an **empty list of faces**. So you created 1,500 disconnected points floating in space with nothing joining them.

**Then the Screw modifier could not save it.** Your plan was clever in principle: take a 2D cross-section of the torus and use Blender's Screw modifier to spin it around the vertical axis, sweeping out a full 3D donut shape. That is exactly the right idea for an axisymmetric object.

But here is how the Screw modifier actually works internally: **it sweeps edges into faces.** Take an edge, rotate it a few degrees, and the space swept between the old edge position and the new one forms a face. Repeat 128 times and you get a smooth surface of revolution.

Give it a lone vertex instead of an edge, and rotating that vertex sweeps out... a circle of vertices. A ring of points. Still no faces. So the Screw modifier ran successfully, reported no error, and produced exactly zero polygons.

I verified this directly in the saved `.blend` file. The mesh datablock inside it contains only a `position` attribute layer. There is no `.edge_verts` layer and no `.corner_vert` layer — which is Blender's internal way of saying this mesh genuinely has zero edges and zero faces.

**And then a second problem made it impossible to notice anything at all.** Line 164 sets the world background strength to `0.0`:

```python
bg.inputs['Strength'].default_value = 0.0
```

The "world" in Blender is the environment lighting — the ambient light coming from all directions. Setting it to zero means there is no ambient light whatsoever. Combined with a black background colour, this means that even if some faint geometry had existed, you would see nothing but pure black. There was no visual clue that anything was wrong.

**A third, smaller problem.** Line 200 sets:

```python
scene.render.engine = 'BLENDER_EEVEE'
```

In Blender 4.2 and later (you have Blender 5.0), the fast rendering engine was rewritten and renamed. The correct identifier is now `'BLENDER_EEVEE_NEXT'`. The old string may be silently ignored or fall back to a default. This is not what caused the black image, but it would cause confusing behaviour later.

**A fourth issue — the material lies about what it does.** The comment on line 109 says:

```python
# Uses density to drive color: core = white-yellow, edge = deep red
```

But it does not. Look at line 142: the thing driving the colour mix is a `ShaderNodeLayerWeight` node's `Facing` output. That measures the angle between the surface and the camera — it is a fake Fresnel effect, a purely visual trick. The density data never enters the shader at all. So even if the geometry had worked, the colours you saw would have carried no scientific meaning. For a project that might be shown in a planetarium, where you will tell an audience "the bright regions are dense gas," this matters a great deal.

### 2.3 The deeper problem: it is the method, not the bug

You might read the above and think "so I just need to add the edges." Unfortunately it is more than that, because of what happens at lines 60–66:

```python
np.random.seed(42)
N_PROFILE = 1500
if len(X_profile) > N_PROFILE:
    idx = np.random.choice(len(X_profile), N_PROFILE, replace=False)
```

This takes the 2D cross-section and picks 1,500 points **at random** from it. Random sampling destroys ordering. To build a surface you need to know which point connects to which — you need an ordered path around the boundary of the shape. A random scatter of points has no ordering. There is no way to connect them into a sensible outline, because "sensible" depends on an order that was thrown away.

So the fix is not to add edges to the existing points. The fix is to get an **ordered contour** in the first place — a path that traces around the boundary of the dense region in sequence, like drawing an outline without lifting your pen. Part 4 explains how.

### 2.4 The other blocker: you have only one moment in time

Your `Torus/` folder contains:

```
grid.out         38 KB   — describes the coordinate grid
vtk.out         173 B    — an index of which data dumps exist
data.0001.vtk   7.5 MB   — the actual simulation data
```

Look at `vtk.out`. It lists two entries: dump 0 at time 0.0, and dump 1 at time 5.0. Only dump 1 was actually copied to your machine.

**So you have exactly one frozen moment of the simulation.** One snapshot. A single photograph.

You cannot make a movie of something evolving from one photograph. There is no evolution recorded. This is not a software limitation you can code around — the information simply does not exist in the files you have.

This is why Part 5 (the data request) is the most urgent section in this document. Before you write a line of code, you need to ask for the full time sequence.

### 2.5 Two more things worth knowing about your data

**Your simulation is 2D, not 3D.** The `grid.out` file says:

```
# DIMENSIONS: 2
# GEOMETRY:   SPHERICAL
# X1: [ 1.000000,  20.000000], 392 point(s)
# X2: [-0.000000,  3.141593], 400 point(s)
```

This means the simulation only computed a flat slice — a 392×400 grid in radius and polar angle — and assumes everything looks identical all the way around the rotation axis. That assumption is called **axisymmetry**. It is a very common and legitimate way to make simulations cheaper.

The consequence for visualization: you can spin that slice around to make a perfectly smooth 3D donut, and it will look good. But it can never show spiral structure, turbulent eddies, lopsided jets, or any feature that varies as you go around the ring — because that information was never computed. If a 3D version of this simulation exists, getting it would be the single biggest visual upgrade available to you.

**You are missing the unit conversion files.** PLUTO simulations run in "code units" — made-up units chosen to keep the numbers convenient for the computer. To say "this gas is at 10 million Kelvin" or "this jet moves at 0.3c" you need the conversion constants, which live in two files called `pluto.ini` and `definitions.h`. Neither is in your folder. PyPLUTO can read them automatically if they are present. Without them, every number in your visualization is unlabelled and you cannot make quantitative claims.

### 2.6 Your environment has two problems too

**Your Python virtual environment is broken.** The file `.venv/pyvenv.cfg` records that it was created inside a folder called `Documents/Internship/`. That folder was later renamed to `Documents/BTP/`. Virtual environments store absolute paths internally, so `.venv/bin/pip` now points at a Python interpreter that no longer exists at that path.

The nasty part is the failure mode: `.venv/bin/pip` produces **no output and no error**. It just silently does nothing. You could spend an afternoon typing install commands and wondering why nothing changes. The fix is to delete and recreate the venv.

**ffmpeg is not installed.** ffmpeg is the tool that stitches a folder of numbered images into a video file. Your entire "make a movie" goal depends on it. It is a one-line install, but it is not there right now.

Also worth noting: Blender 5.0 is installed at `/Applications/Blender.app/Contents/MacOS/Blender` but is not on your `PATH`, so typing `blender` in a terminal does nothing. Unity 6 (version 6000.3.6f1) is installed but no project has been created yet.

### 2.7 Summary of Part 2

| Thing | Status |
|---|---|
| Data reading with PyPLUTO | ✅ Works |
| 2D matplotlib visualization | ✅ Works well, physically correct |
| Export to `.npz` | ⚠️ Works, but discards velocity, pressure, tracer, and individual magnetic field components |
| Blender 3D model | ❌ Produces zero geometry |
| Rendered image | ❌ Completely black |
| Time series for animation | ❌ Only one snapshot exists |
| 3D data | ❌ Simulation is 2D axisymmetric |
| Physical unit constants | ❌ `pluto.ini` and `definitions.h` missing |
| Python environment | ❌ Broken (folder was renamed) |
| ffmpeg | ❌ Not installed |
| Unity project | ❌ Not created yet |

None of this is discouraging — it is week zero of a sixteen-week project, and you have already proven you can read the data correctly, which is genuinely the part that trips most people up. But we need to rebuild the 3D side on a different foundation.

---

## Part 3 — The single most important idea in this plan

If you remember one thing from this document, make it this.

**There is no such thing as one pipeline that handles all astronomical data.** Your professor's wish list — satellites, gravity slingshots, interplanetary travel, the Perseverance rover, Voyager, Aditya-L1, Parker Solar Probe, galaxy collisions, neutron star mergers, gravitational waves, black hole accretion — contains two completely different kinds of data. They need two different pieces of software. Trying to write one thing that does both is how projects die.

Let me describe both clearly.

### 3.1 Pipeline A — trajectory data (things that MOVE)

**What it covers:** satellites orbiting Earth, spacecraft cruising between planets, gravity assists, the Perseverance rover driving on Mars, planets going around the Sun, moons going around planets. Every mission scenario your professor mentioned.

**What the data looks like.** It is a table. Genuinely just a table. Something like:

| Time | X (km) | Y (km) | Z (km) |
|---|---|---|---|
| 1977-09-05 00:00 | 1.4712e8 | -1.2e6 | 3.1e4 |
| 1977-09-06 00:00 | 1.4698e8 | -1.9e6 | 3.4e4 |
| ... | ... | ... | ... |

For each object, at each moment, where it is. Sometimes also its velocity and which way it is pointing. That is all.

**How big is it?** Tiny. Kilobytes to a few megabytes. Voyager 2's entire trajectory from 1977 to 2100 is a small file.

**How does it become 3D?** You already have a 3D model of the spacecraft — NASA gives them away free. You do not need to *build* anything from the data. You just need to *move* the existing model along the recorded path. In animation terms, you set **keyframes**: "at second 3 the spacecraft is here, at second 8 it is there," and the software smoothly interpolates between them.

**Difficulty:** Low. This is the easiest thing in the entire project.

**Visual payoff:** Very high. A camera mounted on Voyager 2 as it swings past Jupiter, with real dates ticking by and the real trajectory, is genuinely spectacular and immediately understandable to any audience.

**Does it work in Unity in real time?** Yes, perfectly. This is where all your interactivity will live — the time controls, the camera modes, the clicking on planets.

### 3.2 Pipeline B — field data (things that GLOW and FLOW)

**What it covers:** your accretion torus, black hole accretion disks, jets, supernova explosions, galaxy collisions, the debris from a neutron star merger.

**What the data looks like.** Imagine chopping a region of space into a giant three-dimensional chessboard of small boxes, called **cells**. Now, for every single cell, store several numbers: how dense the gas is there, how hot it is, how fast it is moving and in which direction, how strong the magnetic field is and in which direction. That is one **snapshot**. Now do that again for the next moment in time. And again. Hundreds of times.

Your torus data is exactly this — 392 × 400 cells, with nine values stored per cell (`rho, vx1, vx2, vx3, Bx1, Bx2, Bx3, prs, tr1`).

**How big is it?** Huge. Your single 2D snapshot is 7.5 MB. A modest 3D simulation with 256 cells on each side is 16.7 million cells; at nine values each in double precision that is over 1 GB *per snapshot*, and you want a hundred snapshots. Real research simulations reach terabytes.

**How does it become 3D?** This is the hard part, because there is no pre-existing model to move. You have to **construct** geometry from the numbers. There are three fundamentally different ways, and each looks completely different:

- **Volume rendering** — treat the data as glowing fog. Where the gas is dense, the fog is bright. Where it is thin, it is transparent. You see *through* the object and perceive its internal structure. **This is what real astrophysics visualizations look like** and it is the most beautiful option.
- **Isosurface** — pick a threshold value, say "density = 0.5", and build a solid shell connecting every point in space that has exactly that density. Like a contour line on a map, but in 3D. Good for showing the shape of a jet or a shock front. Bad for diffuse gas, because it turns fog into what looks like a plastic shell.
- **Particles / point cloud** — draw a tiny glowing dot for every cell above some density, coloured by its value. With millions of dots this can look genuinely volumetric, and computers are extremely good at drawing millions of dots.

**Difficulty:** High. This is the research-grade part of your project.

**Does it work in Unity in real time?** **Not directly, and this is a hard constraint you need to internalize early.** The standard file format for volume data is called OpenVDB. Blender reads it natively. **Unity cannot read it at all** — there is no official support and the community plugins are unmaintained. So getting field data into Unity requires converting it into something Unity *does* understand. Part 7.4 covers exactly how.

### 3.3 What this means for your plan

You chose spacecraft missions as your first demo. **That is the right call**, and now you can see why:

- Pipeline A data is free, public, tiny, and available today. No waiting on your professor.
- It gives you an impressive, working, genuinely interactive result within five weeks.
- It builds all the shared infrastructure — the config system, the Blender scene builder, the camera rigs, the video encoder, the Unity project — that Pipeline B will reuse.
- If Pipeline B turns out to be harder than expected (it might), you still have a complete, defensible project.

So: **build Pipeline A first and completely. Then bolt Pipeline B onto it as spectacular set pieces inside the same application.**

---

## Part 4 — The complete flow, explained step by step

This section walks through what actually happens, from a data file on disk to a person in a headset. Read it once to get the shape; you do not need to memorize it.

### 4.1 The overall shape

```
   RAW DATA                 NORMALIZE              BUILD               OUTPUT
   ────────                 ─────────              ─────               ──────
  PLUTO .vtk/.dbl  ┐                          ┌─→ volume files  ─┐
  Gadget HDF5      ├─→  readers/  ─→  SCENE  ─┼─→ mesh sequence ─┼─→ Blender  ─→ MP4
  SPICE .bsp       │    (plugins)     SPEC    ├─→ keyframes     ─┤   (headless)  dome master
  CSV / HORIZONS   │                  (JSON)  ├─→ point cloud   ─┤               360° video
  GW waveform      ┘                          └─→ curves        ─┘
                                                       │
                                                       └──────────────→ Unity assets
                                                                        (.glb, .pcache,
                                                                         Texture3D, JSON)
```

The key design idea is the **SceneSpec** in the middle. Everything to the left of it is data-format-specific. Everything to the right of it is data-format-agnostic. They only talk to each other through that one well-defined structure.

**Why this matters practically:** adding support for a new kind of data means writing **one new reader file**. You do not touch the Blender code, the camera code, the rendering code, or the Unity exporter. That is what makes this a reusable tool rather than a pile of one-off scripts. It is also directly the answer if your professor asks "is this general, or does it only work for the torus?"

### 4.2 Step 1 — Reading the raw data

Each data source gets its own small Python file whose only job is to open that format and return a standard Python object. Every reader returns the same shape of thing, so nothing downstream cares where the data came from.

For PLUTO files, PyPLUTO does the heavy lifting. One useful detail: PyPLUTO returns **memory-mapped arrays** (`np.memmap`), not normal arrays. A memory-mapped array behaves like a NumPy array but does not load the whole file into RAM — it reads from disk only the parts you actually touch. This means you can open a 5 GB snapshot and slice out a small region without needing 5 GB of memory. Very useful when the real data arrives.

For spacecraft trajectories, we use `spiceypy`, which is NASA's own toolkit exposed to Python. You load some data files (called kernels), then ask questions like "where was Voyager 2, relative to the Sun, on 9 July 1979?" and get back a position vector.

### 4.3 Step 2 — Normalizing into a common form

This layer converts whatever the reader produced into a standard internal representation, handling three annoying-but-essential things:

**Coordinate systems.** Your torus data uses spherical coordinates — position is described by distance from centre (R), angle down from the pole (θ), and angle around (φ). 3D software wants ordinary x, y, z. The conversion is:

```
x = R · sin(θ) · cos(φ)
y = R · sin(θ) · sin(φ)
z = R · cos(θ)
```

For 3D volume data this is more involved than a formula: the simulation's grid is spherical (cells are curved wedges that get bigger further out), but a volume file needs a uniform cubic grid. So you have to **resample** — create the cubic grid you want, and for each cube centre, work out which spherical cell it falls in and interpolate the value. `scipy.interpolate.RegularGridInterpolator` does this.

> ⚠️ **You have to write this yourself.** PyPLUTO has a function called `reshape_cartesian` that sounds like it does this, but its own source code says *"At the current stage, the transformation is only in 2D."* Its docstring examples are copy-pasted from a different function and are wrong. Read the code, not the docs.

**Units.** Simulations use code units. Real numbers need real units. This layer applies the conversion constants from `definitions.h` and uses `astropy.units` to keep track. This sounds bureaucratic but it prevents the single most common class of bug in scientific visualization: being wrong by a factor of a million and not noticing.

**Scale for rendering.** The solar system is about 10¹³ metres across. A spacecraft is about 10 metres. You cannot put both in one scene at true scale — the numbers overflow the precision that graphics hardware uses, and the spacecraft would be far smaller than a single pixel. So this layer applies deliberate, documented scale transformations. Part 7.5 explains this properly.

### 4.4 Step 3 — The SceneSpec

The SceneSpec is a plain data structure (validated with `pydantic`, written as JSON) that describes the scene in a rendering-agnostic way. Roughly:

- **Objects** — what exists. A planet with a texture and a radius. A spacecraft with a model file. A volume with a density grid.
- **Animation** — how each object's position, rotation, and scale change over time.
- **Cameras** — where the viewer is, what they are looking at, and how that changes.
- **Materials** — how each object should look. Which data value drives the colour, which colour map, how bright.
- **Annotations** — text labels and their timing.
- **Render settings** — resolution, frame rate, engine, output paths.

Its whole purpose is to be the contract between "understanding data" and "making pictures." The Blender code never reads a PLUTO file; it only reads a SceneSpec.

### 4.5 Step 4 — Building geometry

This is where field data becomes something visible. Three techniques, and you will use all three for different things.

**Technique 1: Ordered contour + revolve (fixes your current torus).**

For 2D axisymmetric data like yours, this is the correct approach. The steps:

1. Take the density field on its structured (R, θ) grid.
2. Use `skimage.measure.find_contours(density, level)` to extract the boundary at a chosen density value. Crucially, this returns an **ordered** list of points — a path you could trace with a pen without lifting it. This is the exact thing that the random subsampling in your current code destroyed.
3. Build a mesh with **real edges** connecting consecutive points: `from_pydata(verts, edges, [])` where `edges = [(0,1), (1,2), (2,3), ...]`.
4. *Now* apply the Screw modifier. It has edges to sweep, so it produces actual faces, and you get a real 3D torus.

That is the minimal fix. One extra line to build the edge list, plus using an ordered contour instead of a random sample.

**Technique 2: Volume rendering (what you actually want it to look like).**

Instead of extracting one surface, convert the whole density field into a 3D grid of glowing fog. Steps:

1. Build a uniform 3D cubic grid, say 256×256×256.
2. For each voxel, compute its (R, θ) position and interpolate the density from the simulation grid. For axisymmetric data, φ does not matter — every angle gets the same value, which is what "revolving" means for a volume.
3. Write that array to an **OpenVDB** file. OpenVDB is the standard format for volume data in visual effects. The Python call is essentially `grid.copyFromArray(my_numpy_array)`.
4. In Blender, create a Volume object pointing at that file and give it a **Principled Volume** shader.
5. For animation, write one `.vdb` per timestep with numbered filenames (`rho_0001.vdb`, `rho_0002.vdb`, …) and set `is_sequence = True`. Blender plays through them automatically.

**Technique 3: Isosurface via marching cubes.**

For genuinely 3D data, `skimage.measure.marching_cubes` takes a 3D array and a threshold and returns vertices and faces of the surface at that value. Straightforward, and useful for jets and shock fronts where there is a real boundary.

### 4.6 Step 5 — Making it glow like plasma

Getting glowing gas to look right is mostly about the shader, and there is a nice trick here.

**The basic approach:** Blender's **Principled Volume** shader automatically looks for grids with specific names inside your `.vdb` file: `density`, `color`, and `temperature`. Name your grids accordingly and it just works. You feed the density into the shader's Emission Strength through a **Color Ramp** node using a real scientific colour map (inferno or viridis), so brightness and colour genuinely correspond to the data.

**The better approach — free physical realism.** PLUTO gives you both density (`rho`) and pressure (`prs`). Temperature in code units is simply `T = prs / rho`. So write a **second** grid into your VDB file, literally named `temperature`, and set the shader's **Blackbody Intensity** to 1. Blender then computes the actual blackbody radiation colour for that temperature — the same physics that makes hot iron glow orange and hotter iron glow white.

This is much more defensible in a report and in a planetarium. Instead of "I picked orange because it looked nice," you can say "the colours are physically computed blackbody emission from the simulated gas temperature." It costs about five extra lines of code.

> This also fixes the honesty problem in your current shader (Part 2.2), where the comment claimed density drove the colour but a view-angle trick actually did.

### 4.7 Step 6 — Cameras

Camera work is what separates a diagram from an experience. Four rigs to build:

- **Onboard / POV** — the camera is attached to the spacecraft, looking along its direction of travel. This is the "you are the pilot" view your professor described.
- **Chase** — floating a fixed distance behind and slightly above, following smoothly. Best for actually understanding a trajectory, because you see both the craft and where it is going.
- **Orbit** — circling a fixed point. Best for examining an object like the torus.
- **Dome** — a special 180° fisheye camera for planetarium output. Covered in Part 8.

One practical detail: use a "look-at" constraint (`TRACK_TO` in Blender) rather than computing rotations by hand. You place an invisible target object and tell the camera to always point at it; then you only animate positions, never rotations. Your existing script already does this correctly at line 189.

**Time warping.** Real missions are boring for 99% of their duration. Voyager 2 took twelve years to reach Neptune, and almost all of that was empty cruising. A real-time animation would be unwatchable. So the pipeline needs a **time-warp curve** — a function mapping video time to simulation time that runs at months-per-second during cruise and slows to minutes-per-second during a flyby. This is not cheating; every documentary does it. Just put the date on screen so the audience knows.

### 4.8 Step 7 — Rendering

Blender runs from the command line with no window at all:

```bash
blender --background scene.blend --python build.py -- --config scenes/voyager.yaml
```

Rendering an animation:

```bash
blender -b scene.blend -o //frames/f_#### -F PNG -x 1 -s 1 -e 300 -a
```

The `####` becomes a zero-padded frame number, `-s`/`-e` set the frame range, and `-a` means render the animation.

**Always render numbered PNG images, never straight to video.** Three reasons: if it crashes at frame 250 you restart from 250 instead of from 1; you can split the frame range across multiple machines; and you can re-encode to a different video format later without re-rendering anything.

Two flags worth adding:
- `--python-exit-code 1` makes Blender exit with an error code if your script throws. Without it, a crashed script produces a silent success — which is close to the failure mode you already hit.
- `--cycles-device METAL` uses your Mac's GPU.

**Which render engine?** Blender has two. **EEVEE** is fast and approximate — use it for previewing while you iterate. **Cycles** is slow and physically accurate — use it for final renders, and you have no choice for volumes, because EEVEE's volumetrics are a rough screen-space approximation with no proper self-shadowing, so plasma looks flat and wrong.

### 4.9 Step 8 — Video

`ffmpeg` turns the numbered PNGs into a video:

```bash
ffmpeg -framerate 30 -i out/frames/f_%04d.png -c:v libx264 -pix_fmt yuv420p out/voyager.mp4
```

The `-pix_fmt yuv420p` flag looks cryptic but is important — without it, some players and PowerPoint will refuse to open the file.

### 4.10 Step 9 — Into Unity

Two different things cross this boundary, and it is important to keep them separate.

**Static 3D models** (spacecraft, planets) → exported as `.glb` files. GLB packs the mesh, materials, and textures into one file, and Unity's official `com.unity.cloud.gltfast` package imports it cleanly.

**Trajectories** → exported as plain **JSON or CSV**, not as baked animation.

That second point is the most important Unity design decision in the project, so let me explain it.

You *could* bake the spacecraft's motion into an animation clip in Blender and export that. It would work — press play and the spacecraft moves. But it would be nearly impossible to make interactive. Baked animation does not scrub backwards smoothly, does not speed up cleanly, does not let you type in a date and jump there, and cannot switch reference frames.

Instead, export the trajectory as data — a list of times and positions — and write a small C# script in Unity that reads it and positions the spacecraft each frame based on a `currentTime` variable. Now every interaction becomes trivial: rewind is `currentTime -= dt`, speed control is a multiplier, jump-to-date sets it directly, and switching reference frames is a subtraction.

**Getting the axes right.** Blender and Unity disagree about which way is up. Blender is Z-up and right-handed; Unity is Y-up and left-handed. If you ignore this, your scene arrives rotated 90° and mirrored.

The reliable procedure:
1. In Blender, select everything and press `Ctrl+A` → **All Transforms**.
2. Export FBX with **Apply Transform** checked, **Forward = -Z**, **Up = Y**.
3. Test with a deliberately asymmetric object — an "L" shape — before exporting anything real, so you can see immediately if it came through mirrored.

**Cameras are a special case.** Blender cameras look down their local **−Z** axis; Unity cameras look down **+Z**. A directly imported camera ends up backwards. The clean workaround: in Blender, transfer the camera's motion onto an **Empty** (a null object), export that, and in Unity make a real Unity camera a child of the imported Empty. The wrapper absorbs the convention difference and you never think about it again.

But honestly, for the interactive build you should mostly **rebuild camera behaviour natively in Unity** using Cinemachine. Your deliverable is interactive, so a baked camera path is the wrong artifact — and in VR the user's head *is* the camera. Use Blender camera moves as previz and for the offline dome render.

### 4.11 Step 10 — VR

Unity's XR system handles the headset. You install the **OpenXR Plugin** and the **XR Interaction Toolkit**, replace the normal camera with an `XR Origin` rig, and most things just work — head tracking, controller tracking, stereo rendering.

The work is in designing interactions that are comfortable and meaningful. That is Part 10, Phase 5.

---

## Part 5 — What data we need, and exactly what to ask your professor for

This is the section to act on first. Data has lead time; code does not.

### 5.1 Four things every dataset needs

Whatever the scenario, if any of these four is missing, the data cannot be used. Say this explicitly when you ask.

**1. The full time series, not one snapshot.** For a 10-second video at 30 fps you need 300 frames. You do not need 300 data dumps — you can smoothly interpolate between them — but you need enough to capture the real motion. **40 to 150 dumps is usually plenty.** You currently have one, which is why no movie exists.

**2. The grid / coordinate description.** For PLUTO this is `grid.out`. The data files are just long lists of numbers; the grid file says where in space each number belongs. Without it the data is meaningless.

**3. The physical units.** For PLUTO, `definitions.h` contains `UNIT_DENSITY`, `UNIT_LENGTH`, and `UNIT_VELOCITY`, and `pluto.ini` contains the run configuration. Without these you cannot label anything or state any real physical quantity — which matters a lot if this ends up in a planetarium where you will be making factual claims to an audience.

**4. One sentence of physical context.** "This is a magnetized torus around a 10-solar-mass black hole; the magnetorotational instability kicks in around t=20 and the jet launches at t≈40." You need this to know where to point the camera, when to slow down, and what to write in the narration. A dataset with no story is just numbers.

### 5.2 Scenario A — spacecraft missions (your first demo)

**Good news: you need almost nothing from your professor here.** Nearly all of it is public.

| What | Format | Where | Ask professor? |
|---|---|---|---|
| Planets, moons, barycentres | SPICE `de440.bsp` | `naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/` | **No — free** |
| Leap seconds, body constants | `naif0012.tls`, `pck00011.tpc` | `.../generic_kernels/lsk/` and `/pck/` | **No — free** |
| **Voyager 1 & 2** | SPK `.bsp` | `naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/` | **No — free.** The 2022 update extends coverage to year 2100, so you can show where Voyager is *today*. |
| **Perseverance** | PDS4 bundle (SPK + CK + FK + SCLK) | `naif.jpl.nasa.gov/pub/naif/pds/pds4/mars2020/mars2020_spice/` | **No — free.** Note the surface driving is in a separate rover-frame SPK; you need the frames kernel too, not just the cruise trajectory. |
| **Parker Solar Probe** | SPK | ⚠️ **Not on NAIF.** Johns Hopkins APL hosts it: `sppgway.jhuapl.edu/MOC/reconstructed_ephemeris/` | **No — free**, just a different server. Worth knowing so you don't waste an hour looking on the NASA site. |
| **Aditya-L1** | ⭐ **ISRO does publish SPICE kernels** — SPK and CK, with daily-updating files | ISSDC **PRADAN** portal: `pradan.issdc.gov.in/al1/` — **registration required** | 🟡 **Ask for help with institutional registration.** This is not a private-data request; the data is published, it just sits behind a login. |
| Fallback for anything | CSV from **JPL HORIZONS** | `ssd.jpl.nasa.gov/api/horizons.api` | **No — free.** One HTTP request, no kernel management. |
| Spacecraft 3D models | `.glb` / `.obj` | NASA 3D Resources | **No — free** |
| Planet textures | 8k–16k JPG | NASA SVS, USGS Astrogeology, Solar System Scope | **No — free** |
| Mars terrain (rover scene) | HiRISE DTM `.IMG` + orthoimage | uahirise.org | **No — free**, but large |

**A useful concept: SPICE.** SPICE is NASA's system for answering "where was object X, pointing which way, at time T, in reference frame F." A **kernel** is one data file. There are several types:

- **SPK** (`.bsp`) — positions and velocities over time. *This is the trajectory data.*
- **CK** (`.bc`) — orientation (which way the spacecraft was pointing).
- **PCK** (`.tpc`) — planetary constants: radii, pole directions, rotation rates.
- **LSK** (`.tls`) — leap seconds. Needed for any conversion between UTC and internal time.
- **FK** (`.tf`) — reference frame definitions.
- **Meta-kernel** (`.tm`) — a text file listing other kernels, so you load one file and get all of them.

In Python, via `spiceypy`:

```python
import spiceypy as spice
spice.furnsh("voyager.tm")
et = spice.str2et("1979-07-09T00:00:00")
pos, lt = spice.spkpos("VOYAGER 2", et, "ECLIPJ2000", "NONE", "SUN")
```

**HORIZONS versus SPICE — which to use.** HORIZONS is a NASA web service that gives the same positions as a simple CSV with no kernels to manage. **Start with HORIZONS** — it is one HTTP call and you will get results in an hour. Move to SPICE when you need orientation data, body-fixed frames, rover surface tracks, or a mission HORIZONS does not carry (like Aditya-L1).

### 5.3 Scenario B — the accretion torus (extending your current work)

This is where you genuinely need your professor. Ask for:

**The full dump sequence.** At least 60 outputs, evenly spaced, covering something interesting — the growth of an instability, or a jet launching. One snapshot cannot become a movie.

**`pluto.ini` and `definitions.h`.** You have neither. PyPLUTO reads them automatically for unit conversion.

**A 3D version of the run, if one exists.** Your data is 2D axisymmetric. A 3D (R, θ, φ) run would let you show spiral structure, turbulence, and asymmetric jets. **This is the single biggest visual upgrade available to you.**

**Format preference:** `.dbl` (double precision) or `.vtk` are best. `.dbl.h5` (HDF5) is ideal if the run is large. Avoid `.flt` if `.dbl` exists.

**All the variables**, not a subset: `rho, prs, vx1, vx2, vx3, Bx1, Bx2, Bx3, tr1`.

**⭐ The best possible outcome: ask for PLUTO itself plus the problem setup.** PLUTO is free for academics but needs registration. If you can run it yourself, you choose your own output cadence, you can re-run at 3D, and you stop being blocked on anyone. Given a 16-week schedule, being independent for data is worth a lot. Ask for this explicitly.

### 5.4 Scenario C — galaxy collision

| Option | Format | Notes |
|---|---|---|
| Best | **Gadget-2/4 HDF5** snapshots | Standard format, `h5py` reads it easily. Need positions, masses, and particle type (gas / star / dark matter) per snapshot |
| Also fine | Plain CSV or binary: `x, y, z, vx, vy, vz, mass, type, id` per particle | Genuinely fine — do not let anyone tell you it needs to be fancy |
| Free fallback | Illustris/TNG public API, or run a toy N-body simulation yourself | If nothing is available, a self-run collision is honest and looks great |

**Say this explicitly:** 10⁵ to 10⁶ particles is plenty for visuals; ask him **not** to send 10⁸. More particles past a certain point add rendering cost and no visible detail. And 100–300 snapshots.

### 5.5 Scenario D — neutron star merger and gravitational waves

Split this into two separate asks, because they are completely different data.

**Part 1: the waveform (the ripple spreading outward).** A simple time series of the two gravitational wave polarizations, `h₊(t)` and `h×(t)`, or the spherical harmonic modes. **This is free and public** — the SXS waveform catalog, or real LIGO detections from GWOSC (you could visualize the actual GW150914 signal, the first ever detected).

**This has the best value-to-effort ratio in the entire project.** The data is a two-column text file. The physics of how the wave propagates is a simple formula. And the result — space itself rippling outward from a collision — is genuinely stunning and needs no external data at all. If everything else falls through, build this.

**Part 2: the merger hydrodynamics (the stars tearing apart).** This is numerical relativity data, usually Einstein Toolkit HDF5 with adaptive mesh refinement. ⚠️ **It is terabytes and hard to obtain.** Ask, but do not build your schedule around it. Phrase it as: *"Do you have any NR merger data, or a contact who does? Even a downsampled rest-mass density on a uniform grid would work."*

### 5.6 Scenario E — black hole

| Option | Notes |
|---|---|
| GRMHD simulation dumps | From HARM, BHAC, KORAL, or Athena++. Ask if any exist. |
| Pre-made ray-traced images | From `ipole` or `RAPTOR`. Much easier to use than raw data. |
| ⭐ **Compute it yourself** | The Schwarzschild/Kerr shadow can be computed directly by tracing light rays through curved spacetime. **No data needed.** |

**Reality check worth stating plainly:** the famous black hole shadow image is mostly a *shader and ray-tracing* problem, not a *data* problem. You can produce an excellent, physically correct one with pure computation. Do not block on getting GRMHD data.

### 5.7 Non-data things to ask for

| Item | Why | Priority |
|---|---|---|
| **NVIDIA Windows/Linux workstation** | See below — this is more urgent than it sounds | 🔴 **Needed by ~month 2** |
| **VR headset — recommend Meta Quest 3** | He already offered. Standalone, cheap, best-supported, easy to carry to a demo | 🔴 Order by month 2 |
| **Planetarium technical spec** | Rendering in the wrong format wastes days of GPU time. Costs nothing to ask now | 🔴 **Ask immediately** |
| **A rehearsal slot at the planetarium** | Content that is fine on a monitor can be nauseating on a dome | 🟡 Medium |
| 1–2 TB external SSD | Simulation dumps and frame sequences get large fast | 🟡 Medium |
| PLUTO source + problem setup | Makes you independent for data | 🟡 Medium but high leverage |
| Help registering on ISSDC PRADAN | For Aditya-L1 | 🟡 Medium |

**Why the NVIDIA machine is more urgent than it looks.** You can build a Quest app on an Apple Silicon Mac and install it over USB — that genuinely works. But **Quest Link (the feature that lets you press Play in the editor and instantly see the result in the headset) is Windows-only.** On a Mac, every single change requires a full Android build and install, which takes minutes rather than seconds. Over a two-week VR phase, that difference costs you days. **Ask in week 1, not week 12.**

**On software cost:** everything in this plan is free and open source — Blender, Unity Personal, Python, OpenVDB, NASA SPICE, ffmpeg. Mention this; it is a good look. The one paid item worth considering is Unity's **Space Graphics Toolkit** (~₹5–8k), which handles large-scale coordinates and planetary rendering and could save two weeks on the hardest engineering problem in the project. Since he said budget is not a constraint, it is worth raising as an option.

---

## Part 6 — How the code will be organized

### 6.1 Folder layout

```
BTP/
├── astroviz/                    ← the Python package (the tool itself)
│   ├── readers/                 ← ONE FILE PER DATA SOURCE
│   │   ├── base.py              ← defines what every reader must return
│   │   ├── pluto.py             ← wraps PyPLUTO: .dbl / .flt / .vtk / .h5
│   │   ├── spice.py             ← spiceypy → trajectories
│   │   ├── horizons.py          ← JPL HORIZONS CSV
│   │   ├── gadget.py            ← N-body particle HDF5
│   │   └── waveform.py          ← gravitational wave strain
│   ├── fields/                  ← grid data → 3D geometry
│   │   ├── resample.py          ← spherical/polar → uniform cartesian
│   │   ├── revolve.py           ← 2D axisymmetric → full 3D
│   │   ├── vdb.py               ← numpy → OpenVDB sequence
│   │   └── isosurface.py        ← marching cubes → mesh sequence
│   ├── particles/
│   │   └── pcache.py            ← particles → Unity point cache
│   ├── trajectory/
│   │   ├── frames.py            ← reference frames, units, scaling
│   │   └── keyframes.py         ← positions → animation curves
│   ├── scene/
│   │   ├── spec.py              ← the SceneSpec schema
│   │   └── cameras.py           ← POV / chase / orbit / dome rigs
│   ├── blender/                 ← the ONLY place that imports bpy
│   │   ├── build.py             ← SceneSpec → .blend
│   │   ├── materials.py         ← plasma, planet, starfield shaders
│   │   ├── render.py            ← animation, dome master, 360°
│   │   └── export.py            ← glb / fbx out
│   ├── video/encode.py          ← ffmpeg wrapper
│   └── cli.py                   ← `astroviz build scenes/voyager.yaml`
├── scenes/                      ← ONE YAML PER MOVIE — your real interface
├── data/            (gitignored — raw simulation data)
├── cache/           (gitignored — .vdb, resampled grids)
├── out/             (gitignored — frames, mp4, .blend, .glb)
├── unity/AstroViz/              ← the Unity project
├── tests/
├── docs/
└── legacy/TorusSimulation/      ← your current work, kept for the report
```

**One rule worth enforcing strictly:** only files inside `astroviz/blender/` may `import bpy`. Everything else is plain Python that you can test normally, without launching Blender. This makes the codebase far easier to debug — you can unit-test your physics and data handling in milliseconds instead of waiting for Blender to start.

### 6.2 What a scene file looks like

This is the thing you will actually edit day to day. Everything else is machinery underneath it.

```yaml
name: voyager_grand_tour
duration_s: 90
fps: 30

time:
  start: "1977-09-05"
  end:   "1990-01-01"
  mode: adaptive          # slow near flybys, fast during cruise

world:
  scale: SOLAR_SYSTEM     # 1 Blender unit = 1 million km
  origin: SUN

bodies:
  - {id: SUN,     type: star,   texture: sun_8k.jpg,     radius_km: 696340}
  - {id: JUPITER, type: planet, texture: jupiter_8k.jpg, radius_km: 71492}
  - {id: SATURN,  type: planet, texture: saturn_8k.jpg,  rings: saturn_rings.png}

trajectories:
  - source: spice
    kernels: [de440.bsp, voyager2.bsp, naif0012.tls]
    target: VOYAGER_2
    observer: SUN
    frame: ECLIPJ2000
    model: voyager.glb
    trail: {length_days: 400, color: "#4FC3F7"}

cameras:
  - {name: pov,   type: onboard, parent: VOYAGER_2, look_at: velocity}
  - {name: chase, type: chase,   parent: VOYAGER_2, distance: 40, height: 12}
  - {name: dome,  type: fisheye_equidistant, fov: 180, parent: VOYAGER_2}

annotations:
  - {t: "1979-07-09", text: "Jupiter flyby — gravity assist", duration_s: 4}

render:
  engine: CYCLES
  resolution: [1920, 1080]
  dome_master: [4096, 4096]

export:
  unity: {format: glb, trajectory_as: json}
```

**This file is your strongest single artifact.** When your professor asks "is this general?", you show him this and say: give me a data file and thirty lines of configuration, and you get a movie. Adding a new scenario means writing one of these, not writing code.

---

## Part 7 — Every tool we will use, and why

### 7.1 Python libraries

**PyPLUTO** (`py-pluto`, version 1.1.5 — already installed). Reads every PLUTO output format. Returns memory-mapped arrays so huge files do not exhaust RAM. Beyond loading, it has genuinely useful utilities you should reuse rather than reimplement:

- `cartesian_vector("B")` — converts vector components from spherical to Cartesian
- `find_fieldlines(...)` — traces magnetic field lines through the data (great visual)
- `gradient()`, `divergence()`, `curl()` — geometry-aware vector calculus
- `LoadPart` — reads particle data
- Automatic parsing of `pluto.ini` and `definitions.h` for unit constants

Your existing `step2_plot.py` is derived from PyPLUTO's own `Examples/test08_torus.py`, which is worth re-reading — it uses the vector machinery that your `step3` export currently throws away.

**`bpy`** (`pip install bpy`, version 5.2.0). ⭐ **This is a small revelation for your project.** `bpy` is Blender packaged as an ordinary Python library. And version 5.2.0 requires exactly Python 3.13 — which is what you already have (3.13.12).

Why this matters: right now you have a four-step pipeline where steps 1–3 run in your Python environment (which has PyPLUTO) and step 4 runs inside Blender (which does not), with a `.npz` file passed between them as a bridge. That split is why your export loses data — you had to decide in advance what to save.

With `pip install bpy`, **one single script can `import pyPLUTO`, `import numpy`, and `import bpy` together.** No handoff file. No information loss. No two-interpreter debugging.

**`openvdb`** — accessed through Blender's bundled copy:

```python
import bpy
bpy.utils.expose_bundled_modules()
import openvdb
```

That first call adds Blender's bundled visual-effects libraries to your Python path. This is the reliable way to get OpenVDB, and it guarantees the version matches what Blender will read.

> ⚠️ **Do not `pip install pyopenvdb`.** That PyPI package is unofficial, last updated in 2020, and ships only a Linux/Python-3.7 wheel. It will not work on your Mac. This is a well-known time sink.

> ⚠️ Verify on day one that `openvdb.FloatGrid().copyFromArray` exists. NumPy support in OpenVDB is a compile-time option that is occasionally off. Everything volumetric depends on it.

**`spiceypy`** (version 8.2.0). NASA's SPICE toolkit for Python. Apple Silicon wheels exist.

**`astroquery`** — specifically `astroquery.jplhorizons`, the easy no-kernels route to positions.

**`scipy`** — `RegularGridInterpolator` for the spherical→cartesian resampling you must write yourself.

**`scikit-image`** (already installed) — `measure.find_contours` (2D ordered contours — this fixes your black render) and `measure.marching_cubes` (3D isosurfaces).

**`astropy`** — units, constants, time, coordinate frames. Prevents factor-of-a-million errors.

**`h5py`** (already installed) — Gadget and Einstein Toolkit HDF5.

**`pydantic` + `pyyaml`** — validates the scene YAML so a typo produces a clear error message instead of a black frame.

**`ffmpeg`** — ⚠️ not installed. Install via Homebrew. Without it there is no video.

### 7.2 Blender

You have **Blender 5.0.0** installed but not on your `PATH`.

> 💡 **Recommendation: also install Blender 4.2 LTS and develop against that.** LTS means Long Term Support — a stable API that will not change under you. Practically every tutorial, StackExchange answer, and YouTube video you find targets 4.x. Your existing script already carries two Blender-5 workarounds (the skipped compositor bloom, and the `BLENDER_EEVEE` rename). As a beginner, fighting a brand-new version while also learning the software is an unnecessary difficulty. Keep 5.0 installed, but learn on 4.2.

**Playing a VDB sequence** — set on the Volume datablock directly, no operator needed:

```python
vol = bpy.data.volumes.new("plasma")
vol.filepath = "//cache/vdb/rho_0001.vdb"
vol.is_sequence = True         # files must be numbered: rho_0001, rho_0002, ...
vol.frame_start = 1
vol.frame_duration = 240
vol.sequence_mode = 'CLIP'     # or EXTEND / REPEAT / PING_PONG
```

> ⚠️ **Memory warning.** OpenVDB is a *sparse* format — empty space costs nothing on disk. But **Blender expands it to dense when rendering.** A 512³ float grid is roughly 512 MB *per frame* in memory. Start at 128³. Move to 256³ only once it renders in acceptable time. Always crop tightly around the interesting region rather than storing a large empty box.

### 7.3 Unity

**Unity 6 (6000.3.6f1)** is already installed. Create the project with the **3D (URP)** template.

**On the render pipeline choice.** Unity has three: Built-in, URP (Universal Render Pipeline), and HDRP (High Definition Render Pipeline). This used to be a real decision. It is not any more — Unity published its 2026 strategy and:

- **Built-in is officially deprecated** starting Unity 6.5 and "strictly not recommended for any new titles."
- **HDRP is in maintenance mode** — "no new features are planned for HDRP."
- **URP is the sole investment target.**

It is also forced by your VR goal: **HDRP cannot ship to standalone Quest at all.**

Honest note: HDRP genuinely looks better for space out of the box — its Local Volumetric Fog with a 3D density mask is almost a purpose-built nebula tool requiring no shader code. But it is a dead end for you. **Choose URP on day one and never switch.** Changing pipeline mid-project means rebuilding every material.

### 7.4 The hard truth about volumetric data in Unity

**Unity cannot read `.vdb` files. There is no official support, and the community plugins are unmaintained.** This is an architectural constraint, not something a package install fixes. Plan around it from the start.

Your four options, in the order you should try them:

**Option 1 — VFX Graph point cloud. ⭐ Start here.** Unity's VFX Graph is a GPU particle system that can draw millions of points. Take every cell above a density threshold, emit a glowing particle coloured by the data value. With enough particles it reads as genuinely volumetric, performance is excellent, and it is the only option that comfortably survives the trip to a standalone Quest headset.

> ⚠️ **A trap that catches everyone: a `.pcache` file is a *static snapshot*, not an animation.** It stores one set of points, full stop. For time-varying data you either write one pcache per timestep and swap between them, or — the standard, performant approach — **bake positions-over-time into a "position map" texture** where the horizontal axis is particle index and the vertical axis is time, then sample it in the graph. **Design for this from day one.** Discovering it in week 14 would be genuinely painful.

> ⚠️ **VFX Graph on Quest requires Vulkan** (not OpenGL ES) and compute shader support. Unity's docs have long carried a "not out of preview for mobile / not out of preview for URP" caveat. Quest 3 does support Vulkan, so it should work — **but test it on the actual headset in week 6, not week 14.** This is the single riskiest unproven assumption in the plan, and it costs one afternoon to verify. Fallback if it misbehaves: a custom `DrawMeshInstancedIndirect` point-sprite shader — more code, but bulletproof.

**Option 2 — 3D texture and raymarching.** Store the density field as a `Texture3D` and write a shader that steps a ray through it accumulating brightness. This is the most correct and controllable approach.

Do not write the shader from scratch. Adapt **`github.com/mlavik1/UnityVolumeRendering`** — MIT licensed, supports Unity 6, works with URP, confirmed working in VR, and includes proper transfer functions (the mapping from data value to colour and opacity). It imports `raw`, `NRRD`, and `NIFTI` formats — **not VDB** — so your pipeline should export one of those in addition to VDB. Memory is the constraint: a 256³ float grid is about 64 MB per frame, so downsample and use 8-bit or half-precision.

**Option 3 — Isosurface mesh sequence.** Marching cubes per timestep, carried into Unity via Alembic (`.abc`), a format designed for per-frame changing geometry. Cheap to render and robust, but it looks like a solid shell rather than glowing gas.

> ⚠️ **The Unity Alembic package supports Windows, macOS, and Linux desktop only — no Android.** Meta Quest standalone *is* Android. So anything you carry via Alembic cannot ship in your Quest build. Fine for the desktop version and the dome render; a dead end for the headset.

**Option 4 — Pre-rendered video. Your guaranteed fallback.** Render the volumetric sequence in Blender to a video, then play that video inside Unity on a screen or as a 360° skybox, with the interactive trajectory layer in front of it. Zero interactivity in the volume itself, but the visuals are perfect and **it always works.**

**Decision: primary is VFX Graph points, fallback is pre-rendered video. Do not start with Alembic.**

### 7.5 The large-coordinates problem in Unity

Unity stores every object's position as a **32-bit float**, always. There is no double-precision option.

32-bit floats have about 7 significant decimal digits. That is fine near the origin, but at a distance of 10,000 units the smallest representable step is already about a millimetre, and it gets worse linearly. In practice:

- Under 1,000 units from origin: safe
- 1,000 – 5,000 units: slight jitter in precise operations
- Above 10,000 units: **visible shaking of objects and camera**

One astronomical unit is 1.5 × 10¹¹ metres. If you use metres at 1:1 scale you blow through this immediately, and your beautiful Voyager flyby vibrates like a bad video.

Four standard solutions, which you will combine:

**1. Floating origin.** When the camera moves more than some distance from (0,0,0), translate *the entire world* so the camera returns to the origin. The camera never actually moves far; the universe slides past it. This is the most common fix. Open-source implementations: `qkmaxware/Spaceworks`, `simonwittber/scaled-origin`, `FriendsOfSpatial/FloatingOrigin`.

**2. Camera-relative rendering.** Keep the authoritative positions in C# `double` variables, and each frame compute `(float)(worldPos - cameraPos)` for display only. More correct, more plumbing.

**3. Scaled space / nested scale layers.** The approach used by Kerbal Space Program and NASA's Eyes. One camera renders nearby objects at real scale; a second camera renders a uniformly shrunk copy of the whole solar system behind it; the two are composited. This is also how you solve the "spacecraft is sub-pixel next to Jupiter" problem.

**4. Just do not use metres.** Choose units where the interesting scene lands in the 1–1000 range. Often the pragmatic answer.

**A related, unavoidable point about honesty.** If you draw the solar system to true scale, the planets are invisible dots. Every planetarium and every textbook exaggerates planet sizes relative to orbital distances. You should too — **but put a visible "sizes exaggerated, distances to scale" note on screen**, and ideally offer a toggle so the viewer can see the true-scale version and appreciate just how empty space is. That toggle is a genuinely great teaching moment and costs almost nothing to build.

### 7.6 Blender → Unity file formats, compared

| | **FBX** | **glTF / GLB** | **Alembic (.abc)** |
|---|---|---|---|
| Unity imports natively? | ✅ Yes, built in | Needs `com.unity.cloud.gltfast` (official Unity package) | Needs `com.unity.formats.alembic` |
| Meshes | ✅ | ✅ | ✅ |
| Materials | ✅ Basic | ✅ **Best** — PBR maps 1:1, textures packed inside `.glb` | ❌ **Not supported at all** |
| Skeletal animation | ✅ Most robust | ✅ | ❌ (it is a vertex cache, not a rig) |
| Changing mesh topology per frame | ❌ | ❌ | ✅ **This is its whole purpose** |
| Cameras | ✅ (animated FOV unreliable) | Spec supports it; verify | ✅ With aspect-ratio options |
| Point clouds / curves | ❌ | ❌ | ✅ |
| **Android / Quest build** | ✅ | ✅ | ❌ **NO** |

**Practical recommendation:** static props and spacecraft → **GLB**. Rigged characters → **FBX**. Per-frame deforming simulation geometry → **Alembic**, desktop build only.

> One more warning: do **not** drag a `.blend` file directly into Unity. It looks convenient, but Unity just silently calls Blender to convert it to FBX behind the scenes, and that path **does not account for the coordinate system difference**. Always export explicitly.

---

## Part 8 — Why Unity, and not something purpose-built

You asked whether a better option than Unity exists. I looked seriously, because for astronomy there genuinely are purpose-built tools. Here is the reasoning.

### 8.1 OpenSpace — the obvious candidate, and why it is out

**OpenSpace** (openspaceproject.com) is open-source interactive astronomy visualization software, MIT licensed, funded by NASA, built by the American Museum of Natural History together with Linköping University, the University of Utah, and NYU. It has first-class SPICE support, volumetric rendering, real mission trajectories, and production-grade dome projection already used in real planetariums. On paper it is precisely your project, already finished.

**Two hard facts disqualify it:**

**1. It does not run on Apple Silicon at all.** macOS support was *removed* in version 0.22.0. OpenSpace now requires OpenGL 4.6, which macOS does not provide. The official installation documentation states plainly: *"Apple's M-chip is not supported."* The deeper reason is that OpenSpace needs double-precision arithmetic for solar-system-scale positioning, and Apple's Metal graphics API does not offer it.

**2. Its VR support is effectively dead.** There was historical OpenVR support that provided head tracking and stereo rendering but **no controller support at all**. It was reported broken as of 2022, and there is no OpenXR support in any recent release. **VR is one of your stated deliverables.**

There is also a scope problem even setting those aside. "Interactive" in OpenSpace means navigating and toggling within *its* interaction model. Building *your* interactions — grab a planet with your hands, scrub a simulation, stretch an orbit — is not a supported extension point; it is C++20 engine development inside a large unfamiliar codebase. That is not a four-month beginner task.

### 8.2 Gaia Sky — the interesting surprise

**Gaia Sky**, from ARI Heidelberg and built around the ESA Gaia mission, is the closest existing thing to what you are describing. It **runs on macOS**, has a **Python scripting API**, produces native **dome master output**, supports **MPCDI** multi-projector setups, and has **OpenXR VR**.

It is still not your answer — you would be authoring content inside someone else's application rather than building an interactive experience of your own design. But **spend one afternoon with it in week 1.** Seeing a finished, polished version of the thing you are about to build is worth a lot. It is also your fallback if something goes badly wrong, and a good comparison baseline for your report.

### 8.3 The others, briefly

- **Celestia** — GPL, Lua scripting, large add-on ecosystem, but no VR and no dome support.
- **Stellarium** — has fisheye projection and dome warping, but it is a sky-viewing application (what the sky looks like from a location), not a 3D space simulator. No VR.
- **NASA's Eyes on the Solar System** — beautiful and closest in spirit to your goal, but **not open source** and there is no public API. Interestingly it originally shipped as a Unity application, which is a small vote of confidence in your chosen approach.
- **ESASky / Aladin Lite** — browser-based, JavaScript API, but focused on 2D sky surveys.

### 8.4 The verdict

**Build in Unity.** The reasons:

- **You control the interaction design.** This is precisely the requirement that makes your project different from a planetarium show, and it is exactly what the purpose-built tools do not let you change.
- **URP + OpenXR is a real, documented, first-class VR path.**
- **It works on macOS for authoring**, with the NVIDIA machine for VR iteration.
- **Fulldome output is solved** by the DomeTools package (Part 9.3) with modest effort.
- **The learning surface for a beginner is enormous** — Unity has more tutorials than every astronomy tool combined.

The cost is real: you must rebuild things OpenSpace gives away free — precision handling, ephemeris loading, catalogs. But that rebuilt work *is* your BTP, and it is work you can explain and defend.

**Use OpenSpace and Gaia Sky as reference implementations and as ground truth for checking your orbital data — not as your engine.**

---

## Part 9 — Planetarium output, explained

Good news: this is a solved, well-specified problem, and Blender does it natively.

### 9.1 What a dome master actually is

A **dome master** is a **square** image containing a **circular fisheye** projection of a 180° hemisphere. Specifically an *equidistant azimuthal* projection, which means distance from the centre of the image is directly proportional to angle away from straight up.

The orientation convention:
- **Centre of the frame = the zenith** (straight up above the audience)
- **Edge of the circle = the horizon** (the base of the dome)
- **Bottom of the frame = the direction the audience is facing**
- Everything outside the circle is **black**

You deliver this canonical square master. The venue's own software then slices and warps it for their particular arrangement of projectors — that is their job, not yours.

### 9.2 The delivery specification (IMERSA / AFDI 2019)

| Parameter | Value |
|---|---|
| Frame shape | **Square, circular content only** |
| Resolutions | 720², 1024², 1536², 2048², 3200², **4096²** |
| Frame rate | **30 or 60 fps** primary (24, 25, 29.97, 48, 59.94 also accepted) |
| Bit depth | 8, 10, or 12 bits per colour |
| File format | Numbered **lossless PNG or TGA** sequence, or maximum-quality JPEG |
| Naming | `Name_000001.png`, max ~10,000 frames per folder |
| Audio | **Separate mono WAV per channel** (`_L`, `_R`, `_C`, `_Ls`, `_Rs`, `_LFE`), 48 kHz 16-bit |
| Delivery media | USB drive, **NTFS formatted** |

**Two composition rules that will change how you frame every shot:**

- **Safe action area:** roughly **±50° longitude** from the dome front, **10°–60° latitude**. Put anything important there. Content near the zenith forces the audience to crane their necks uncomfortably.
- **Recommended nominal camera tilt: 15°**, since many domes are physically tilted 15–30°.

This is why you cannot simply re-render a 16:9 shot as a dome master. A composition designed for a rectangular screen puts the subject in the wrong part of the dome. Plan to recompose.

### 9.3 Rendering a dome master in Blender

The exact settings:

```python
cam.data.type = 'PANO'
cam.data.cycles.panorama_type = 'FISHEYE_EQUIDISTANT'   # NOT equisolid
cam.data.cycles.fisheye_fov = math.radians(180)
scene.render.resolution_x = 4096
scene.render.resolution_y = 4096
```

Point the camera at the zenith, then rotate about Z so the "front of dome" direction lands at the **bottom** of the frame.

Blender's manual explicitly endorses this lens: *"This is a good lens for full-dome projections."*

> ⚠️ **Two caveats that will cost you time if you do not know them in advance.**
>
> **First, panoramic cameras only work in Cycles.** EEVEE — including EEVEE Next — does not support them. So every dome render uses the slow engine.
>
> **Second, there is no viewport preview.** Panoramic cameras only work in the final render, not in Solid mode or Material Preview. You will iterate blind, via small test renders. This is genuinely frustrating. Mitigation: iterate at 1024² and only go to 4096² for the final pass.

**A free bonus:** change `panorama_type` to `'EQUIRECTANGULAR'` and the same scene produces a **360° video for YouTube VR**. That is a complete extra deliverable for one line of code, and an excellent backup if either the dome or the headset falls through.

### 9.4 Real-time interactive fulldome from Unity

This is the exciting possibility. If the venue can accept a live video feed, you could run your *interactive* application on the dome — which is the entire point of your project — rather than just playing a film.

**`github.com/prefrontalcortex/DomeTools`** (package `com.pfc.dome-tools`) supports Unity 6 and all three render pipelines, outputs standard dome masters, and streams live over **NDI** into media servers like Pixera and Vioso. It also ships a **Dome Viewer app that runs on Quest** — meaning **you can preview and demo the fulldome experience in a headset without access to a physical dome.** That is extremely useful for development.

> ⚠️ Two flags. The repository's `LICENSE` file says MIT, but its `package.json` declares `"license": "Proprietary"`. That is a direct contradiction — email the maintainers and get clarification in writing before it appears in your report. And confirm with the venue whether they can take a live NDI feed.

### 9.5 The three questions for the venue

Planetarium vendors do not publish their ingest formats openly, so this genuinely cannot be looked up. Ask:

1. **Which playback system do you use?** (Digistar/Cosm, Sky-Skan DigitalSky, Zeiss, Konica Minolta…)
2. **What exactly do you ingest** — a numbered image sequence or an encoded video? What resolution, frame rate, codec? Is the dome tilted?
3. **Can you accept a live NDI or HDMI feed?** ⭐ This is the one that matters most. If yes, you can run the interactive application live on the dome.

**Default assumption until they answer:** 4096×4096 PNG sequence at 30 fps with separate WAV audio files.

---

## Part 10 — The 16-week schedule

You have roughly four months and you are a beginner in two major pieces of software. **This schedule deliberately does not attempt everything on your professor's list.** It builds a general pipeline, proves it on two very different kinds of data, and ships one polished interactive VR experience. Additional scenarios are stretch goals, clearly marked.

Every phase ends with something you can show. There are no invisible-infrastructure weeks.

---

### Phase 0 — Foundation (Week 1)

**Fix the environment.** Delete and recreate the `.venv` — remember it is silently broken because the folder was renamed. Install ffmpeg and poppler via Homebrew. Install the Python dependencies. Add Blender to your `PATH`. Install Blender 4.2 LTS alongside 5.0. Run `git init` — there is currently no version control at the BTP root, which is a real risk.

**Scaffold the package.** Create the `astroviz/` directory tree from Part 6.1 with stub files. Nothing needs to work yet; you are establishing the shape.

**⭐ Send the data request email.** Appendix A is a draft. Do this **before writing code**. ISRO registration, GPU procurement, and headset purchase all have lead times measured in weeks, and they are your biggest schedule risk.

**⭐ Ask the planetarium for their technical spec.** Free to ask, expensive to guess wrong.

**Spend one afternoon with Gaia Sky.** Understand what a finished version of this looks like.

**Definition of done:** these three commands succeed —
```bash
blender --background --python-expr "import bpy; print(bpy.app.version)"
python -c "import numpy, scipy, h5py, astropy, spiceypy, pyPLUTO, yaml"
ffmpeg -version
```
— and the data request email is sent.

> ⚠️ **On Blender 5.0.** You are on a very new release. Its Python API changed, and your own script already contains two workarounds for it. Almost every tutorial online targets 3.6 or 4.2. Develop against **4.2 LTS**; keep 5.0 installed but do not fight it while you are still learning.

---

### Phase 1 — Fix the torus, properly (Week 2)

This is not just a bug fix. It is where you learn the three ways to turn field data into geometry, using data you already have on disk.

**1a. Correct the revolve.** Replace `step3` and `step4`. Extract an **ordered contour** with `skimage.measure.find_contours`, build the mesh with **real edges** (`from_pydata(verts, edges, [])`), then apply the Screw modifier. This alone is the difference between a black frame and a torus.

Alternatively, skip the Screw modifier entirely and construct the surface of revolution directly in NumPy — make N copies of the contour rotated around the axis and stitch consecutive rings into quads. More code, but complete control and no modifier surprises.

**1b. Do it as a volume as well.** Resample the whole density field onto a uniform 3D grid, write it to OpenVDB, and render it with a Principled Volume shader in Cycles. **This is what actually looks like astrophysics** — soft, layered, glowing — rather than a hard plastic shell. Do both so you can compare them in your report.

**1c. Make it move without new data.** You have one timestep, so there is no physical evolution to show. But you can still produce a real 60-second film:
- an orbiting camera flying around and then *through* the torus,
- a slow reveal peeling through successive density isosurface levels,
- magnetic field lines traced with PyPLUTO's `find_fieldlines` and animated as streamlines.

**1d. Fix the shader honestly.** Wire the actual density into the colour through a Color Ramp with a real scientific colour map, and add the `temperature` grid for physical blackbody emission (Part 4.6).

**Definition of done:** `out/torus_flythrough.mp4` exists, is 60 seconds, is **not black**, and its colours map to log density with a legend.

> This phase is excellent report material. You can show the black frame and the fixed frame side by side and explain precisely why one failed. That is a much better story than if it had worked first time.

---

### Phase 2 — Trajectory pipeline: your first real demo (Weeks 3–5)

**This is your chosen first demo and the backbone of the whole project.**

**Week 3 — get the data in.** Write `readers/spice.py` (load kernels, call `spkezr` over a time array, handle units and frame selection) and `readers/horizons.py` (same output shape, from CSV — your fallback and the only route for a mission that gives you a plain table).

**Validate before moving on.** Plot Voyager 2's path with matplotlib and compare it against the published Grand Tour figure. Check that Jupiter closest approach lands on 9 July 1979 and Saturn on 25 August 1981. **Do not proceed until the numbers are right** — everything downstream inherits any error here, and a subtly wrong trajectory is much harder to spot later.

**Week 4 — build the scene.** Write `scene/spec.py` (the SceneSpec schema) and `blender/build.py` (spawn the Sun and planets as textured spheres, place the spacecraft model, write position keyframes, build the trail curve, add a starfield). Write `scene/cameras.py` with the onboard, chase, and orbit rigs.

Solve the scale problem here (Part 7.5): nested scale layers plus exaggerated body radii with an honest on-screen note.

**Week 5 — make the movie.** Write `blender/render.py` and `video/encode.py`. Implement the adaptive time-warp curve. Produce **`voyager_jupiter_flyby.mp4`** — a real gravity assist, from real NASA kernels, with a POV camera.

**Definition of done:** `astroviz build scenes/voyager_grand_tour.yaml` runs end to end from a clean checkout and writes an MP4.

**You now have something genuinely impressive to show, at the one-third mark.**

---

### Phase 3 — Unity: make it interactive (Weeks 6–8)

Blender gives you a *movie*. Unity is where "interactive" happens.

**Week 6 — get assets in.** Create the Unity project with the URP template. Export from Blender and import to Unity, verifying the axis conversion with an asymmetric test object first.

Export the **models** from Blender but the **trajectory as JSON**, read by a C# script at runtime (Part 4.10). This is the most important Unity design decision in the project.

**⭐ Also this week, as soon as the headset arrives: flash a "hello world" VFX Graph particle scene onto the Quest.** This proves Vulkan and compute shaders work there. It is the riskiest unproven assumption in the entire plan and it costs one afternoon to de-risk. Do not leave it until Phase 4.

**Week 7 — build the interactive layer.** This is the "planetarium, but interactive" part:

- **Time controls** — play, pause, rewind, speed slider, jump to a specific event
- **Camera modes** — free-fly, onboard POV, chase, locked to a planet, top-down
- **Click a body** → information panel with real numbers (distance, velocity, date)
- **Toggles** — orbit trails, labels, true scale vs. exaggerated, and **reference frame**

That last one deserves emphasis. Letting the viewer switch between a Sun-centred and a Jupiter-centred view *during a flyby* is a fantastic teaching moment — the trajectory visibly changes shape from a gentle curve into a dramatic hyperbola, and suddenly "gravity assist" makes intuitive sense. It costs one subtraction to implement.

Also implement the **floating origin** this week. Without it everything jitters violently once you are past a few hundred thousand units.

**Week 8 — polish and prove generality.** Real star-catalogue skybox, bloom and post-processing, a menu to choose a mission. Then run `parker_perihelion.yaml` through the whole pipeline and confirm it lands in Unity with **no code changes**. That test is what proves you built a tool rather than a demo.

**Definition of done:** a standalone build a person can run, where they fly alongside Voyager, scrub time, switch reference frames, and click on things.

---

### Phase 4 — Volumetric data into Unity (Weeks 9–11)

The hardest technical part. Budget the full three weeks and keep the fallback ready.

Attempt in this order (full reasoning in Part 7.4):

1. **VFX Graph point cloud** — best effort-to-quality ratio, and the only option that comfortably reaches standalone Quest. Use a position-map texture for the time dimension.
2. **Texture3D and raymarching** — adapt `mlavik1/UnityVolumeRendering` rather than writing the shader yourself. Export `.raw` or `.nrrd` from your pipeline, not VDB.
3. **Isosurface mesh sequence** — robust but looks like a shell, and via Alembic it is desktop-only.

**Guaranteed fallback, decide by end of week 10:** pre-render the volumetric sequence in Blender and play it inside Unity on a screen or 360° skybox, with the interactive trajectory layer in front. Visually nearly as good, and it always works. **Do not let this phase sink the project.**

**Definition of done:** the torus or jet appears in the Unity application in some form, and you can document which approach you used and why. That "and why" is genuinely good report material — the tradeoff between these four options is the most interesting engineering decision in the project.

---

### Phase 5 — VR (Weeks 12–13)

Install the **OpenXR Plugin** (Meta's own recommendation for Unity 6) and **XR Interaction Toolkit 3.x** with its Starter Assets sample. Target **Meta Quest 3** standalone. Player settings: **Vulkan** (remove OpenGL ES — VFX Graph needs it), IL2CPP, ARM64, HDR off.

**Design the interactions:**
- Teleport locomotion plus **grab-to-scale the solar system in your hands**. Reaching out, grabbing Jupiter's orbit, and stretching it is the single best VR moment you can build in this project.
- Controller ray to select bodies
- A wrist-mounted time-control panel

**Comfort is a hard requirement, not polish.** Snap turning rather than smooth rotation, no forced camera acceleration, a static reference frame (a cockpit or console) always in view, and a locked 72 or 90 fps. **A nauseating demo is a failed demo**, regardless of how good the visuals are.

Reduce the scene aggressively for standalone Quest — it is a mobile-class GPU. Expect to scale volumetrics down or fall back to the pre-rendered approach.

> ⚠️ **You need the Windows/NVIDIA machine by now.** You *can* build and install to a Quest from an Apple Silicon Mac over USB. But **Quest Link is Windows-only**, so on a Mac there is no "press Play and see it in the headset" — every iteration is a full Android build, minutes instead of seconds. Over two weeks that is days of lost time.

---

### Phase 6 — Planetarium dome output (Week 14)

Full technical detail in Part 9. In schedule terms:

- Re-render the existing scenes through a **`FISHEYE_EQUIDISTANT` 180° Cycles camera at 4096×4096**, as a numbered PNG sequence.
- **Recompose shots for the safe action area** — a shot framed for 16:9 puts the subject in the wrong part of the dome.
- Iterate at 1024²; final pass at 4096². Remember there is no viewport preview.
- Render the **360° equirectangular** version too — free YouTube VR deliverable and a good backup.
- **Stretch:** real-time interactive fulldome via DomeTools + NDI, if the venue can take a live feed.

---

### Phase 7 — Second showcase and report (Weeks 15–16)

**Pick ONE stretch scenario, based on what data actually arrived:**

| If you got… | Build |
|---|---|
| Nothing new (most likely) | ⭐ **Gravitational waves from a merger.** Free LIGO/SXS waveform data, stunning result, mostly mathematics, no big data dependency. **Recommended default.** |
| N-body snapshots | Galaxy collision via VFX Graph particles |
| A 3D PLUTO run | The jet launch, done properly in 3D |
| Nothing, but you want the black hole | Kerr geodesic lensing shader — pure computation, no data |

Then: write the report, write the documentation, and **record a demo video**. Do not rely on a live demo — projectors fail, headsets run out of battery, and laptops decide to update. Have the recording.

If a planetarium rehearsal is possible, do it this week.

---

### If you fall behind

Cut in this order: **Phase 7 stretch scenario → dome master → VR → volumetric-in-Unity.**

**Never cut Phases 2 and 3.** They *are* the project.

---

## Part 11 — Things that will go wrong

These are specific, concrete traps I found while examining your setup and researching the tools. Each one can silently cost you days.

**1. ⚠️ The PyPLUTO array transposition ambiguity.** PyPLUTO's internal `readfluid.py` states that arrays come back shaped `(nx3, nx2, nx1)` — *reversed* from the grid axis order. But your `step2_plot.py` treats `rho` as `(nx1, nx2)` and produces a correct-looking plot. One of these is compensating for the other, and I could not determine which from reading alone.

**Resolve this empirically before you write the volume exporter.** If you get it wrong, your torus comes out silently mirrored or rotated 90°, and it will look plausible enough that you will not notice — until someone at the planetarium does.

*The test:* build a deliberately **asymmetric synthetic field** (a blob at a known, off-centre position), push it through your entire pipeline, and confirm it appears exactly where predicted. Make this a permanent unit test.

**2. ⚠️ Verify `openvdb` imports on day one.** Everything volumetric depends on it, and NumPy support in OpenVDB is a compile-time option that is sometimes disabled.

```bash
blender -b --python-expr 'import bpy; bpy.utils.expose_bundled_modules(); import openvdb; print(openvdb.FloatGrid().copyFromArray)'
```

If this fails, fall back to Blender's Geometry Nodes "Points to Volume" (needs no VDB at all) or go isosurface-only.

**3. ⚠️ Blender expands VDB to dense at render time.** OpenVDB is sparse on disk, but not in Blender's renderer. A 512³ float grid is ~512 MB per frame. Start at 128³ and crop tightly.

**4. ⚠️ `reshape_cartesian` is 2D only.** Its docstring examples are copy-pasted from a different function and are wrong. Write the 3D resampler yourself.

**5. ⚠️ Your `.venv` is broken and fails silently.** `.venv/bin/pip` produces no output and no error — it just does nothing. Recreate the venv before anything else.

**6. ⚠️ `BLENDER_EEVEE` is not a valid engine name in Blender 4.2+.** It is `BLENDER_EEVEE_NEXT`.

**7. ⚠️ Unity floating-point precision.** Jitter starts around 1,000–5,000 units and is obvious by 10,000. Solar-system scenes hit this immediately. Implement a floating origin.

**8. ⚠️ Alembic cannot build to Android.** Quest standalone is Android. Decide your volumetric route accordingly.

**9. ⚠️ Quest Link is Windows-only.** This determines *when* you need the NVIDIA machine.

**10. ⚠️ Panoramic cameras are Cycles-only with no viewport preview.** Every dome shot is iterated blind.

**11. ⚠️ `.pcache` is a static snapshot, not an animation.** Plan for position-map textures from the start.

**Day-one checklist:** recreate venv → install ffmpeg → `import bpy` works → `import openvdb` works → asymmetric-field round-trip test passes → Voyager Jupiter flyby date checks out → non-black-render assertion in place.

---

## Part 12 — How we verify things actually work

Your current project failed *silently*. The script printed "Render saved" and produced a black PNG. Nothing complained. That is the failure mode we most need to eliminate.

So every stage gets an automatic check that fails **loudly**.

| Stage | Check | How |
|---|---|---|
| Environment | All imports resolve | `python -c "import numpy, scipy, h5py, astropy, spiceypy, pyPLUTO, bpy, yaml"` |
| OpenVDB | Bindings present with NumPy support | The `blender -b --python-expr` command in Part 11.2 |
| ffmpeg | Encoder present | `ffmpeg -version` |
| **Reader correctness** | Synthetic asymmetric blob comes out where predicted | `pytest tests/test_roundtrip.py` |
| **Orientation** | Same test catches any axis swap | same |
| Trajectory | Voyager 2 Jupiter closest approach = **1979-07-09**, Saturn = **1981-08-25**; Earth–Sun distance ≈ 1 AU | `pytest tests/test_spice.py` |
| **⭐ Non-black render** | `np.count_nonzero(img) > 0.01 * img.size` | Part of every build. **This one assertion would have caught your current bug immediately.** |
| **⭐ Mesh sanity** | `assert len(mesh.polygons) > 0` before rendering | In `blender/build.py`. **Also would have caught it.** |
| Video | MP4 exists with expected duration and frame count | `ffprobe out/*.mp4` |
| Unity | Scene loads, trajectory JSON parses, spacecraft at expected position on a known date | Unity Test Framework play-mode test |
| End to end | From a clean clone, `astroviz build scenes/voyager_grand_tour.yaml` produces an MP4 | CI script |

**The rule: no stage may succeed quietly while producing nothing.** Every step asserts that its output is non-empty and physically plausible.

Those two starred checks are worth writing on day one. They are three lines of code each and they make the exact failure you already hit impossible to repeat.

---

## Part 13 — What we are deliberately NOT doing

Being explicit so expectations are clear with your professor from the start.

| Not doing | Why | What we do instead |
|---|---|---|
| Full GRMHD black hole accretion from simulation data | Terabyte-scale, needs an HPC pipeline | Analytic Kerr lensing shader — no data, looks excellent |
| Numerical-relativity merger hydrodynamics | Terabytes and hard to obtain | The **gravitational waveform** from free LIGO/SXS data — beautiful, correct, tiny |
| Cosmological large-scale structure | Enormous | — |
| Real-time raytraced volumetrics on standalone Quest | Mobile GPU cannot do it | VFX Graph points, or pre-rendered video skybox |
| A universal "any file format" auto-detector | Unbounded scope | Explicit reader plugins — new format = one new file |
| A physics-integrated n-body orbital solver | The real trajectories are *already* ground truth | Replay real SPICE data. More honest and more impressive |
| Multi-user networked VR | Large scope, small payoff | Single user |

---

## Part 14 — Glossary

### Data and simulation

**PLUTO** — a physics program that simulates gas and magnetic fields in space. It outputs tables of numbers, not pictures.

**PyPLUTO** — a Python library that reads those tables into Python.

**Snapshot / dump / timestep** — one frozen moment of a simulation, saved to a file. A movie needs many. *You currently have one.*

**Grid** — space chopped into a 3D chessboard of small boxes called **cells**. Each cell stores density, pressure, velocity, and so on.

**Spherical grid** — cells arranged by distance from centre (R), angle down from the pole (θ), and angle around (φ), rather than by x/y/z. Natural for anything orbiting a central object. Your torus data uses this.

**Axisymmetric (2D)** — the simulation computed only a flat slice and assumes everything looks identical all the way around. Cheap to compute, but it can never show spirals or lopsided jets.

**Scalar field** — one number per cell (density). **Vector field** — three numbers per cell forming an arrow (velocity, magnetic field).

**Code units** — made-up units simulations use for numerical convenience. You need conversion constants to get back to real physical units.

**N-body** — a simulation of many individual particles pulling on each other gravitationally. Output is a list of positions, not a grid.

**SPICE / kernel / SPK / `.bsp`** — NASA's system for "where was this spacecraft at this exact time, pointing which way." A kernel is one data file. SPK files hold positions. This is *real* recorded mission data.

**Ephemeris** — a table of positions over time.

**HORIZONS** — a NASA web service that returns the same positions as a simple CSV, with no kernels to manage. Much easier to start with.

### 3D graphics

**Mesh** — a 3D shape made of **vertices** (points), **edges** (lines between points), and **faces** (flat patches). ⭐ **Renderers only draw faces.** Your current mesh has vertices but zero faces, which is exactly why the image is black.

**Modifier** — a non-destructive operation applied to a mesh in Blender. The **Screw modifier** spins a shape around an axis to create a ring — but it works by sweeping *edges*, so edges must exist.

**Isosurface** — the 3D surface connecting every point with the same value. Like a contour line on a map, but in three dimensions. **Marching cubes** is the algorithm that builds one.

**Volume rendering** — drawing data as glowing fog where brightness follows density, instead of as a hard surface. This is what real astrophysics visuals look like.

**OpenVDB / `.vdb`** — the standard file format for 3D fog/volume data. Blender reads it natively; **Unity cannot read it at all.**

**Voxel** — a 3D pixel; one cell of a volume.

**Shader / material** — the recipe determining what colour and brightness each point appears. **Emission** means the object glows by itself.

**Cycles vs EEVEE** — Blender's two renderers. Cycles is slow, physically accurate, and handles volumes properly. EEVEE is fast, approximate, and weak on volumes. Preview in EEVEE, finalise in Cycles.

**Keyframe** — "at second 3 the object is here; at second 8 it is there." The software fills in between.

**Headless / `--background`** — running Blender from the terminal with no window, driven by a script. Essential for automation.

**`bpy`** — Blender's Python module. Lets you build entire scenes in code.

**glTF / `.glb` / FBX / Alembic** — formats for moving 3D content between programs. GLB packs everything into one file. Alembic stores per-frame vertex positions (good for shape-changing geometry) but **does not work on Quest**.

### Game engine and VR

**Unity** — a game engine: real-time 3D plus interactivity. Where the "interactive" part lives.

**Render pipeline (URP / HDRP)** — Unity's rendering settings preset. URP is fast and works on headsets; HDRP is prettier but desktop-only. **Pick once; switching later is painful.**

**VFX Graph** — Unity's GPU particle system. Can draw millions of glowing points. Our best route for volumetric-looking data in Unity.

**Texture3D** — a 3D image; a cube of values. Can hold a density field for a shader to draw.

**Raymarching** — a shader technique that steps a ray through a volume accumulating brightness. How fog is drawn in real time.

**Floating origin** — a trick for huge worlds: keep the camera at coordinate zero and move the *universe* around it, so numbers stay small and nothing jitters.

**OpenXR / XR Interaction Toolkit** — the standard plumbing that makes a Unity application work in VR headsets.

**Standalone VR** — the headset runs the app by itself (Quest 3), with no PC attached. Easiest to demo, but it is a mobile-class GPU, so scenes must be light.

### Planetarium

**Fulldome** — video projected onto a hemispherical dome ceiling rather than a flat screen.

**Dome master** — the delivery format: a *square* video containing a circular fisheye image, which the venue's software then wraps onto the dome.

**Fisheye / equirectangular** — two ways of flattening a very wide view into a rectangle. Fisheye goes to domes; equirectangular goes to 360° YouTube and VR video.

---

## Part 15 — Prior art worth citing

Your professor's reference — **Lan et al. 2021, "Visualization in Astrophysics", Computer Graphics Forum 40(3)**, DOI `10.1111/cgf.14332` — is directly useful for your report. Its section on data wrangling describes literally your problem: *"transforming raw astrophysical data cubes into suitable data formats that can be ingested into open-source visualization tools, such as Blender and Houdini."*

Chase these specific citations from it:

- **Gárate [Gár17]** — *"importing simulation outputs from astrophysical hydrodynamic experiments into Blender using the voxel data format."* This is the closest published precedent to your pipeline. Read it first.
- **AstroBlend** (Naiman) — a Python library extending Blender for astronomy, built on `yt`.
- **FRELLED** (Taylor) — a Blender-based FITS viewer supporting non-Cartesian 3D volumetric data.
- **Borkiewicz et al.** — importing nested adaptive-mesh-refinement data into Houdini.
- **OpenSpace** (Bock et al.) — including a time-varying coronal mass ejection with 3D rendering and field lines.
- **`yt`** — the recurring bridge tool throughout astronomy visualization.

**A useful framing for your introduction.** I searched the full text of that paper: it contains **zero** mentions of *OpenVDB*, *Unity*, *Unreal*, *glTF*, *game engine*, or *SPICE*. The game-engine, real-time, interactive, VR side of your project is genuinely not covered by the state of the art this survey describes. That is a legitimate novelty claim and a good thing to say up front.

---

## Appendix A — Draft email to your professor

> Ready to send. Adjust the greeting and remove any scenarios you do not want to pursue.

---

**Subject:** BTP — data requirements and resources needed

Sir,

Following our discussion, I have worked out the technical pipeline for the project: raw simulation data → automated Blender scene and animation → interactive Unity application → VR, with a fulldome render path in case a planetarium screening is possible.

Almost all the software is free and open source — Blender, Unity, Python, OpenVDB, NASA SPICE — so there is no licensing cost. What I need is data and some hardware.

**1. What I can obtain myself (no action needed from you)**

NASA mission trajectories for Voyager, Perseverance, and Parker Solar Probe are publicly available through NAIF and JPL HORIZONS, as are planet surface textures and spacecraft 3D models. I am starting with these so that I have a working demonstration quickly rather than waiting on data.

**2. Where I need your help**

**(a) The MHD Torus data.** The folder I currently have contains only a **single snapshot** (`data.0001.vtk` at t = 5.0) of a **2D axisymmetric** run. An animation needs a time series. Could I please get:

- the **full dump sequence** — ideally 60 or more outputs at regular intervals, covering an interesting period such as an instability growing or a jet launching;
- **`pluto.ini`** and **`definitions.h`**, which I need for the physical unit conversions;
- and, if one exists, a **3D (R, θ, φ) version** of this run. Since the current data is axisymmetric it cannot show spiral structure or asymmetric jets, so a 3D run would be the single biggest improvement available.

Alternatively — and this would honestly be the most useful outcome — if I could get **access to PLUTO itself along with the problem setup directory**, I could run the simulation myself and choose my own output cadence and resolution. That would make me independent for data for the rest of the project.

**(b) Other scenarios.** If you have, or can point me toward, any of the following, I can build additional scenes:

- **Galaxy collision:** N-body snapshots. Gadget HDF5 is ideal, but even a plain table of `x, y, z, vx, vy, vz, mass` per particle per snapshot would work perfectly. Around 10⁵–10⁶ particles and 100–300 snapshots is plenty — more particles than that would not improve the visuals.
- **Neutron star merger:** I can use public LIGO/SXS gravitational **waveform** data for the wave propagation, which needs nothing from you. For the merger hydrodynamics itself I would need numerical relativity grid data — do you have a contact who might have some?
- **Black hole:** I plan to compute the lensing and shadow directly from the geodesic equations rather than needing data, unless you happen to have GRMHD output available.

**(c) Aditya-L1.** ISSDC's PRADAN portal publishes SPICE kernels for Aditya-L1, but access requires registration. Could you help me obtain institutional access? Including an ISRO mission alongside the NASA ones would make the project noticeably stronger.

**For any dataset, four things are needed or it cannot be used:** the full time series rather than a single snapshot, the grid/coordinate description file, the physical unit constants, and one line describing what is physically happening and when.

**3. Hardware**

- A **Linux or Windows machine with an NVIDIA GPU.** I am currently on Apple Silicon. I can build VR applications for the Meta Quest from a Mac, but Quest Link — the feature that lets you test changes instantly in the headset — is Windows-only, so every iteration on a Mac requires a full rebuild taking several minutes. Over the VR phase this would cost several days. I would need this by roughly month 2.
- The **VR headset** you mentioned. I would recommend a **Meta Quest 3** — it runs standalone with no PC required, which makes it very easy to carry to a demonstration. Ordering it around month 2 would keep it off the critical path.
- Roughly **1–2 TB of storage** for simulation dumps and rendered frame sequences.

**4. Planetarium**

If a screening is realistic, could you get answers to three questions from the venue early? Vendors do not publish this information, so it genuinely cannot be looked up:

1. Which playback system do they use — Digistar/Cosm, Sky-Skan DigitalSky, Zeiss, Konica Minolta, or something else?
2. What exactly do they ingest — a numbered image sequence or an encoded video? What resolution, frame rate, and codec? Is the dome tilted?
3. **Can they accept a live NDI or HDMI feed?** This one matters most: if yes, I could run the interactive application *live* on the dome rather than only playing a pre-rendered film — which is exactly the difference you described between this and an ordinary planetarium show.

My working assumption until they answer is a 4096×4096 PNG sequence at 30 fps with separate WAV audio files, which is the IMERSA delivery standard. Rendering in the wrong format would waste several days of GPU time, so it is worth confirming early. A short rehearsal slot before any actual show would also help — content that looks fine on a monitor can be uncomfortable on a dome.

**5. One optional paid item**

Everything above is free. The only paid tool worth considering is Unity's **Space Graphics Toolkit** (roughly ₹5,000–8,000 on the Asset Store), which provides a mature large-scale coordinate system and planetary rendering. It would save perhaps two weeks of work on the hardest engineering problem in the project. Entirely optional — I can implement the equivalent myself if you would prefer.

Thank you,
[Your name]

---

## Appendix B — Quick reference links

**Data sources**
- NAIF generic kernels — `naif.jpl.nasa.gov/pub/naif/generic_kernels/`
- Voyager kernels — `naif.jpl.nasa.gov/pub/naif/VOYAGER/kernels/spk/`
- Perseverance kernels — `naif.jpl.nasa.gov/pub/naif/pds/pds4/mars2020/mars2020_spice/`
- Parker Solar Probe — `sppgway.jhuapl.edu/MOC/reconstructed_ephemeris/`
- Aditya-L1 (ISSDC PRADAN) — `pradan.issdc.gov.in/al1/`
- JPL HORIZONS API — `ssd.jpl.nasa.gov/api/horizons.api`
- NASA 3D Resources — `science.nasa.gov/3d-resources`
- LIGO open data — `gwosc.org`
- SXS waveform catalog — `data.black-holes.org`

**Libraries and tools**
- PyPLUTO — `github.com/GiMattia/PyPLUTO`
- spiceypy — `spiceypy.readthedocs.io`
- OpenVDB — `openvdb.org`
- Blender manual — `docs.blender.org/manual/en/latest/`
- Blender Python API — `docs.blender.org/api/current/`

**Unity packages**
- glTFast — `com.unity.cloud.gltfast`
- Alembic — `com.unity.formats.alembic`
- XR Interaction Toolkit — `com.unity.xr.interaction.toolkit`
- UnityVolumeRendering — `github.com/mlavik1/UnityVolumeRendering`
- DomeTools — `github.com/prefrontalcortex/DomeTools`
- Floating origin — `github.com/qkmaxware/Spaceworks`

**Reference software to look at**
- OpenSpace — `openspaceproject.com`
- Gaia Sky — `gaiasky.space`

**Standards**
- IMERSA fulldome delivery spec — `imersa.org/guidelines`
