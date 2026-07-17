import { defineConfig } from 'vite';
import { copyFileSync, readFileSync } from 'fs';

// Copies static files that must live at the site root but aren't processed
// by Vite (service worker must be at /sw.js; favicon.svg referenced by both
// the web app manifest and the service worker pre-cache at /favicon.svg).
function copyRootFilesPlugin() {
  return {
    name: 'copy-root-files',
    closeBundle() {
      copyFileSync('./sw.js', './dist/sw.js');
      copyFileSync('./favicon.svg', './dist/favicon.svg');
      copyFileSync('./manifest.json', './dist/manifest.json');
      copyFileSync('./icon-180.png', './dist/icon-180.png');
      copyFileSync('./icon-192.png', './dist/icon-192.png');
      copyFileSync('./icon-512.png', './dist/icon-512.png');
      copyFileSync('./lock-logo.png', './dist/lock-logo.png');
      copyFileSync('./home-logo.png', './dist/home-logo.png');
      copyFileSync('./favicon.ico', './dist/favicon.ico');
      copyFileSync('./favicon-32.png', './dist/favicon-32.png');
      copyFileSync('./favicon-16.png', './dist/favicon-16.png');
      copyFileSync('./activity-weightlifting.png', './dist/activity-weightlifting.png');
      copyFileSync('./activity-cycling.png', './dist/activity-cycling.png');
      copyFileSync('./activity-soccer.png', './dist/activity-soccer.png');
      copyFileSync('./activity-sailing.png', './dist/activity-sailing.png');
      copyFileSync('./activity-piano.png', './dist/activity-piano.png');
    },
  };
}

// Serves root-level static files (manifest, sw, icons) in dev mode
function serveRootStaticPlugin() {
  // In dev mode, swap in dev-specific assets so the home screen icon looks different
  const DEV_FILE_MAP = {
    '/manifest.json':  { file: './manifest-dev.json', mime: 'application/json' },
    '/sw.js':          { file: './sw.js',              mime: 'application/javascript' },
    '/favicon.svg':    { file: './favicon-dev.svg',    mime: 'image/svg+xml' },
    '/icon-180.png':   { file: './icon-dev-180.png',   mime: 'image/png' },
    '/icon-192.png':   { file: './icon-dev-192.png',   mime: 'image/png' },
    '/icon-512.png':   { file: './icon-dev-512.png',   mime: 'image/png' },
  };
  return {
    name: 'serve-root-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const entry = DEV_FILE_MAP[path];
        if (!entry) return next();
        try {
          res.setHeader('Content-Type', entry.mime);
          res.end(readFileSync(entry.file));
        } catch {
          next();
        }
      });
    },
  };
}

const API_PORT = process.env.API_PORT ? parseInt(process.env.API_PORT) : 4175;

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 4174,
    strictPort: true,
    // Dev must never serve stale assets: styles.css is a plain <link> (no
    // hashed name in dev), and browsers heuristically cache it without this.
    headers: { "Cache-Control": "no-store" },
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false },
      '/.netlify/functions': { target: `http://localhost:${API_PORT}`, changeOrigin: false },
    },
  },
  plugins: [copyRootFilesPlugin(), serveRootStaticPlugin()],
});
