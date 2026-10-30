// Independent Keshev runtime. This is not an ALEPH SDP session or operator credential.
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import config from '../aleph.config.json' with {type:'json'};
import {createLoginVerifier} from './verify-login.mjs';
import {createDeviceService,createDeviceStore,bindLocalDeviceOrigin,isVerifiedDeviceResult,bodyHash} from './device-approval.mjs';
import {decide, RULE_IDS} from './decider.mjs';
import {createSecurityEngineStore} from './security-engine-store.mjs';

const boundRequests=new WeakMap();
const hash=value=>createHash('sha256').update(value).digest('hex');
const cookieName='keshev_local_session';
const messages={
  LOCAL_ENGINE_NOT_CONFIGURED:'실제 로그인·기기 DB 연결 설정이 없습니다. 실행 안내의 자체 엔진 설정을 확인하세요.',
  LOCAL_ENGINE_LOGIN_REQUIRED:'자체 엔진에 자료실 계정으로 로그인하세요.',
  LOCAL_ENGINE_LOGIN_FAILED:'로그인을 확인하지 못했습니다. 계정과 인증 서버 상태를 확인하세요.',
  LOCAL_ENGINE_DEVICE_REQUIRED:'현재 기기의 실제 서명 확인이 필요합니다. 기기 확인을 누르세요.',
  LOCAL_ENGINE_DEVICE_PENDING:'기기가 아직 승인되지 않았습니다. 기존 기기 승인 절차를 완료한 뒤 다시 확인하세요.',
  LOCAL_ENGINE_DEVICE_FAILED:'기기 서명·등록·승인 상태를 확인하지 못했습니다. 기기 확인 또는 등록 상태를 확인하세요.',
  LOCAL_ENGINE_STORE_FAILED:'자체 엔진 기록을 읽거나 저장하지 못했습니다. 앱 폴더의 권한·디스크 공간을 확인하세요. 기존 기록을 자동 삭제하지 않습니다.',
  LOCAL_ENGINE_UNVERIFIED:'실제 응답이나 현재 계정·기기 연결을 확인하지 못했습니다. 다시 조회하세요.',
  LOCAL_ENGINE_DENIED:'접근 판정기가 이 요청을 거부했습니다. 보안 기록의 사유를 확인하세요.',
  LOCAL_ENGINE_INPUT_INVALID:'요청 형식을 확인하세요.',
  LOCAL_ENGINE_RATE_LIMIT:'로그인 요청이 많습니다. 잠시 뒤 다시 시도하세요.',
  LOCAL_ENGINE_USE_LOCALHOST:'기기 확인은 http://localhost 주소에서 진행하세요. 서버에 표시된 자체 엔진 주소를 여세요.',
};
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
export function localEngineError(error){const code=Object.hasOwn(messages,error?.code)?error.code:'LOCAL_ENGINE_UNVERIFIED';return {code,message:messages[code],retryable:false};}

// Called by the existing notes API only after its own real authentication/device checks.
// An HTTP body cannot install this capability or submit a decision context.
export async function authorizeSecurityEngineRequest(request,identity,device,resource){
  const bound=boundRequests.get(request);
  if(!bound)return {ok:true,enabled:false}; // existing deployed APIs retain their original behavior
  return bound.authorize(identity,device,resource);
}

