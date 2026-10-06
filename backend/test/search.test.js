// Unit tests for search.js: search text is trimmed and limited, and LIKE wildcards typed by a user are escaped.
// Owner: Virun. Run with: npm test  (no database needed)
// Checks that search text is trimmed and length-limited, and that wildcards typed by a user are escaped, without needing the database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { likePattern, searchText } from '../src/search.js';

test('searchText trims, ignores anything that is not text, and refuses very long text', () => {
  assert.equal(searchText('  Perera '), 'Perera');
  assert.equal(searchText(undefined), '');
  assert.equal(searchText(['a', 'b']), ''); // ?search=a&search=b arrives as a list
  assert.throws(() => searchText('x'.repeat(101)), (err) => err.status === 400 && err.field === 'search');
});

test('likePattern matches anywhere and treats % and _ as plain characters', () => {
  assert.equal(likePattern('SA00'), '%SA00%');
  assert.equal(likePattern('50%_off'), '%50\\%\\_off%');
  assert.equal(likePattern('a\\b'), '%a\\\\b%');
});
