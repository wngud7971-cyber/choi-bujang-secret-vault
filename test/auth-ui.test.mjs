import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { createAccessGate } from '../public/access-state.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const moduleSource = html.match(/<script type="module" id="auth-script">([\s\S]*?)<\/script>/u)[1];
assert.match(moduleSource, /import \{ createAccessGate \} from '\/access-state\.js';/u);
const source = moduleSource.replace("import { createAccessGate } from '/access-state.js';", '');
const sessionA = { user: { email: 'Test account A' }, access_token: 'TEST_ONLY_FIRST_TOKEN' };
const sessionB = { user: { email: 'Test account B' }, access_token: 'TEST_ONLY_SECOND_TOKEN' };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function page(initialSession = null, autoApprove = true) {
  const makeElement = () => ({
    value: '', textContent: '', hidden: false, disabled: true, dataset: {}, children: [], handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {},
    focus() {},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
  });
  const elements = new Map();
  for (const id of ['login-form', 'email', 'password', 'login-button', 'logout-button',
    'signed-in', 'signed-in-email', 'auth-status', 'auth-message', 'notes',
    'note-editor', 'note-form', 'note-heading', 'note-title', 'note-body', 'note-save', 'note-cancel', 'note-message',
    'device-status', 'device-message', 'request-device', 'check-device']) {
    elements.set('#' + id, makeElement());
  }
  const calls = [];
  const windowHandlers = {};
  const navigator = { onLine: true };
  const removedStorage = [];
  let deviceReply = { approved: true, state: 'approved' };
  let authCallback;
  let clientOptions;
  const auth = {
    onAuthStateChange(callback) { authCallback = callback; },
    async getSession() { return { data: { session: initialSession }, error: null }; },
    async signOut() { authCallback('SIGNED_OUT', null); return { error: null }; },
  };
  const context = vm.createContext({
    createAccessGate,
    AbortController,
    document: { querySelector: name => elements.get(name), createElement: makeElement },
    window: { location: { origin: 'https://student-defense.vercel.app' },
      navigator,
      addEventListener: (name, callback) => { windowHandlers[name] = callback; },
      localStorage: { removeItem: key => removedStorage.push(key) },
      byteBackDevice: {
        async check() { return deviceReply; },
        async register() { return { approved: false, state: 'pending', requestId: 'fixture-request' }; },
        async proof() { return 'TEST_ONLY_DEVICE_PROOF'; },
      },
      supabase: { createClient: (url, key, options) => {
        assert.equal(url, 'https://student-defense.vercel.app');
        assert.equal(key, 'server-auth-proxy');
        clientOptions = options;
        return { auth };
      } }, confirm: () => true }, URL,
    fetch: (url, options) => url === '/api/device'
      ? Promise.resolve(Response.json({ approved: false, state: 'verification_required', registeredCount: 1, pendingCount: 0 }))
      : new Promise(resolve => { calls.push({ url, options, resolve }); }),
  });
  await vm.runInContext('(async () => {' + source + '\n})()', context);
  const approve = async () => { await elements.get('#check-device').handlers.click(); await flush(); };
  if (initialSession && autoApprove) await approve();
  return {
    el: id => elements.get('#' + id), calls, clientOptions,
    removedStorage,
    approve,
    reply: value => { deviceReply = value; },
    network: online => { navigator.onLine = online; windowHandlers[online ? 'online' : 'offline'](); },
    change: async (event, session) => {
      authCallback(event, session);
      if (session && autoApprove) await approve();
    },
  };
}

