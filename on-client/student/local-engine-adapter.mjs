// The host owns authentication, device proofs and the audit journal. No credentials in this adapter.
export function createLocalEngineAdapter(runtime) {
  const source=runtime?.engine;
  if(!source||source.source!=='keshev'||typeof source.projectId!=='string'
    ||['readIdentity','readApps','readEvents','readDevices','readSessions','decideAccess'].some(name=>typeof source[name]!=='function'))throw Error('ENGINE_ADAPTER_INVALID');
  return Object.freeze({evidenceMode:'connected',source:'keshev',projectId:source.projectId,
    ...Object.fromEntries(['readIdentity','readApps','readEvents','readDevices','readSessions','decideAccess'].map(name=>[name,(...args)=>source[name](...args)]))});
}
