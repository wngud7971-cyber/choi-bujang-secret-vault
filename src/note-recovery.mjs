import { createHash } from 'node:crypto';
import { UUID } from './resource-path.mjs';

export { RECOVERY_RULE_IDS } from './policy-rule-ids.mjs';
export const contentHash = (title, content) => createHash('sha256')
  .update(title, 'utf8').update(Buffer.from([0])).update(content, 'utf8').digest('hex');

export function isRecoveryIdentity(identity) {
  return identity?.kind === 'judge' && identity.identity === 'b'
    && UUID.test(identity.userId ?? '') && UUID.test(identity.runId ?? '');
}

export async function recoveryRpc(base, secretKey, name, payload) {
  if (!['create_training_note_with_backup', 'inspect_training_note_backup', 'restore_training_note'].includes(name)) {
    throw new Error('RECOVERY_UNAVAILABLE');
  }
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers: { apikey: secretKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('RECOVERY_UNAVAILABLE');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('RECOVERY_UNAVAILABLE');
    return data;
  } catch { throw new Error('RECOVERY_UNAVAILABLE'); }
}

export function validRecoveryResult(result, identity, id, hash) {
  return result?.id === id && result.owner_id === identity.userId
    && result.run_id === identity.runId && /^[a-f0-9]{64}$/u.test(result.content_sha256 ?? '')
    && (hash === undefined || result.content_sha256 === hash);
}

export async function createBackedUpNote({ base, secretKey, identity, id, title, content }) {
  if (!isRecoveryIdentity(identity)) throw new Error('RECOVERY_FORBIDDEN');
  const result = await recoveryRpc(base, secretKey, 'create_training_note_with_backup',
    { p_id: id, p_owner: identity.userId, p_run: identity.runId, p_title: title, p_content: content });
  if (result.status === 'conflict') return { status: 'conflict' };
  if (result.status !== 'created' || !validRecoveryResult(result, identity, id, contentHash(title, content))) {
    throw new Error('RECOVERY_UNAVAILABLE');
  }
  return { status: 'created', id };
}
