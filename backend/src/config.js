// Reads backend/.env and checks the settings the server needs before anything else starts. Owner: Virun.
// Used by server.js and the database test. Only DB_HOST, DB_PORT and PORT have defaults; the rest must be in .env.
// In Docker there is no .env file: docker-compose.yml passes the same settings as environment variables instead.
// Reads the settings from backend/.env and stops at start-up, with a clear message, if a value is missing or still the example password.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(backendDir, '.env');

const REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const EXAMPLE_PASSWORD = 'change-me';

export class ConfigError extends Error {}

export function readConfig(env) {
  const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new ConfigError(
      `backend/.env has no value for ${missing.join(', ')}. ` +
        'Copy backend/.env.example to backend/.env and fill in every line.',
    );
  }
  if (env.DB_PASSWORD === EXAMPLE_PASSWORD) {
    throw new ConfigError(
      'DB_PASSWORD in backend/.env is still the example value. ' +
        'Put in the password you chose for mims_app when you ran scripts/create_app_user.sql.',
    );
  }
  return {
    port: toPort(env.PORT, 3001, 'PORT'),
    // The built frontend (frontend/dist) to serve from this same port, as the Docker image does. Not set on a
    // developer's computer, where Vite serves the pages on port 5173.
    staticDir: env.STATIC_DIR?.trim() || null,
    db: {
      host: env.DB_HOST?.trim() || '127.0.0.1',
      port: toPort(env.DB_PORT, 3306, 'DB_PORT'),
      user: env.DB_USER.trim(),
      password: env.DB_PASSWORD, // not trimmed: a space could be part of the password
      database: env.DB_NAME.trim(),
    },
  };
}

function toPort(value, fallback, name) {
  if (value === undefined || String(value).trim() === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${name} in backend/.env must be a whole number between 1 and 65535.`);
  }
  return port;
}

// The .env file is only required when the settings are not already in the environment (they are in Docker).
// A value already in the environment wins over the same line in .env.
export function loadConfig({ envPath = ENV_PATH, env = process.env } = {}) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true, processEnv: env }); // quiet: newer dotenv versions print a banner on every start
  } else if (REQUIRED.some((key) => !env[key])) {
    throw new ConfigError(
      'backend/.env does not exist yet. Copy backend/.env.example to backend/.env, then put in your mims_app password.',
    );
  }
  return readConfig(env);
}
