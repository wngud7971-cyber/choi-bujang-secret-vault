import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

test('offline worker stores only a public guide and leaves all protected traffic to the server', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const writes = [];
  const network = [];
  const guide = Response.json({ publicOfflineGuide: true });
  const origin = 'https://student-defense.vercel.app';
  const cache = {
    async put(path, response) { writes.push({ path, response }); },
    async match(path) { assert.equal(path, '/offline.html'); return guide; },
  };
  let offline = false;
  vm.runInNewContext(source, {
    URL, Response,
    self: { location: { origin }, clients: { async claim() {} },
      addEventListener: (name, callback) => { handlers[name] = callback; } },
    caches: { async open() { return cache; } },
    fetch: async (request, options) => {
      network.push({ request, options });
      if (offline) throw new TypeError('offline');
      return new Response('public guide');
    },
  });
  let pending;
  handlers.install({ waitUntil: value => { pending = value; } });
  await pending;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/offline.html');
  assert.equal(network[0].request, '/offline.html');
  assert.equal(network[0].options.cache, 'no-store');
  for (const path of ['/api/notes', '/api/notes/id', '/api/auth/token', '/api/restore', '/?token=fixture']) {
    handlers.fetch({ request: { url: origin + path, method: 'GET', mode: 'navigate' },
      respondWith() { assert.fail('protected or query-bearing navigation was intercepted'); } });
  }
  handlers.fetch({ request: { url: origin + '/', method: 'POST', mode: 'navigate' },
    respondWith() { assert.fail('write request was intercepted'); } });
  handlers.fetch({ request: { url: origin + '/', method: 'GET', mode: 'cors' },
    respondWith() { assert.fail('non-navigation request was intercepted'); } });
  offline = true;
  handlers.fetch({ request: { url: origin + '/', method: 'GET', mode: 'navigate' },
    respondWith: value => { pending = value; } });
  assert.equal(await pending, guide);
  assert.equal(writes.length, 1);
});

test('manifest opens the same room and references valid installation icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL('../public' + icon.src, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});
