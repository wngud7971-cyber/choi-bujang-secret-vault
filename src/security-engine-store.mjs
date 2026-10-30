// Separate local audit journal. Never stores credentials, note contents or raw requests.
import {mkdir, lstat, open, readFile} from 'node:fs/promises';
import {resolve, join, dirname, parse} from 'node:path';

const MAX_BYTES = 16 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(value);
const fields = ['id','operationId','subjectId','projectId','deviceId','sessionId','at','operation','decision','reasonCode','ruleIds','outcome','httpStatus'];
export function validEngineRecord(row) {
  return row && Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row,key))
    && uuid(row.id) && uuid(row.operationId) && opaque(row.subjectId) && opaque(row.projectId)
    && opaque(row.deviceId) && opaque(row.sessionId) && typeof row.at === 'string'
    && Number.isFinite(Date.parse(row.at)) && new Date(row.at).toISOString() === row.at
    && ['access-check','notes-read'].includes(row.operation) && ['allow','deny','step_up'].includes(row.decision)
    && typeof row.reasonCode === 'string' && /^[a-z_]{1,80}$/u.test(row.reasonCode)
    && Array.isArray(row.ruleIds) && row.ruleIds.length <= 16 && row.ruleIds.every(id => /^[a-zA-Z0-9_.-]{1,100}$/u.test(id))
    && ['not_executed','pending','succeeded','denied','failed','unknown'].includes(row.outcome)
    && (row.httpStatus === null || Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599);
}
const failure = () => Object.assign(new Error('LOCAL_ENGINE_STORE_FAILED'),{code:'LOCAL_ENGINE_STORE_FAILED'});
async function plainDirectory(directory) {
  for (let path=directory;;path=dirname(path)) {
    const stat=await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
    if (path===parse(path).root) break;
  }
}
export function createSecurityEngineStore(directory) {
  const folder=resolve(directory), path=join(folder,'events.jsonl');
  let queue=Promise.resolve();
  async function prepare() {
    await mkdir(folder,{recursive:true,mode:0o700}); await plainDirectory(folder);
    try { const stat=await lstat(path); if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw failure(); }
    catch(error) {if(error.code!=='ENOENT')throw failure();}
  }
  async function load() {
    await prepare(); let source;
    try {source=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return [];throw failure();}
    if(Buffer.byteLength(source)>MAX_BYTES || source && !source.endsWith('\n'))throw failure();
    const rows=[];
    for(const line of source.split('\n')) {if(!line)continue;let row;try{row=JSON.parse(line);}catch{throw failure();}if(!validEngineRecord(row))throw failure();rows.push(row);}
    return rows;
  }
  return Object.freeze({
    async check(){await queue;await load();},
    append(row) {
      if(!validEngineRecord(row))return Promise.reject(failure());
      const copy=JSON.stringify(row)+'\n';
      const work=queue.then(async()=>{
        await load(); const handle=await open(path,'a',0o600);
        try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size+Buffer.byteLength(copy)>MAX_BYTES)throw failure();await handle.writeFile(copy);await handle.sync();}
        finally{await handle.close();}
      });
      queue=work.catch(()=>{}); return work.catch(()=>{throw failure();});
    },
    async read(subjectId,projectId) {
      await queue;const rows=await load(), latest=new Map();
      for(const row of rows)if(row.subjectId===subjectId&&row.projectId===projectId)latest.set(row.operationId,row);
      return [...latest.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,40);
    },
  });
}
