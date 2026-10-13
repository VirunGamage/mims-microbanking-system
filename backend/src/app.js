// Builds the Express app: JSON bodies, CORS for the Vite dev server, the /api routes and the error handlers. Owner: Virun.
// Kept apart from server.js so the app can be created in tests without opening a network port.
// Builds the Express app: it reads JSON requests, mounts the /api router and turns any error into a plain-language answer.
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { loginFromEnv, loginGate } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { createApiRouter } from './routes/index.js';

export async function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  // On the cloud server every request needs the login from APP_USERNAME and APP_PASSWORD; without them this does nothing
  app.use(loginGate(options.login === undefined ? loginFromEnv() : options.login));
  app.use(express.json({ limit: '50kb' }));
  // The Vite proxy makes the browser's calls same-origin, so CORS only matters if the frontend calls port 3001 directly.
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

  if (!options.staticDir) {
    app.get('/', (req, res) => {
      res.json({ data: { message: 'The MIMS API is running. Try /api/health, or open the app at http://localhost:5173' } });
    });
  }
  app.use('/api', await createApiRouter(options));
  if (options.staticDir) serveFrontend(app, options.staticDir);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

// In the Docker image the built pages (frontend/dist) are served from this same port, so the browser, the pages and the
// API share one address. Any other GET outside /api gets index.html, because the page addresses (/customers,
// /reports, ...) belong to React Router in the browser, not to files on the server.
function serveFrontend(app, staticDir) {
  const indexFile = path.resolve(staticDir, 'index.html');
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(indexFile);
  });
}
