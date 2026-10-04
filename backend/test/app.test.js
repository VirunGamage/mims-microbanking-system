// Tests the whole Express app without a database: unknown routes, broken JSON, and a server-side failure that must
// reach the browser only as a short message. Owner: Virun. Run with: npm test  (no database needed)
// Tests the Express app without a database: that /api is mounted, JSON bodies are read, and unknown routes and errors get plain-language answers.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const app = await createApp({ log: () => {} }); // log: keeps the "Routes loaded" line out of the test output
  server = app.listen(0); // port 0: the computer picks any free port
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the root address says the API is running', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match((await response.json()).data.message, /MIMS API is running/);
});

test('an unknown endpoint is a 404 with a plain message', async () => {
  const response = await fetch(`${base}/api/no-such-thing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'There is no API endpoint GET /api/no-such-thing' });
});

test('a body that is not valid JSON is a 400 with a plain message', async () => {
  const response = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"firstName": ',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'The request body is not valid JSON' });
});

test('an unexpected server error reaches the browser as a short message, never the details', async () => {
  // No database pool exists in this test, so /api/health fails inside the server.
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args); // the details are logged on the server only
  try {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.doesNotMatch(body.error, /pool|initPool|at |\.js/);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});
