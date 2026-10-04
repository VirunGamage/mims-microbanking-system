// Starts the API: reads backend/.env, checks the database, then listens on PORT (3001). Owner: Virun.
// If anything is wrong it prints what to fix and stops, instead of starting half-working.
// Starts the backend: it loads and checks backend/.env, tests the database connection and then listens on the chosen port.
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { checkConnection, closePool, initPool } from './db.js';
import { startupProblem } from './errors.js';

function stop(message) {
  console.error(`\nThe MIMS API could not start.\n${message}\n`);
  process.exit(1);
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) stop(err.message);
    throw err;
  }

  initPool(config.db);
  try {
    const info = await checkConnection();
    console.log(`Connected to MySQL ${info.version}, database "${info.db}", as ${config.db.user}`);
  } catch (err) {
    stop(startupProblem(err, config));
  }

  const app = await createApp();
  // Express 5 calls this function with an error too (for example when the port is taken), so check for it first.
  const server = app.listen(config.port, (err) => {
    if (err) stop(startupProblem(err, config));
    console.log(`MIMS API listening on http://localhost:${config.port}  (check http://localhost:${config.port}/api/health)`);
  });

  const shutDown = async () => {
    console.log('Stopping the MIMS API...');
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutDown); // Ctrl + C in the terminal
  process.on('SIGTERM', shutDown);
}

main();
