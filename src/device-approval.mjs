import { createHash, randomUUID } from 'node:crypto';
import { generateRegistrationOptions, generateAuthenticationOptions,
  verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { canonicalBody } from '../public/request-binding.js';
import { parseResourceTarget } from './resource-path.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9-]{36}$/u;
const ID = /^[A-Za-z0-9_-]{1,2048}$/u;
export const DEVICE_RULE_IDS = Object.freeze(['device.server_approval', 'device.request_binding']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function bodyHash(body) {
  return sha256(canonicalBody(typeof body === 'string' ? JSON.parse(body) : body));
}
const ownerKey = (identity, config) => sha256(JSON.stringify([
  identity.kind === 'judge' ? config.judgeIssuer : config.identityProvider.issuer,
  identity.userId, identity.runId ?? null,
]));
const fail = (status, error) => Object.assign(new Error(error), { status });
function targetAllowed(method, path, config) {
  if (typeof path !== 'string' || path.length > 300 || !path.startsWith('/api/') || path.includes('#')) return false;
  if (method === 'POST' && path === '/api/restore') return true;
  const service = path.startsWith('/api/notes') ? 'notes' : path.startsWith('/api/announcements') ? 'announcements' : null;
  if (!service) return false;
  const target = parseResourceTarget(path, service);
  if (target.error) return false;
  const shape = target.ownerId
    ? `/api/notes/owners/:ownerId${target.id ? '/:id' : ''}`
    : `/api/${service}${target.id ? '/:id' : ''}`;
  return config.allowedRoutes.includes(`${method} ${shape}`);
}

export function createDeviceStore(base, secretKey) {
  const send = async (path, method = 'GET', body, params) => {
    const url = new URL('/rest/v1/' + path, base);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const response = await fetch(url, { method, headers: { apikey: secretKey,
      'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw fail(503, 'DEVICE_STORAGE_NOT_READY');
    return response.json();
  };
  return {
    list: owner => send('training_devices', 'GET', undefined, {
      owner_key: `eq.${owner}`, select: 'id,owner_key,public_key,counter,state', limit: '21',
    }),
    async challenge(id, owner) {
      const rows = await send('training_device_challenges', 'GET', undefined,
        { id: `eq.${id}`, owner_key: `eq.${owner}`, select: '*', limit: '1' });
      return rows[0];
    },
    async saveChallenge(row) { await send('rpc/issue_training_device_challenge', 'POST', { p_record: row }); },
    register: record => send('rpc/register_training_device', 'POST', { p_record: record }),
    consume: record => send('rpc/consume_training_device_challenge', 'POST', { p_record: record }),
  };
}

// Server owns the challenge, identity binding, registry and approval decision.
export function createDeviceService({ config, store, clock = () => Date.now() } = {}) {
  const app = new URL(config.publicAppUrl);
  const origin = app.origin;
  const rpID = app.hostname;
  const principal = identity => ownerKey(identity, config);
  const credentials = async identity => {
    const owner = principal(identity);
    const rows = await store.list(owner);
    if (!Array.isArray(rows) || rows.length > 20) throw fail(409, 'DEVICE_LIMIT_REACHED');
    if (rows.some(row => !row || !ID.test(row.id ?? '') || row.owner_key !== owner
        || !ID.test(row.public_key ?? '') || !Number.isSafeInteger(row.counter) || row.counter < 0 || row.counter > 4294967295
        || !['pending', 'approved', 'revoked'].includes(row.state))) throw fail(503, 'DEVICE_STORAGE_NOT_READY');
    return rows;
  };
  const save = async (options, identity, authorization, kind, target = {}) => {
    const id = randomUUID();
    await store.saveChallenge({ id, owner_key: principal(identity), token_sha256: sha256(authorization),
      challenge: options.challenge, kind, method: target.method ?? null, path: target.path ?? null,
      body_sha256: target.bodySha256 ?? null });
    return { challengeId: id, options };
  };
  const read = async (id, identity, authorization, kind) => {
    if (!UUID.test(id ?? '')) throw fail(400, 'INVALID_DEVICE_PROOF');
    const challenge = await store.challenge(id, principal(identity));
    if (!challenge || challenge.id !== id || challenge.owner_key !== principal(identity)
        || challenge.kind !== kind || challenge.used !== false || !ID.test(challenge.challenge ?? '')
        || challenge.token_sha256 !== sha256(authorization) || !Number.isFinite(Date.parse(challenge.expires_at))
        || Date.parse(challenge.expires_at) <= clock()) throw fail(403, 'DEVICE_CHALLENGE_EXPIRED');
    return challenge;
  };
  async function authenticate(proof, identity, authorization, kind, target) {
    if (!proof || typeof proof !== 'object' || !ID.test(proof.credential?.id ?? '')) throw fail(403, 'DEVICE_SIGNATURE_REQUIRED');
    const challenge = await read(proof.challengeId, identity, authorization, kind);
    if (target && (challenge.method !== target.method || challenge.path !== target.path
        || challenge.body_sha256 !== target.bodySha256)) throw fail(403, 'DEVICE_REQUEST_CHANGED');
    const credential = (await credentials(identity)).find(row => row.id === proof.credential.id);
    if (!credential) throw fail(403, 'DEVICE_NOT_REGISTERED');
    if (kind === 'request' && credential.state !== 'approved') throw fail(403, 'DEVICE_NOT_APPROVED');
    let result;
    try {
      result = await verifyAuthenticationResponse({ response: proof.credential,
        expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
        requireUserVerification: true, credential: { id: credential.id,
          publicKey: new Uint8Array(Buffer.from(credential.public_key, 'base64url')), counter: credential.counter } });
    } catch { throw fail(403, 'DEVICE_SIGNATURE_INVALID'); }
    if (!result.verified || result.authenticationInfo.credentialDeviceType !== 'singleDevice'
        || result.authenticationInfo.credentialBackedUp) throw fail(403, 'DEVICE_SIGNATURE_INVALID');
    const consumed = await store.consume({ challenge_id: challenge.id, owner_key: principal(identity),
      token_sha256: sha256(authorization), credential_id: credential.id, kind,
      old_counter: credential.counter, new_counter: result.authenticationInfo.newCounter });
    if (!consumed?.ok) throw fail(403, 'DEVICE_PROOF_REJECTED');
    return { approved: consumed.state === 'approved', state: consumed.state };
  }
  return {
    async status(identity) {
      const rows = await credentials(identity);
      return { approved: false, state: 'verification_required',
        pendingCount: rows.filter(row => row.state === 'pending').length,
        registeredCount: rows.filter(row => row.state === 'approved').length };
    },
    async registration(identity, authorization) {
      const rows = await credentials(identity);
      if (rows.length >= 20) throw fail(409, 'DEVICE_LIMIT_REACHED');
      const options = await generateRegistrationOptions({ rpName: 'BYTE BACK', rpID,
        userID: new Uint8Array(Buffer.from(principal(identity), 'hex')),
        userName: 'BYTE BACK account', userDisplayName: '내 자료실 계정',
        supportedAlgorithmIDs: [-7], attestationType: 'none', timeout: 120000,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
        excludeCredentials: rows.map(row => ({ id: row.id })) });
      return save(options, identity, authorization, 'registration');
    },
    async finish(proof, identity, authorization) {
      const challenge = await read(proof?.challengeId, identity, authorization, 'registration');
      let result;
      try {
        result = await verifyRegistrationResponse({ response: proof.credential,
          expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
          requireUserVerification: true });
      } catch { throw fail(403, 'DEVICE_REGISTRATION_INVALID'); }
      const info = result.registrationInfo;
      if (!result.verified || !info || info.credentialDeviceType !== 'singleDevice' || info.credentialBackedUp) {
        throw fail(403, 'DEVICE_BOUND_AUTHENTICATOR_REQUIRED');
      }
      const registered = await store.register({ challenge_id: challenge.id, owner_key: principal(identity),
        token_sha256: sha256(authorization), credential_id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter });
      if (!registered?.ok) throw fail(409, 'DEVICE_REGISTRATION_REJECTED');
      return { approved: false, state: 'pending', requestId: sha256(info.credential.id).slice(0, 16) };
    },
    async options(body, identity, authorization) {
      const kind = body?.kind;
      if (!['status', 'request'].includes(kind)) throw fail(400, 'INVALID_DEVICE_REQUEST');
      if (kind === 'request' && (!targetAllowed(body.method, body.path, config) || !HASH.test(body.bodySha256 ?? ''))) {
        throw fail(400, 'INVALID_DEVICE_TARGET');
      }
      const rows = (await credentials(identity)).filter(row => kind === 'status' || row.state === 'approved');
      if (!rows.length) throw fail(403, 'DEVICE_NOT_REGISTERED');
      const options = await generateAuthenticationOptions({ rpID, timeout: 120000,
        userVerification: 'required', allowCredentials: rows.map(row => ({ id: row.id, transports: ['internal'] })) });
      return save(options, identity, authorization, kind, body);
    },
    verify: (proof, identity, authorization) => authenticate(proof, identity, authorization, 'status'),
    protect: (proof, identity, authorization, target) => authenticate(proof, identity, authorization, 'request', target),
  };
}

export async function enforceDeviceRequest(request, identity, config, base, secretKey) {
  if (config.step < 11) return { ok: true };
  try {
    const encoded = request.headers?.['x-byteback-device-proof'];
    if (typeof encoded !== 'string' || encoded.length > 16000 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
      throw fail(403, 'DEVICE_SIGNATURE_REQUIRED');
    }
    const proof = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const service = createDeviceService({ config, store: createDeviceStore(base, secretKey) });
    const result = await service.protect(proof, identity, request.headers.authorization,
      { method: request.method, path: request.url,
        bodySha256: bodyHash(['GET', 'DELETE'].includes(request.method) ? undefined : request.body) });
    if (!result.approved) throw fail(403, 'DEVICE_NOT_APPROVED');
    return { ok: true };
  } catch (error) {
    return { ok: false, status: error.status ?? 403, error: error.status ? error.message : 'INVALID_DEVICE_PROOF' };
  }
}
