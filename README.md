# Dashboard

One site, three BTP projects. A circular BEGIN button on near-black opens into a
galaxy; three planets orbit it, one per project. Click one and the camera dives
through the disc onto that project's page.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Set `PORT` to run a second copy alongside the first.

## Folder layout on disk

This repository is the `Dashboard/` folder of the BTP project. The site on its
own needs nothing else: clone it, `npm install`, `npm run dev`, and build your
page. Two parts of Vandan's section look one folder up for his pipeline, and
simply run without it:

```
BTP/
├── Dashboard/        <- this repository
└── Vandan/           the solar-wind pipeline and its renders (not in this repo)
```

- the 360 viewer plays renders from `../Vandan/output/renders` (about 10 GB),
  so it shows "Render not found" without them;
- the render service in `backend/` runs the pipeline in `../Vandan`, so
  VTK → Frames uses its simulator without it.

**Everything else is documented in [`frontend/README.md`](frontend/README.md)** --
how to claim your planet, how to write your page, how to draw in 3D, and how the
particle field works. That file sits next to the code it describes, so it is the
one that stays true. This one exists only to point at it.

`backend/` is the render service behind Vandan's VTK → Frames section: it runs
the real conversion, camera placement and Blender render for an uploaded
timestep, and it also serves the built site. Standard-library Python, nothing to
install:

```bash
cd backend
python3 serve.py            # http://localhost:8000
```

With it stopped, VTK → Frames falls back to a simulator and says so on screen.
Everything else is a pure frontend. See [`backend/README.md`](backend/README.md).
