import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { generateKeyPair, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import handler from '../api/auth/[action].js';

function recorder() {
  return { headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; } };
}

test('auth gateway limits scope, keeps keys server-side and supports the real SDK session flow', async t => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const serverKey = 'TEST_ONLY_SERVER_KEY';
  const secretSentinel = 'TEST_ONLY_UPSTREAM_DETAIL';
  const email = ['fixture', 'example.invalid'].join('@');
  const user = { id: '11111111-1111-4111-8111-111111111111', email };
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = serverKey;
  let calls = [];
  let upstream;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(new URL(url).origin, new URL(config.identityProvider.issuer).origin);
    assert.equal(options.headers.apikey, serverKey);
    assert.equal(options.redirect, 'error');
    return upstream(new URL(url), options);
  };
  const call = async (url, method = 'POST', body, extraHeaders = {}) => {
    const response = recorder();
    await handler({ url, method, body, headers: {
      'content-type': 'application/json', origin: new URL(config.publicAppUrl).origin, ...extraHeaders,
    } }, response);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    return response;
  };
  try {
    await t.test('password login forwards only credentials and returns only session fields', async () => {
      calls = [];
      upstream = async () => Response.json({ access_token: 'TEST_ONLY_ACCESS', refresh_token: 'TEST_ONLY_REFRESH',
        expires_in: 3600, token_type: 'bearer', user: { ...user, secret: serverKey }, secret: serverKey });
      const response = await call('/api/auth/token?grant_type=password', 'POST', {
        email, password: 'TEST_ONLY_PASSWORD', url: 'https://attacker.invalid', role: 'service_role', apikey: 'ATTACKER_KEY',
      }, { authorization: 'Bearer server-auth-proxy', apikey: 'ATTACKER_KEY' });
      assert.equal(response.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.equal(new URL(calls[0].url).pathname, '/auth/v1/token');
      assert.deepEqual(JSON.parse(calls[0].options.body), { email, password: 'TEST_ONLY_PASSWORD' });
      assert.equal(calls[0].options.headers.Authorization, undefined);
      assert.deepEqual(response.body.user, user);
      assert.ok(!JSON.stringify(response.body).includes(serverKey));
    });
    await t.test('unknown/admin/data routes, cross-origin calls and unsupported grants never contact Supabase', async () => {
      calls = [];
      for (const path of ['/api/auth/admin', '/api/auth/signup', '/api/auth/rest/v1/training_notes']) {
        assert.equal((await call(path)).statusCode, 404);
      }
      assert.equal((await call('/api/auth/token?grant_type=password', 'GET')).statusCode, 405);
      assert.equal((await call('/api/auth/token?grant_type=password', 'POST', {}, { origin: 'https://attacker.invalid' })).statusCode, 403);
      assert.equal((await call('/api/auth/token?grant_type=client_credentials', 'POST', {})).statusCode, 400);
      assert.equal((await call('/api/auth/token?grant_type=password&redirect_to=https://attacker.invalid', 'POST', {})).statusCode, 400);
      assert.equal((await call('/api/auth/token?grant_type=password', 'POST', {})).statusCode, 400);
      assert.equal((await call('/api/auth/logout?scope=local')).statusCode, 401);
      assert.equal((await call('/api/auth/logout?scope=global', 'POST', null, { authorization: 'Bearer aaa.bbb.ccc' })).statusCode, 400);
      assert.equal(calls.length, 0);
    });
    await t.test('upstream errors and missing server configuration return generic errors without secrets', async () => {
      upstream = async () => Response.json({ code: 'invalid_credentials', message: serverKey }, { status: 400 });
      const denied = await call('/api/auth/token?grant_type=password', 'POST', { email, password: 'TEST_ONLY_PASSWORD' });
      assert.equal(denied.statusCode, 400);
      assert.equal(denied.body.code, 'invalid_credentials');
      assert.ok(!JSON.stringify(denied).includes(serverKey));
      upstream = async () => { throw new Error(secretSentinel); };
      const unavailable = await call('/api/auth/token?grant_type=refresh_token', 'POST', { refresh_token: 'TEST_ONLY_REFRESH' });
      assert.equal(unavailable.statusCode, 502);
      assert.ok(!JSON.stringify(unavailable).includes(secretSentinel));
      delete process.env.SUPABASE_SECRET_KEY;
      assert.equal((await call('/api/auth/token?grant_type=password', 'POST', {})).statusCode, 503);
      process.env.SUPABASE_SECRET_KEY = serverKey;
    });
    await t.test('real Supabase SDK can log in, refresh, read user and log out through the gateway', async () => {
      const { privateKey } = await generateKeyPair('ES256');
      const access = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256' })
        .setSubject(user.id).setIssuedAt().setExpirationTime('1 hour').sign(privateKey);
      upstream = async (url, options) => {
        if (url.pathname.endsWith('/logout')) {
          assert.equal(options.headers.Authorization, `Bearer ${access}`);
          assert.equal(url.searchParams.get('scope'), 'local');
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith('/user')) return Response.json(user);
        return Response.json({ access_token: access, refresh_token: 'TEST_ONLY_REFRESH', expires_in: 3600, user });
      };
      const sdk = createClient(config.publicAppUrl, 'server-auth-proxy', {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { fetch: async (url, options) => {
          const endpoint = new URL(url);
          const response = await call(`/api/auth/${endpoint.pathname.slice('/auth/v1/'.length)}${endpoint.search}`,
            options.method, options.body, Object.fromEntries(new Headers(options.headers)));
          return response.statusCode === 204 ? new Response(null, { status: 204 })
            : Response.json(response.body, { status: response.statusCode });
        } },
      });
      try {
        const login = await sdk.auth.signInWithPassword({ email, password: 'TEST_ONLY_PASSWORD' });
        assert.equal(login.error, null);
        assert.equal(login.data.session.access_token, access);
        const refreshed = await sdk.auth.refreshSession();
        assert.equal(refreshed.error, null);
        assert.equal(refreshed.data.session.user.id, user.id);
        assert.equal((await sdk.auth.getUser()).data.user.id, user.id);
        assert.equal((await sdk.auth.signOut({ scope: 'local' })).error, null);
        assert.equal((await sdk.auth.getSession()).data.session, null);
      } finally { sdk.auth.stopAutoRefresh(); }
    });
    await t.test('first-page security header is configured without removing existing deployment settings', async () => {
      const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
      assert.equal(vercel.outputDirectory, 'public');
      assert.equal(vercel.buildCommand, 'npm run build');
      assert.ok(vercel.headers.some(rule => rule.source === '/(.*)' && rule.headers.some(header =>
        header.key.toLowerCase() === 'x-content-type-options' && header.value === 'nosniff')));
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
