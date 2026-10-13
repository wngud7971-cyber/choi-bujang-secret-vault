// No imports, keys, tokens, storage, network or authenticator calls.
export function createAccessGate() {
  let revision = 0;
  let state = 'signed_out';
  let operation = null;
  const snapshot = () => Object.freeze({ revision, state, canRead: state === 'approved' });
  const lock = next => {
    if (!['signed_out', 'unverified', 'offline', 'error'].includes(next)) throw new TypeError('invalid_lock_state');
    revision++;
    state = next;
    operation = null;
    return snapshot();
  };
  const begin = next => {
    if (!['register', 'check'].includes(next)) throw new TypeError('invalid_device_operation');
    if (state === 'signed_out' || state === 'offline') throw new Error('device_check_unavailable');
    revision++;
    state = 'checking';
    operation = next;
    return snapshot();
  };
  const complete = (version, result) => {
    if (version !== revision || state !== 'checking') return snapshot();
    if (operation === 'check' && result?.approved === true && result.state === 'approved') state = 'approved';
    else if (result?.approved === false && result.state === 'pending') state = 'pending';
    else if (result?.approved === false && result.state === 'revoked') state = 'revoked';
    else state = 'error';
    operation = null;
    return snapshot();
  };
  return Object.freeze({ snapshot, lock, begin, complete });
}
