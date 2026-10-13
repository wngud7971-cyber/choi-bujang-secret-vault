import { canonicalBody } from './request-binding.js';

const encode = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const digest = async body => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBody(body))));
const hexDigest = async body => [...decode(await digest(body))].map(v => v.toString(16).padStart(2, '0')).join('');
function credentialJSON(credential) {
  if (!credential) throw new Error('기기 확인을 취소했습니다.');
  const response = credential.response;
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: { clientDataJSON: encode(response.clientDataJSON),
      ...(response.attestationObject ? { attestationObject: encode(response.attestationObject), transports: response.getTransports?.() ?? [] }
        : { authenticatorData: encode(response.authenticatorData), signature: encode(response.signature),
          userHandle: response.userHandle ? encode(response.userHandle) : undefined }) } };
}
function requestOptions(options) {
  return { ...options, challenge: decode(options.challenge),
    allowCredentials: options.allowCredentials?.map(row => ({ ...row, id: decode(row.id) })) };
}
function creationOptions(options) {
  return { ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map(row => ({ ...row, id: decode(row.id) })) };
}
// Stable, localized messages; never display a raw server error or authenticator details.
function deviceError(code) {
  return new Error(code === 'DEVICE_NOT_REGISTERED' || code === 'DEVICE_NOT_APPROVED'
    ? '이 기기는 아직 승인되지 않았습니다. 기기 승인 요청을 보내 주세요.'
    : code === 'DEVICE_BOUND_AUTHENTICATOR_REQUIRED'
      ? '이 기기에만 보관되는 인증 수단이 필요합니다. 동기화되는 인증 수단은 사용할 수 없습니다.'
      : code === 'LOGIN_REQUIRED' ? '로그인이 필요합니다.'
        : code === 'DEVICE_STORAGE_NOT_READY' || code === 'DEVICE_SERVER_NOT_CONFIGURED'
          ? '서버의 기기 등록 설정이 필요합니다. 운영자에게 알려 주세요.'
          : '기기 확인 요청을 완료하지 못했습니다. 다시 시도해 주세요.');
}
async function api(action, token, body, signal) {
  const response = await fetch('/api/device', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }), cache: 'no-store', redirect: 'error', signal });
  const data = await response.json();
  if (!response.ok) throw deviceError(data?.error);
  return data;
}
function supported() {
  if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) {
    throw new Error('이 브라우저에서 기기 인증을 사용할 수 없습니다. HTTPS 주소와 기기 인증 지원을 확인해 주세요.');
  }
}
async function assertion(token, target, signal) {
  supported();
  const packet = await api('options', token, target, signal);
  const credential = await navigator.credentials.get({ publicKey: requestOptions(packet.options), signal });
  return { challengeId: packet.challengeId, credential: credentialJSON(credential) };
}
window.byteBackDevice = Object.freeze({
  async register(token, signal) {
    supported();
    const packet = await api('register', token, {}, signal);
    const credential = await navigator.credentials.create({ publicKey: creationOptions(packet.options), signal });
    return api('finish', token, { challengeId: packet.challengeId, credential: credentialJSON(credential) }, signal);
  },
  async check(token, signal) { return api('verify', token, await assertion(token, { kind: 'status' }, signal), signal); },
  async proof(token, method, path, body, signal) {
    const proof = await assertion(token, { kind: 'request', method, path, bodySha256: await hexDigest(body) }, signal);
    return encode(new TextEncoder().encode(JSON.stringify(proof)));
  },
});
