import {ephemeralTestValue} from './helpers/ephemeral-credentials.mjs';
const credentialFixture1 = ephemeralTestValue();

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {encodeCBOR} from '@levischuck/tiny-cbor';
import {PGlite} from '@electric-sql/pglite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import config from '../aleph.config.json' with {type:'json'};
import {sha256} from '../src/device-approval.mjs';
import {createSecurityEngine,authorizeSecurityEngineRequest} from '../src/security-engine.mjs';
import {createSecurityEngineStore} from '../src/security-engine-store.mjs';
import {createLocalEngineAdapter} from '../on-client/student/local-engine-adapter.mjs';
import {createOnServer} from '../on-client/src/server.mjs';

const b64=value=>Buffer.from(value).toString('base64url');
const digest=value=>Buffer.from(sha256(value),'hex');
async function serve(t,runtime){
  const server=createOnServer({engine:createLocalEngineAdapter(runtime),localEngine:runtime});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin='http://localhost:'+server.address().port;let cookie='';
  return {origin,async call(path,body,headers={}){
    const result=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),
      ...(body===undefined?{}:{origin,'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const issued=result.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];
    return {status:result.status,text:await result.text()};
  }};
}
const parsed=response=>({...response,body:JSON.parse(response.text)});

test('unconfigured engine stays disconnected; local HTTP does not fabricate identity or allow cross-origin login',async t=>{
  const runtime=createSecurityEngine({env:{},directory:await mkdtemp(join(tmpdir(),'keshev-unconfigured-'))});
  const client=await serve(t,runtime);
  const status=parsed(await client.call('/api/local-engine/status'));
  assert.equal(status.body.data.connected,false);assert.equal(status.body.meta.mode,'disconnected');
  assert.equal(status.body.data.code,'LOCAL_ENGINE_NOT_CONFIGURED');
  const me=parsed(await client.call('/api/me'));assert.equal(me.status,503);assert.equal(me.body.error.code,'LOCAL_ENGINE_NOT_CONFIGURED');
  assert.equal(parsed(await client.call('/api/local-engine/login',{email:'student@example.test',password:'fixture'})).status,503);
  assert.equal(parsed(await client.call('/api/local-engine/login',{email:'student@example.test',password:'fixture'},{origin:'https://unrelated.example'})).status,403);
  assert.equal(parsed(await client.call('/api/local-engine/login',{email:'student@example.test',password:'fixture',deviceRegistered:true})).status,400);
  const page=await client.call('/');assert.match(page.text,/data-engine="keshev"/u);
  assert.deepEqual(await authorizeSecurityEngineRequest({}, {}, {}, {}),{ok:true,enabled:false});
});

test('signed JWT + real WebAuthn + existing notes API + journal + existing screen API; synthetic accounts only',async t=>{
  const nativeFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
  const database=await PGlite.create();
  t.after(async()=>{globalThis.fetch=nativeFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;await database.close();});
  await database.exec('create role anon; create role authenticated; create role service_role;');
  await database.exec(await readFile(new URL('../docs/STEP11_DATABASE.sql',import.meta.url),'utf8'));
  const base=new URL(config.identityProvider.issuer).origin,secret='TEST_ONLY_SERVER_KEY';
  process.env.SUPABASE_URL=base;process.env.SUPABASE_SECRET_KEY=secret;
  const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const keys=await generateKeyPair('ES256'),jwk={...await exportJWK(keys.publicKey),kid:'engine-test-key',alg:'ES256'};
  const token=await new SignJWT({role:'authenticated',session_id:'33333333-3333-4333-8333-333333333333'})
    .setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer(config.identityProvider.issuer).setAudience(config.identityProvider.audience)
    .setSubject(actor).setIssuedAt().setExpirationTime('10 minutes').sign(keys.privateKey);
  let returnForeign=false,notesRead=0;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.hostname==='localhost')return nativeFetch(input,options);
    assert.equal(url.origin,base,'unexpected external request');
    const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    if(url.pathname==='/auth/v1/token')return reply({access_token:token,token_type:'bearer',expires_in:600});
    if(url.pathname==='/auth/v1/.well-known/jwks.json')return reply({keys:[jwk]});
    if(url.pathname==='/rest/v1/training_devices'){
      const owner=url.searchParams.get('owner_key')?.slice(3);return reply((await database.query('select * from public.training_devices where owner_key=$1',[owner])).rows);
    }
    if(url.pathname==='/rest/v1/training_device_challenges')return reply((await database.query('select * from public.training_device_challenges where id=$1 and owner_key=$2',
      [url.searchParams.get('id')?.slice(3),url.searchParams.get('owner_key')?.slice(3)])).rows);
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const name=url.pathname.split('/').at(-1);assert.ok(['issue_training_device_challenge','consume_training_device_challenge','register_training_device'].includes(name));
      const record=JSON.parse(options.body).p_record;
      return reply((await database.query(`select public.${name}($1::jsonb) as result`,[JSON.stringify(record)])).rows[0].result);
    }
    if(url.pathname==='/rest/v1/training_notes'){
      notesRead++;assert.equal(url.searchParams.get('owner_id'),'eq.'+actor,'existing atomic owner predicate must remain');
      return reply([{id:'44444444-4444-4444-8444-444444444444',owner_id:returnForeign?other:actor,title:'PRIVATE_TEST_TITLE',content:'PRIVATE_TEST_CONTENT'}]);
    }
    assert.fail('unexpected provider path');
  };
  const directory=await mkdtemp(join(tmpdir(),'keshev-engine-'));
  const runtime=createSecurityEngine({env:process.env,directory,fetchImpl:globalThis.fetch});
  const client=await serve(t,runtime);
  const request=async(path,body,headers)=>parsed(await client.call('/api/local-engine/'+path,body,headers));
  const login=await request('login',{email:'fixture@example.test',password:credentialFixture1});
  assert.equal(login.status,200,login.text);assert.doesNotMatch(login.text,/access_token|refresh_token/u);
  assert.equal(parsed(await client.call('/api/me')).status,403,'login alone must not establish a verified device');
  const owner=sha256(JSON.stringify([config.identityProvider.issuer,actor,null]));
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),deviceJwk=publicKey.export({format:'jwk'}),id=b64(randomBytes(32));
  const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(deviceJwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(deviceJwk.y,'base64url'))]]));
  await database.query('insert into public.training_devices(id,owner_key,public_key,counter,state) values($1,$2,$3,0,$4)',[id,owner,b64(cose),'pending']);
  let counter=0;
  function proof(packet,{origin=client.origin,challenge=packet.options.challenge,key=privateKey}={}){
    const data=Buffer.from(JSON.stringify({type:'webauthn.get',origin,challenge})),count=Buffer.alloc(4);count.writeUInt32BE(++counter);
    const auth=Buffer.concat([digest(new URL(client.origin).hostname),Buffer.from([0x05]),count]);
    return {challengeId:packet.challengeId,credential:{id,rawId:id,type:'public-key',clientExtensionResults:{},response:{
      clientDataJSON:b64(data),authenticatorData:b64(auth),signature:b64(sign('sha256',Buffer.concat([auth,digest(data)]),key))}}};
  }
  let packet=await request('device/options',{kind:'status'});assert.equal(packet.status,200,packet.text);
  assert.equal((await request('device/verify',{proof:proof(packet.body.data)})).body.error.code,'LOCAL_ENGINE_DEVICE_PENDING');
  assert.equal((await request('status')).body.data.connected,false);
  await database.query("update public.training_devices set state='approved' where id=$1",[id]);
  packet=await request('device/options',{kind:'status'});
  assert.equal((await request('device/verify',{proof:proof(packet.body.data,{origin:'https://wrong.example'})})).status,503);
  packet=await request('device/options',{kind:'status'});
  assert.equal((await request('device/verify',{proof:proof(packet.body.data)})).status,200);
  const connected=await request('status');assert.equal(connected.body.data.connected,true,connected.text);
  const me=parsed(await client.call('/api/me'));assert.equal(me.status,200,me.text);assert.equal(me.body.meta.engineSource,'keshev');
  assert.equal(me.body.meta.mode,'connected');assert.equal(me.body.data.device.status,'unknown','registered device is not an OS compliance verdict');
  const apps=parsed(await client.call('/api/apps'));assert.equal(apps.status,200,apps.text);assert.equal(apps.body.data[0].id,'library');
  const decision=parsed(await client.call('/api/access',{appId:'library'}));assert.equal(decision.body.data.decision,'allow',decision.text);
  assert.equal(notesRead,0,'access decision must not claim or perform a data read');
  packet=await request('device/options',{kind:'request'});
  const oneProof=proof(packet.body.data),read=await request('notes/read',{proof:oneProof});
  assert.equal(read.status,200,read.text);assert.equal(read.body.data.count,1);assert.equal(notesRead,1);
  assert.doesNotMatch(read.text,/PRIVATE_TEST_|owner_id|access_token/u,'only a count/result is projected');
  const replay=await request('notes/read',{proof:oneProof});assert.notEqual(replay.status,200);assert.equal(notesRead,1,'replayed signature cannot reach data');
  returnForeign=true;packet=await request('device/options',{kind:'request'});
  const foreign=await request('notes/read',{proof:proof(packet.body.data)});assert.notEqual(foreign.status,200);assert.doesNotMatch(foreign.text,/PRIVATE_TEST_/u);
  const events=parsed(await client.call('/api/events'));assert.equal(events.status,200,events.text);
  assert.ok(events.body.data.some(row=>row.summary.includes('자료 API 처리 확인')));
  assert.ok(events.body.data.some(row=>row.summary.includes('자료 API 실패')));
  assert.ok(events.body.data.some(row=>row.summary.includes('접근 거부')),'replayed proof rejection must be visible in the audit view');
  const journal=await readFile(join(directory,'events.jsonl'),'utf8');
  for(const forbidden of [token,secret,actor,other,credentialFixture1,'PRIVATE_TEST_TITLE','PRIVATE_TEST_CONTENT'])assert.ok(!journal.includes(forbidden),'sensitive data in journal');
  const restored=createSecurityEngineStore(directory);assert.ok((await restored.read(me.body.data.user.id,runtime.engine.projectId)).length>=3,'journal survives a new store instance');
  await database.query("update public.training_devices set state='revoked' where id=$1",[id]);
  assert.equal(parsed(await client.call('/api/me')).status,403,'revocation must invalidate subsequent views');
  assert.equal((await request('status')).body.data.connected,false);
  await request('logout',{});assert.equal((await request('status')).body.data.authenticated,false);
});

test('corrupted existing journal is reported without replacing or deleting it',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keshev-audit-')),path=join(directory,'events.jsonl');
  const original='{incomplete';await writeFile(path,original);
  await assert.rejects(createSecurityEngineStore(directory).check(),/LOCAL_ENGINE_STORE_FAILED/u);
  assert.equal(await readFile(path,'utf8'),original);
});
