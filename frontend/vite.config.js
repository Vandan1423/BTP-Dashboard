import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the rendered assets actually live.
 *
 * Nine point eight gigabytes of PNGs and MP4s sit in the pipeline's own output
 * folder, and copying them into `public/` would be absurd. This resolves to
 * `BTP/Vandan/output/renders` and is the ONLY directory the dev server will
 * serve from -- see the guard in `serveMedia` below.
 */
const MEDIA_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../Vandan/output/renders',
);

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
};

/**
 * Serves MEDIA_ROOT at /media, with HTTP Range support.
 *
 * Range is not optional. Without a 206 response the browser has to download an
 * entire 4096x2048 video before it can show a frame, and seeking the scrubber
 * (phase 2) does not work at all.
 *
 * In production FastAPI serves the same folder at the same path, so nothing in
 * `src/` changes when this moves to the GPU box.
 */
function serveMedia() {
  const handler = (req, res, next) => {
    // Strip the query string, decode, and refuse anything that escapes the
    // media root. The rule here is absolute: a static server binds to one
    // dedicated directory and never to a parent of anything else.
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.resolve(MEDIA_ROOT, '.' + rel);
    if (file !== MEDIA_ROOT && !file.startsWith(MEDIA_ROOT + path.sep)) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // "bytes=START-END", either end optional.
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size || start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(file, { start, end }).pipe(res);
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(file).pipe(res);
  };

  return {
    name: 'btp-media',
    configureServer(server) {
      server.middlewares.use('/media', handler);
      server.config.logger.info(`  \x1b[32m➜\x1b[0m  \x1b[1mmedia:\x1b[0m   ${MEDIA_ROOT}`);
    },
    // `npm run preview` serves the production build. Without this it would
    // serve the site but none of the renders, which looks like a broken viewer
    // rather than a missing mount.
    configurePreviewServer(server) {
      server.middlewares.use('/media', handler);
    },
  };
}

/**
 * The render service (Dashboard/backend) for the dev server.
 *
 * `/api` is forwarded to it so the dashboard talks to one origin, exactly as it
 * does on the box where the service serves the site itself. When the service
 * is not running the proxy answers with an error, the dashboard's health probe
 * fails, and VTK -> Frames falls back to its simulator -- which is the point:
 * nothing here has to be switched on or off by hand.
 */
const RENDER_API = process.env.BTP_API || 'http://127.0.0.1:8000';

const apiProxy = {
  '/api': {
    target: RENDER_API,
    changeOrigin: true,
    // No custom error handler: Vite's own answers 500 straight away when the
    // service is not running, and a silent handler would leave the request
    // open until the dashboard's probe timed out.
  },
};

export default defineConfig({
  plugins: [serveMedia()],
  // PORT lets a second dev server run alongside the first without a clash.
  server: { port: Number(process.env.PORT) || 5173, host: '0.0.0.0', proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
