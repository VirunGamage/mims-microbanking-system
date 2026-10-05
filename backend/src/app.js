// Builds the Express app: JSON bodies, CORS for the Vite dev server, the /api routes and the error handlers. Owner: Virun.
// Kept apart from server.js so the app can be created in tests without opening a network port.
// Builds the Express app: it reads JSON requests, mounts the /api router and turns any error into a plain-language answer.
import cors from 'cors';
import express from 'express';
import { errorHandler, notFound } from './errors.js';
import { createApiRouter } from './routes/index.js';

export async function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  // The Vite proxy makes the browser's calls same-origin, so CORS only matters if the frontend calls port 3001 directly.
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

  app.get('/', (req, res) => {
    res.json({ data: { message: 'The MIMS API is running. Try /api/health, or open the app at http://localhost:5173' } });
  });
  app.use('/api', await createApiRouter(options));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