test('protected notes UI follows login state and discards late responses', async t => {
  await t.test('login and requesting registration never show notes; only verified approval opens the room', async () => {
    const current = await page(sessionA, false);
    assert.equal(current.calls.length, 0);
    assert.equal(current.el('note-editor').hidden, true);
    await current.el('request-device').handlers.click();
    assert.equal(current.calls.length, 0);
    assert.match(current.el('device-status').textContent, /승인 대기/u);
    current.reply({ approved: false, state: 'pending' });
    await current.approve();
    assert.equal(current.calls.length, 0);
    current.reply({ approved: true, state: 'approved' });
    await current.approve();
    assert.equal(current.calls.length, 1);
    current.calls[0].resolve(Response.json([]));
    await flush();
    assert.equal(current.el('note-editor').hidden, false);
    current.reply({ approved: false, state: 'revoked' });
    await current.approve();
    assert.equal(current.el('note-editor').hidden, true);
    assert.match(current.el('device-status').textContent, /회수/u);
  });
  await t.test('new sessions remain in memory and only this app legacy session is removed', async () => {
    const current = await page();
    assert.equal(current.clientOptions.auth.persistSession, false);
    assert.deepEqual(current.removedStorage, ['sb-tdltpkfewovnxnxhvbkd-auth-token',
      'sb-tdltpkfewovnxnxhvbkd-auth-token-code-verifier']);
  });
  await t.test('offline clears data and drafts, rejects a late response and reconnects with a new request', async () => {
    const current = await page(sessionA);
    current.calls[0].resolve(Response.json([{ id: '1', title: 'Test A', body: 'Synthetic content' }]));
    await flush();
    current.el('note-title').value = 'Draft';
    current.el('note-body').value = 'Synthetic draft';
    current.network(false);
    assert.equal(current.el('note-editor').hidden, true);
    assert.equal(current.el('note-body').value, '');
    assert.equal(current.el('note-title').value, '');
    assert.match(current.el('notes').children[0].textContent, /오프라인/u);
    const count = current.calls.length;
    current.el('note-form').handlers.submit({ preventDefault() {} });
    assert.equal(current.calls.length, count);
    current.network(true);
    assert.equal(current.calls.length, count);
    await current.approve();
    assert.equal(current.calls.length, count + 1);
    const pending = current.calls.at(-1);
    current.network(false);
    assert.equal(pending.options.signal.aborted, true);
    pending.resolve(Response.json([{ id: '2', title: 'Late', body: 'Synthetic content' }]));
    await flush();
    assert.match(current.el('notes').children[0].textContent, /오프라인/u);
    current.network(true);
    await current.approve();
    current.calls.at(-1).resolve(Response.json([]));
    await flush();
    assert.equal(current.el('note-editor').hidden, false);
    assert.match(current.el('notes').children[0].textContent, /내 메모가 아직 없습니다/u);
  });
  await t.test('Auth transport uses only the server gateway and no real project key is embedded', async () => {
    assert.ok(!/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/u.test(html));
    assert.ok(!/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(html));
    const current = await page();
    const transport = current.clientOptions.global.fetch;
    transport('https://student-defense.vercel.app/auth/v1/token?grant_type=password', { method: 'POST' });
    assert.equal(current.calls[0].url, '/api/auth/token?grant_type=password');
    transport('https://student-defense.vercel.app/auth/v1/logout?scope=local', { method: 'POST' });
    assert.equal(current.calls[1].url, '/api/auth/logout?scope=local');
    assert.throws(() => transport('https://student-defense.vercel.app/rest/v1/training_notes', {}));
    assert.throws(() => transport('https://another-project.supabase.co/auth/v1/token', {}));
  });
  await t.test('anonymous page does not request data; a saved login sends only its access token', async () => {
    const anonymous = await page();
    assert.equal(anonymous.calls.length, 0);
    const saved = await page(sessionA);
    assert.equal(saved.calls.length, 1);
    assert.equal(saved.calls[0].url, '/api/notes');
    assert.deepEqual(Object.keys(saved.calls[0].options.headers), ['Authorization', 'x-byteback-device-proof']);
    assert.equal(saved.calls[0].options.headers.Authorization, 'Bearer ' + sessionA.access_token);
    assert.equal(saved.calls[0].options.cache, 'no-store');
    saved.calls[0].resolve(Response.json([{ id: '1', title: 'Test A', body: 'Synthetic content' }]));
    await flush();
    assert.equal(saved.el('notes').children[0].children[0].textContent, 'Test A');
    await saved.el('logout-button').handlers.click();
    assert.equal(saved.el('login-form').hidden, false);
    assert.equal(saved.el('notes').children[0].textContent, '로그인하면 가상 자료를 볼 수 있습니다.');
  });

  await t.test('logout clears notes even when the previous response arrives later', async () => {
    const current = await page(sessionA);
    const pending = current.calls[0];
    current.change('SIGNED_OUT', null);
    assert.equal(pending.options.signal.aborted, true);
    pending.resolve(Response.json([{ id: '1', title: 'Old account', body: 'Synthetic content' }]));
    await flush();
    assert.equal(current.el('notes').children[0].textContent, '로그인하면 가상 자료를 볼 수 있습니다.');
  });

  await t.test('a previous account response cannot replace the latest account response', async () => {
    const current = await page(sessionA);
    const previous = current.calls[0];
    await current.change('SIGNED_IN', sessionB);
    assert.equal(current.calls.length, 2);
    current.calls[1].resolve(Response.json([{ id: '2', title: 'Test B', body: 'Synthetic content' }]));
    await flush();
    previous.resolve(Response.json([{ id: '1', title: 'Test A', body: 'Synthetic content' }]));
    await flush();
    assert.equal(current.el('notes').children[0].children[0].textContent, 'Test B');
  });

  await t.test('API authentication rejection displays a login failure without note data', async () => {
    const current = await page(sessionA);
    current.calls[0].resolve(Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }));
    await flush();
    assert.match(current.el('notes').children[0].textContent, /로그인 확인에 실패/u);
  });

  await t.test('add, edit and delete controls use the specified API methods and reload the personal list', async () => {
    const current = await page(sessionA);
    current.calls[0].resolve(Response.json([]));
    await flush();
    assert.equal(current.el('note-editor').hidden, false);
    const id = '44444444-4444-4444-8444-444444444444';
    const submit = () => current.el('note-form').handlers.submit({ preventDefault() {} });
    current.el('note-title').value = 'Test title';
    current.el('note-body').value = 'Synthetic content';
    submit();
    await flush();
    assert.equal(current.calls[1].options.method, 'POST');
    assert.equal(current.calls[1].url, '/api/notes');
    assert.deepEqual(JSON.parse(current.calls[1].options.body), { title: 'Test title', body: 'Synthetic content' });
    current.calls[1].resolve(Response.json({ id }, { status: 201 }));
    await flush();
    current.calls[2].resolve(Response.json([{ id, title: 'Test title', body: 'Synthetic content' }]));
    await flush();
    current.el('notes').children[0].children[2].children[0].handlers.click();
    await flush();
    assert.equal(current.calls[3].options.method, 'GET');
    assert.equal(current.calls[3].url, '/api/notes/' + id);
    current.calls[3].resolve(Response.json({ id, title: 'Test title', body: 'Synthetic content' }));
    await flush();
    assert.equal(current.el('note-body').value, 'Synthetic content');
    current.el('note-title').value = 'Updated';
    submit();
    await flush();
    assert.equal(current.calls[4].options.method, 'PUT');
    assert.equal(current.calls[4].url, '/api/notes/' + id);
    current.calls[4].resolve(Response.json({ id, title: 'Updated', body: 'Synthetic content' }));
    await flush();
    current.calls[5].resolve(Response.json([{ id, title: 'Updated', body: 'Synthetic content' }]));
    await flush();
    current.el('notes').children[0].children[2].children[1].handlers.click();
    await flush();
    assert.equal(current.calls[6].options.method, 'DELETE');
    assert.equal(current.calls[6].url, '/api/notes/' + id);
    current.calls[6].resolve(Response.json({ id }));
    await flush();
    current.calls[7].resolve(Response.json([]));
    await flush();
    assert.equal(current.el('note-message').textContent, '메모를 삭제했습니다.');
    assert.match(current.el('notes').children[0].textContent, /내 메모가 아직 없습니다/u);
  });

  await t.test('logout during a write prevents the old operation from restoring the editor or loading notes', async () => {
    const current = await page(sessionA);
    current.calls[0].resolve(Response.json([]));
    await flush();
    current.el('note-title').value = 'Test';
    current.el('note-body').value = 'Synthetic content';
    current.el('note-form').handlers.submit({ preventDefault() {} });
    await flush();
    const write = current.calls[1];
    current.change('SIGNED_OUT', null);
    assert.equal(write.options.signal.aborted, true);
    write.resolve(Response.json({ id: '44444444-4444-4444-8444-444444444444' }, { status: 201 }));
    await flush();
    assert.equal(current.calls.length, 2);
    assert.equal(current.el('note-editor').hidden, true);
    assert.equal(current.el('note-title').value, '');
    assert.equal(current.el('note-message').textContent, '');
  });
});
