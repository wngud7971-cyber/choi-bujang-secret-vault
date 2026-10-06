import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/notes.js';

function responseRecorder() {
  return {
    headers: new Map(),
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('notes API keeps the server key private on success and all error paths', async t => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const oldConsole = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  const testKey = 'TEST_ONLY_SERVER_KEY';
  for (const name of Object.keys(oldConsole)) console[name] = (...args) => logs.push(args);
  process.env.SUPABASE_URL = 'https://learning-project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = testKey;
  try {
    await t.test('anonymous GET returns four rows, excluding upstream extra fields', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: String(i + 1), title: `Test card ${i + 1}`, content: `Test content ${i + 1}`,
        owner_id: 'TEST_OWNER', secret: testKey,
      }));
      globalThis.fetch = async (url, options) => {
        assert.equal(url.origin, 'https://learning-project.supabase.co');
        assert.equal(url.pathname, '/rest/v1/training_notes');
        assert.equal(url.searchParams.get('select'), 'id,title,content');
        assert.equal(url.searchParams.get('order'), 'position.asc,id.asc');
        assert.equal(options.headers.apikey, testKey);
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(options.redirect, 'error');
        return Response.json(rows);
      };
      const res = responseRecorder();
      await handler({ method: 'GET', query: { table: 'other' }, headers: { cookie: 'test' } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.notes, rows.map(({ id, title, content }) => ({ id, title, content })));
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(JSON.stringify(res.body).includes(testKey), false);
    });

    await t.test('POST is rejected without contacting Supabase', async () => {
      globalThis.fetch = async () => { assert.fail('POST must not reach the database'); };
      const res = responseRecorder();
      await handler({ method: 'POST' }, res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.get('allow'), 'GET');
    });

    await t.test('missing key and invalid URL fail without contacting Supabase', async () => {
      globalThis.fetch = async () => { assert.fail('Invalid configuration must not reach the database'); };
      delete process.env.SUPABASE_SECRET_KEY;
      const missing = responseRecorder();
      await handler({ method: 'GET' }, missing);
      assert.equal(missing.statusCode, 503);
      process.env.SUPABASE_SECRET_KEY = testKey;
      process.env.SUPABASE_URL = 'http://learning-project.supabase.co';
      const invalid = responseRecorder();
      await handler({ method: 'GET' }, invalid);
      assert.equal(invalid.statusCode, 503);
      process.env.SUPABASE_URL = 'https://learning-project.supabase.co';
    });

    await t.test('upstream errors, invalid data and exceptions never expose details', async () => {
      const scenarios = [
        async () => Response.json({ error: testKey }, { status: 401 }),
        async () => Response.json({ secret: testKey }),
        async () => Response.json([{ id: '1', title: 'Test', content: null }]),
        async () => new Response('invalid JSON'),
        async () => { throw new Error(`request failed with ${testKey}`); },
      ];
      for (const scenario of scenarios) {
        globalThis.fetch = scenario;
        const res = responseRecorder();
        await handler({ method: 'GET' }, res);
        assert.equal(res.statusCode, 502);
        assert.deepEqual(res.body, { error: 'NOTES_UNAVAILABLE' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
      }
    });
    assert.deepEqual(logs, []);
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of Object.keys(oldConsole)) console[name] = oldConsole[name];
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