export function createSecurityEngine({env=process.env,directory=fileURLToPath(new URL('../on-client/.local/security-engine',import.meta.url)),
  clock=()=>Date.now(),fetchImpl=fetch,verifyLogin,deviceStore,notesHandler}={}) {
  const journal=createSecurityEngineStore(directory),sessions=new Map(),attempts=[];
  const projectId='keshev_'+hash(config.publicAppUrl).slice(0,24);
  let base, verifier, devices, configured=false;
  try {
    base=new URL(env.SUPABASE_URL);
    if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash
      ||config.identityProvider.issuer!==base.origin+'/auth/v1'||typeof env.SUPABASE_SECRET_KEY!=='string'
      ||!env.SUPABASE_SECRET_KEY.trim()||env.SUPABASE_SECRET_KEY!==env.SUPABASE_SECRET_KEY.trim())throw Error();
    verifier=verifyLogin??createLoginVerifier({config,supabaseSecretKey:env.SUPABASE_SECRET_KEY});
    devices=deviceStore??createDeviceStore(base,env.SUPABASE_SECRET_KEY);configured=true;
  }catch {configured=false;}
  const subject=identity=>'s_'+hash(JSON.stringify([config.identityProvider.issuer,identity.userId]));
  const owner=identity=>hash(JSON.stringify([config.identityProvider.issuer,identity.userId,null]));
  const stamp=()=>new Date(clock()).toISOString();
  const origin=req=>{
    const url=new URL('http://'+req.headers.host);
    if(url.hostname!=='localhost'||!url.port||Number(url.port)<1024||url.port!==String(Number(url.port)))throw fail('LOCAL_ENGINE_USE_LOCALHOST',400);
    return url.origin;
  };
  const requireConfigured=()=>{if(!configured)throw fail('LOCAL_ENGINE_NOT_CONFIGURED');};
  function sessionFor(req){
    const cookies=String(req?.headers?.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
    if(cookies.length!==1)return null;const value=cookies[0].slice(cookieName.length+1);
    if(!/^[a-f0-9]{64}$/u.test(value))return null;
    const session=sessions.get(hash(value));
    if(!session||session.expiresAt<=clock()){sessions.delete(hash(value));return null;}
    return session;
  }
  async function current(req,requireDevice=true){
    requireConfigured();const session=sessionFor(req);
    if(!session)throw fail('LOCAL_ENGINE_LOGIN_REQUIRED',401);
    let identity;
    try {identity=await verifier(session.authorization);}catch {session.confirmed=false;throw fail('LOCAL_ENGINE_UNVERIFIED');}
    if(identity?.kind!=='student'||identity.userId!==session.identity.userId){session.confirmed=false;throw fail('LOCAL_ENGINE_LOGIN_REQUIRED',401);}
    if(requireDevice){
      if(!session.deviceId)throw fail('LOCAL_ENGINE_DEVICE_REQUIRED',403);
      try{
        const rows=await devices.list(owner(identity));
        const found=Array.isArray(rows)&&rows.find(row=>row.owner_key===owner(identity)
          && hash(owner(identity)+':'+row.id).slice(0,16)===session.deviceId&&row.state==='approved');
        if(!found)throw Error();
      }catch{session.confirmed=false;throw fail('LOCAL_ENGINE_DEVICE_FAILED',403);}
    }
    if(session.expiresAt<=clock())throw fail('LOCAL_ENGINE_LOGIN_REQUIRED',401);
    session.confirmed=requireDevice;return session;
  }
  function sameScope(session,scope){if(scope?.subjectId!==subject(session.identity)||scope.projectId!==projectId)throw fail('LOCAL_ENGINE_UNVERIFIED');}
  function decisionRequest(session,method,path,route){
    return {schema:'aleph.decision.v1',requestId:randomUUID(),classId:'keshev_local',projectId,
      subjectId:subject(session.identity),deviceId:session.deviceId,service:'notes',method,path,route,
      queryLength:0,querySha256:hash(''),at:stamp(),policyRevision:1,deviceRegistered:true,
      stepUp:{verified:false,authAgeSeconds:null},recentEvents:[],
      signals:{source:'none',region:'unknown',network:'unknown',hour:new Date(clock()).getUTCHours()}};
  }
  async function evaluate(session,{method,path,route,operation}){
    const input=decisionRequest(session,method,path,route), result=decide(input);
    if(!exact(result,['schema','requestId','decision','reasonCode','ruleIds'])||result.requestId!==input.requestId
      ||result.schema!==input.schema||!['allow','deny','step_up'].includes(result.decision)
      ||!Array.isArray(result.ruleIds)||result.ruleIds.some(id=>!RULE_IDS.includes(id)))throw fail('LOCAL_ENGINE_UNVERIFIED');
    const record={id:randomUUID(),operationId:input.requestId,subjectId:input.subjectId,projectId,
      deviceId:session.deviceId,sessionId:session.id,at:stamp(),operation,decision:result.decision,
      reasonCode:result.reasonCode,ruleIds:[...result.ruleIds],outcome:result.decision==='allow'
        ?operation==='access-check'?'not_executed':'pending':'denied',httpStatus:null};
    await journal.append(record);return record;
  }
  function event(row){
    const text=row.operation==='access-check'?'업무 앱 접근 판정 · 자료 조회 실행과 별도':'본인 자료실 실제 조회';
    const outcome={not_executed:'판정만 수행',pending:'처리 결과 대기',succeeded:'자료 API 처리 확인',denied:'접근 거부',failed:'자료 API 실패',unknown:'결과 확인 불가'}[row.outcome];
      return {id:row.id,kind:'access',at:row.at,appId:'library',summary:text+' · '+outcome,
      evidence:[{id:'request-'+row.operationId,text:'출처: '+(row.reasonCode==='api_request_rejected'?'기존 자료실 API의 거부':'케셰브 자체 엔진 판정')+' · '+row.decision+' · '+row.reasonCode},
        {id:'result-'+row.id,text:'결과: '+outcome+(row.httpStatus===null?'':' · HTTP '+row.httpStatus)}],
      rules:row.ruleIds.map((id,i)=>({id:'rule-'+i,text:id})),state:{access:row.outcome==='failed'||row.outcome==='unknown'?'unknown':row.decision==='allow'?'allowed':'denied',session:'unknown',device:'unknown'},supportedActions:[]};
  }
  const engine=Object.freeze({evidenceMode:'connected',projectId,source:'keshev',
    async readIdentity({request}={}){const s=await current(request);await journal.check();return {user:{id:subject(s.identity),label:'확인된 자료실 계정'},
      device:{id:s.deviceId,label:'서명 확인된 현재 기기 · PC 안전 판정 아님',status:'unknown'},session:{id:s.id,status:'active'}};},
    async readApps(scope,{request}={}){const s=await current(request);sameScope(s,scope);return [{id:'library',name:'기존 자료실 · 자체 엔진 경유',subjectId:scope.subjectId,projectId}];},
    async readEvents(scope,{request}={}){const s=await current(request);sameScope(s,scope);const rows=await journal.read(subject(s.identity),projectId);await current(request);return rows.map(row=>({...event(row),subjectId:scope.subjectId,projectId}));},
    async readDevices(scope,options={}){const s=await current(options.request);sameScope(s,scope);return [{...(await engine.readIdentity(options)).device,subjectId:scope.subjectId,projectId}];},
    async readSessions(scope,options={}){const s=await current(options.request);sameScope(s,scope);return [{id:s.id,status:'active',subjectId:scope.subjectId,projectId}];},
    async decideAccess(input,scope,{request}={}){
      const s=await current(request);sameScope(s,scope);if(input.appId!=='library')throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
      // A server-owned canonical route represents the API's atomic owner-filtered list.
      const row=await evaluate(s,{method:'GET',path:'/api/notes/owners/'+subject(s.identity),route:'GET /api/notes/owners/:ownerId',operation:'access-check'});
      await current(request);return {appId:'library',decision:row.decision==='step_up'?'challenge':row.decision,
        reason:'자체 엔진 판정: '+row.reasonCode+' · 실제 자료 조회와 별도',checkedAt:row.at,subjectId:scope.subjectId,projectId,requestId:input.requestId};
    },
  });
  return Object.freeze({engine,
    modeFor(req){const s=sessionFor(req);return s?.confirmed===true?'connected':'disconnected';},
    async status(req){
      let code=configured?'LOCAL_ENGINE_LOGIN_REQUIRED':'LOCAL_ENGINE_NOT_CONFIGURED';
      const s=sessionFor(req);let connected=false;
      if(s){try{await current(req);await journal.check();code='LOCAL_ENGINE_CONNECTED';connected=true;}catch(error){s.confirmed=false;code=localEngineError(error).code;}}
      return {source:'keshev',configured,connected,authenticated:!!s,deviceVerified:connected,code,
        message:connected?'케셰브 자체 엔진 연결됨 · 실제 계정·승인 기기 확인':messages[code],checkedAt:stamp(),
        sdp:'not_used',xdr:'not_connected',actions:'not_supported'};
    },
    async handle(req,body){
      const path=req.url;
      try {
        if(path==='/api/local-engine/status'&&req.method==='GET')return {status:200,data:await this.status(req)};
        if(req.method!=='POST')throw fail('LOCAL_ENGINE_INPUT_INVALID',405);
        const localOrigin=origin(req);
        if(req.headers.authorization!==undefined)throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
        if(path==='/api/local-engine/logout'){
          if(!exact(body,[]))throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
          const s=sessionFor(req);if(s)for(const [key,value]of sessions)if(value===s)sessions.delete(key);
          return {status:200,data:{loggedOut:true},cookie:cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'};
        }
        requireConfigured();
        if(path==='/api/local-engine/login'){
          if(!exact(body,['email','password'])||typeof body.email!=='string'||body.email.length>254||!body.email.includes('@')
            ||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
          while(attempts.length&&attempts[0]<clock()-60000)attempts.shift();if(attempts.length>=8)throw fail('LOCAL_ENGINE_RATE_LIMIT',429);attempts.push(clock());
          const response=await fetchImpl(new URL('/auth/v1/token?grant_type=password',base),{method:'POST',redirect:'error',
            headers:{apikey:env.SUPABASE_SECRET_KEY,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
          if(!response.ok)throw fail('LOCAL_ENGINE_LOGIN_FAILED',401);
          const raw=await response.text();if(raw.length>32768)throw fail('LOCAL_ENGINE_UNVERIFIED');const token=JSON.parse(raw).access_token;
          if(typeof token!=='string'||token.length>8192)throw fail('LOCAL_ENGINE_UNVERIFIED');
          const authorization='Bearer '+token,identity=await verifier(authorization);
          if(identity?.kind!=='student')throw fail('LOCAL_ENGINE_LOGIN_FAILED',401);
          const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
          if(!Number.isSafeInteger(claims.exp)||claims.exp*1000<=clock())throw fail('LOCAL_ENGINE_LOGIN_FAILED',401);
          for(const [key,s]of sessions)if(s.expiresAt<=clock())sessions.delete(key);
          if(sessions.size>=8)throw fail('LOCAL_ENGINE_RATE_LIMIT',429);
          const previous=sessionFor(req);if(previous)for(const [key,s]of sessions)if(s===previous)sessions.delete(key);
          const opaque=randomBytes(32).toString('hex');
          sessions.set(hash(opaque),{id:randomUUID(),identity,authorization,expiresAt:claims.exp*1000,deviceId:null,confirmed:false});
          return {status:200,data:{authenticated:true,deviceVerified:false},cookie:cookieName+'='+opaque+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.max(1,Math.floor((claims.exp*1000-clock())/1000))};
        }
        const session=await current(req,false), service=createDeviceService({config:{...config,publicAppUrl:localOrigin+'/'},store:devices,clock});
        if(path==='/api/local-engine/device/options'){
          if(!exact(body,['kind'])||!['status','registration','request'].includes(body.kind))throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
          const data=body.kind==='registration'?await service.registration(session.identity,session.authorization)
            :await service.options(body.kind==='request'?{kind:'request',method:'GET',path:'/api/notes',bodySha256:bodyHash(undefined)}:{kind:'status'},session.identity,session.authorization);
          return {status:200,data};
        }
        if(path==='/api/local-engine/device/verify'||path==='/api/local-engine/device/register'){
          if(!exact(body,['proof']))throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
          if(path.endsWith('/register'))return {status:200,data:await service.finish(body.proof,session.identity,session.authorization)};
          const result=await service.verify(body.proof,session.identity,session.authorization);
          if(!result.approved){session.confirmed=false;throw fail('LOCAL_ENGINE_DEVICE_PENDING',403);}
          session.deviceId=result.deviceId;await current(req);await journal.check();return {status:200,data:{verified:true}};
        }
        if(path==='/api/local-engine/notes/read'){
          if(!exact(body,['proof']))throw fail('LOCAL_ENGINE_INPUT_INVALID',400);
          await current(req);
          const facade=Object.create(req);
          Object.assign(facade,{url:'/api/notes',method:'GET',body:undefined,headers:{...req.headers,authorization:session.authorization,
            'x-byteback-device-proof':Buffer.from(JSON.stringify(body.proof)).toString('base64url')}});
          bindLocalDeviceOrigin(facade,localOrigin);
          let record=null,status=500,result=null;
          boundRequests.set(facade,{authorize:async(identity,device,resource)=>{
            if(identity.kind!=='student'||identity.userId!==session.identity.userId||!isVerifiedDeviceResult(device)
              ||device.deviceId!==session.deviceId||device.ownerKey!==owner(identity)||resource.kind!=='notes')throw fail('LOCAL_ENGINE_UNVERIFIED');
            await current(req);
            record=await evaluate(session,{method:'GET',path:'/api/notes/owners/'+subject(identity),route:'GET /api/notes/owners/:ownerId',operation:'notes-read'});
            return record.decision==='allow'?{ok:true,enabled:true}:{ok:false,status:403,error:'LOCAL_ENGINE_DENIED'};
          }});
          const response={setHeader(){},status(value){status=value;return this;},json(value){result=value;return value;}};
          try{
            const handler=notesHandler??(await import('../api/notes.js')).default;await handler(facade,response);
            let fresh=true;try{await current(req);}catch{fresh=false;}
            const succeeded=record!==null&&status===200&&Array.isArray(result)&&fresh;
            if(record)await journal.append({...record,id:randomUUID(),at:stamp(),outcome:!fresh?'unknown':succeeded?'succeeded':status===403?'denied':'failed',httpStatus:status});
            else if(status>=400)await journal.append({id:randomUUID(),operationId:randomUUID(),subjectId:subject(session.identity),projectId,
              deviceId:session.deviceId,sessionId:session.id,at:stamp(),operation:'notes-read',decision:'deny',reasonCode:'api_request_rejected',ruleIds:[],
              outcome:status<500?'denied':'failed',httpStatus:status});
            if(!succeeded)throw fail(status===403?'LOCAL_ENGINE_DEVICE_FAILED':'LOCAL_ENGINE_UNVERIFIED',status===403?403:503);
            return {status:200,data:{operationId:record.operationId,httpStatus:status,count:result.length,checkedAt:stamp(),source:'keshev',message:'기존 자료실 API가 본인 자료 조회를 처리했습니다. 본문은 이 화면에 표시하지 않습니다.'}};
          }finally{boundRequests.delete(facade);}
        }
        throw fail('LOCAL_ENGINE_INPUT_INVALID',404);
      }catch(error){
        const known=Object.hasOwn(messages,error?.code);
        return {status:known?error.status??503:503,error:localEngineError(known?error:fail(path.includes('/device/')?'LOCAL_ENGINE_DEVICE_FAILED':'LOCAL_ENGINE_UNVERIFIED'))};
      }
    },
  });
}
