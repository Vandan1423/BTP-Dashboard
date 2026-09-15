# BTP

The B.Tech project: one dashboard that presents three projects, and each member's
own work beside it.

```
BTP/
├── Dashboard/   the website: one Vite + three.js site for all three projects
├── Vandan/      solar wind + CME: simulation pipeline, renders, Unity VR build
├── Nisarg/      Nisarg's project
└── Sakshi/      Sakshi's project
```

## See the dashboard

Needs Node.js 20.19 or later (Vite 7).

```bash
cd Dashboard/frontend
npm install
npm run dev          # http://localhost:5173
```

To add your project to the site, follow `Dashboard/frontend/README.md`. You edit
`src/lib/projects.js` and write your page in `src/pages/<your id>/`.

## Run Vandan's part

**The 360 viewer works as soon as the dashboard runs.** Its videos, proxies,
thumbnails and stills are in `Vandan/output/renders/`.

**VTK → Frames works in two modes.** Without the render service it runs a
simulator and says so on screen. To render for real, you need Blender and two
Python environments, then start the service.

1. Install Blender 5.2 from blender.org.
2. Create the environment that converts `.vtk` to `.vdb`:
   ```bash
   conda env create -f Vandan/environment/vdb-convert.yml
   ```
3. Create the environment that queries Solar-MACH (Python 3.13):
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r Vandan/environment/requirements-venv.txt
   ```
4. Check the machine and start the service. If an interpreter is somewhere other
   than the default, set its path in `Dashboard/backend/config.json` (see
   `config.example.json`).
   ```bash
   cd Dashboard/backend
   python3 serve.py --check
   python3 serve.py
   ```

Reload the dashboard after the service starts. Archived timesteps 0, 10, 169 and
170 render out of the box. Their volumes are in `Vandan/input/vdb/`.
`Dashboard/backend/README.md` covers the rest.

## What is not in this repository

The raw simulation data and the frame-by-frame renders total about 22 GB. Each
`.vtk` is over GitHub's 100 MB file limit. `Vandan/DATA.md` lists what is missing,
what needs it, and how to get it.
