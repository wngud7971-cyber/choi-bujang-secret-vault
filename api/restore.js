import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { UUID, recordResourceDenial } from '../src/resource-path.mjs';
import { isRecoveryIdentity, recoveryRpc, validRecoveryResult } from '../src/note-recovery.mjs';

let verifier;
let verifierKey;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const reject = (status, error) => {
    recordResourceDenial('notes', request.method, error);
    return response.status(status).json({ error });
  };
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return reject(401, 'LOGIN_REQUIRED');
  }
  let base;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  try {
    base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
      || base.search || base.hash || config.identityProvider.issuer !== `${base.origin}/auth/v1`
      || typeof secretKey !== 'string' || !secretKey.trim() || secretKey.trim() !== secretKey) throw new Error();
    if (!verifier || verifierKey !== secretKey) {
      verifier = createLoginVerifier({ config, supabaseSecretKey: secretKey });
      verifierKey = secretKey;
    }
  } catch { return reject(503, 'RECOVERY_SERVER_NOT_CONFIGURED'); }
  let identity;
  try { identity = await verifier(authorization); } catch { /* Fail closed. */ }
  if (!identity) return reject(401, 'LOGIN_REQUIRED');
  if (!isRecoveryIdentity(identity)) return reject(403, 'RECOVERY_FORBIDDEN');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return reject(405, 'METHOD_NOT_ALLOWED');
  }
  if (request.url !== '/api/restore') return reject(400, 'INVALID_RECOVERY_PATH');
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) return reject(415, 'JSON_REQUIRED');
  let id;
  let preview;
  try {
    if (typeof request.body === 'string' && Buffer.byteLength(request.body) > 2048) throw new Error();
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['id', 'noteId', 'preview'].includes(key))
      || (Object.hasOwn(body, 'id') === Object.hasOwn(body, 'noteId'))
      || (body.preview !== undefined && typeof body.preview !== 'boolean')) throw new Error();
    id = body.id ?? body.noteId;
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error();
    id = id.toLowerCase();
    preview = body.preview === true;
  } catch { return reject(400, 'INVALID_RECOVERY_REQUEST'); }
  const payload = { p_id: id, p_owner: identity.userId, p_run: identity.runId };
  try {
    const backup = await recoveryRpc(base, secretKey, 'inspect_training_note_backup', payload);
    if (backup.status === 'not_found') return reject(404, 'RECOVERY_BACKUP_NOT_FOUND');
    if (backup.status === 'invalid_backup') return reject(409, 'RECOVERY_BACKUP_INVALID');
    if (backup.status !== 'verified' || !validRecoveryResult(backup, identity, id)) return reject(502, 'RECOVERY_UNAVAILABLE');
    const metadata = { id, ownerId: identity.userId, contentSha256: backup.content_sha256,
      service: 'notes', path: '/api/restore' };
    if (preview) return response.status(200).json({ ...metadata, restored: false });
    const restored = await recoveryRpc(base, secretKey, 'restore_training_note',
      { ...payload, p_expected_sha256: backup.content_sha256 });
    if (restored.status === 'not_found') return reject(404, 'RECOVERY_BACKUP_NOT_FOUND');
    if (['invalid_backup', 'owner_conflict'].includes(restored.status)) return reject(409, 'RECOVERY_CONFLICT');
    if (restored.status !== 'restored' || !validRecoveryResult(restored, identity, id, backup.content_sha256)) {
      return reject(502, 'RECOVERY_UNAVAILABLE');
    }
    return response.status(200).json({ ...metadata, restored: true });
  } catch { return reject(503, 'RECOVERY_STORAGE_NOT_READY'); }
}
