import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const source = html.match(/<script type="module" id="auth-script">([\s\S]*?)<\/script>/u)[1];
const sessionA = { user: { email: 'Test account A' }, access_token: 'TEST_ONLY_FIRST_TOKEN' };
const sessionB = { user: { email: 'Test account B' }, access_token: 'TEST_ONLY_SECOND_TOKEN' };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function page(initialSession = null) {
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
    'note-editor', 'note-form', 'note-heading', 'note-title', 'note-body', 'note-save', 'note-cancel', 'note-message']) {
    elements.set('#' + id, makeElement());
  }
  const calls = [];
  let authCallback;
  const auth = {
    onAuthStateChange(callback) { authCallback = callback; },
    async getSession() { return { data: { session: initialSession }, error: null }; },
    async signOut() { authCallback('SIGNED_OUT', null); return { error: null }; },
  };
  const context = vm.createContext({
    AbortController,
    document: { querySelector: name => elements.get(name), createElement: makeElement },
    window: { supabase: { createClient: () => ({ auth }) }, confirm: () => true },
    fetch: (url, options) => new Promise(resolve => { calls.push({ url, options, resolve }); }),
  });
  await vm.runInContext('(async () => {' + source + '\n})()', context);
  return {
    el: id => elements.get('#' + id), calls,
    change: (event, session) => authCallback(event, session),
  };
}

test('protected notes UI follows login state and discards late responses', async t => {
  await t.test('anonymous page does not request data; a saved login sends only its access token', async () => {
    const anonymous = await page();
    assert.equal(anonymous.calls.length, 0);
    const saved = await page(sessionA);
    assert.equal(saved.calls.length, 1);
    assert.equal(saved.calls[0].url, '/api/notes');
    assert.deepEqual(Object.keys(saved.calls[0].options.headers), ['Authorization']);
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
    current.change('SIGNED_IN', sessionB);
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
    assert.equal(current.calls[1].options.method, 'POST');
    assert.equal(current.calls[1].url, '/api/notes');
    assert.deepEqual(JSON.parse(current.calls[1].options.body), { title: 'Test title', body: 'Synthetic content' });
    current.calls[1].resolve(Response.json({ id }, { status: 201 }));
    await flush();
    current.calls[2].resolve(Response.json([{ id, title: 'Test title', body: 'Synthetic content' }]));
    await flush();
    current.el('notes').children[0].children[2].children[0].handlers.click();
    assert.equal(current.calls[3].options.method, 'GET');
    assert.equal(current.calls[3].url, '/api/notes/' + id);
    current.calls[3].resolve(Response.json({ id, title: 'Test title', body: 'Synthetic content' }));
    await flush();
    assert.equal(current.el('note-body').value, 'Synthetic content');
    current.el('note-title').value = 'Updated';
    submit();
    assert.equal(current.calls[4].options.method, 'PUT');
    assert.equal(current.calls[4].url, '/api/notes/' + id);
    current.calls[4].resolve(Response.json({ id, title: 'Updated', body: 'Synthetic content' }));
    await flush();
    current.calls[5].resolve(Response.json([{ id, title: 'Updated', body: 'Synthetic content' }]));
    await flush();
    current.el('notes').children[0].children[2].children[1].handlers.click();
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
