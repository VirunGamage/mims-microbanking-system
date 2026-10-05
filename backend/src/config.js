// Reads backend/.env and checks the settings the server needs before anything else starts. Owner: Virun.
// Used by server.js and the database test. Only DB_HOST, DB_PORT and PORT have defaults; the rest must be in .env.
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

export function loadConfig() {
  if (!existsSync(ENV_PATH)) {
    throw new ConfigError(
      'backend/.env does not exist yet. Copy backend/.env.example to backend/.env, then put in your mims_app password.',
    );
  }
  dotenv.config({ path: ENV_PATH, quiet: true }); // quiet: newer dotenv versions print a banner on every start
  return readConfig(process.env);
}
