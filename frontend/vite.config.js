// Vite settings: React support, the dev server on port 5173, and the /api proxy to the backend on port 3001.
// The proxy lets the browser call /api/... on the same address as the pages, so no CORS setup is needed.
// Starts the React dev server on port 5173 (and stops with an error if that port is taken), and forwards every /api request to the backend on port 3001, so the pages and the API share one address and need no CORS setup.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // stop with a clear error instead of quietly moving to another port
    proxy: {
      // 127.0.0.1 rather than "localhost", which some computers resolve to the IPv6 address first
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
