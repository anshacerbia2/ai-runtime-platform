import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ValidationInput,validateContract,withinPayloadBudget,canonicalJson,describePayload,Profile,schemaBundle,examples,CONTRACT_VERSION } from '@ai-runtime/contracts';
import { digest } from './db.js';
import type { LocalConfig } from './config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function buildServer(pool:Pool,config:LocalConfig,logging=false){
  const app=Fastify({logger:logging?{level:'info',redact:['req.headers.authorization','req.headers.cookie']}:false,bodyLimit:65536,requestTimeout:15000,genReqId:()=>randomUUID()});
  const identities=new WeakMap<object,string>();
  const error=(reply:any,status:number,code:string,message:string,requestId:string)=>reply.code(status).send({error:{code,message,retryable:status===503,request_id:requestId,execution_id:null}});
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Request-ID',request.id).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const host=request.headers.host?.split(':')[0];
    if(host&&!['127.0.0.1','localhost'].includes(host))return error(reply,403,'POLICY_DENIED','Local Contract Lab only.',request.id);
    if(request.headers.origin&&!['http://127.0.0.1:'+config.webPort,'http://localhost:'+config.webPort,'http://127.0.0.1:'+config.apiPort].includes(request.headers.origin))return error(reply,403,'POLICY_DENIED','Origin not allowed.',request.id);
    if(request.url.split('?')[0]==='/health/live')return;
    const authorization=request.headers.authorization??'';
    if(!authorization.startsWith('Bearer ')||authorization.length>512)return error(reply,401,'UNAUTHENTICATED','Local application credential required.',request.id);
    const result=await pool.query('SELECT id FROM m0.applications WHERE token_sha256=$1',[digest(authorization.slice(7))]);
    if(!result.rows.length)return error(reply,401,'UNAUTHENTICATED','Invalid application credential.',request.id);
    identities.set(request,result.rows[0].id);
  });
  app.setErrorHandler((err:any,request,reply)=>{
    if(err.statusCode===400||err.statusCode===413)return error(reply,err.statusCode,'INVALID_REQUEST',err.statusCode===413?'Payload exceeds 64 KiB.':'Malformed JSON request.',request.id);
    request.log.error({code:err.code??'internal'},'M0 request failed');
    return error(reply,503,'DEPENDENCY_UNAVAILABLE','Local database or service unavailable. No validation was confirmed saved.',request.id);
  });
  app.get('/health/live',async()=>({status:'ok',milestone:'M0',mode:'contract-only'}));
  app.get('/api/m0/health',async(request)=>{
    await pool.query('SELECT 1');
    const r=await pool.query('SELECT count(*)::int AS count FROM m0.contract_checks WHERE application_id=$1',[identities.get(request)]);
    return {backend:'ready',database:'PostgreSQL',mode:'contract-only',application_id:identities.get(request),saved_checks:r.rows[0].count,provider_calls:0,contract_version:CONTRACT_VERSION};
  });
  app.get('/api/m0/profiles',async(request)=>({items:(await pool.query('SELECT definition FROM m0.profiles WHERE application_id=$1 ORDER BY profile_ref',[identities.get(request)])).rows.map(r=>r.definition)}));
  app.get('/api/m0/examples',async()=>({items:examples}));
  app.get('/api/m0/contracts',async()=>({version:CONTRACT_VERSION,schemas:schemaBundle}));
  app.get('/api/m0/openapi.json',async()=>JSON.parse(readFileSync(resolve(process.env.RUNTIME_ROOT??process.cwd(),'contracts/m0.openapi.json'),'utf8')));
  app.post('/api/m0/validations',async(request,reply)=>{
    const parsed=ValidationInput.safeParse(request.body);
    if(!parsed.success)return error(reply,400,'INVALID_REQUEST','Use { kind: chat | generate | execution, payload: {...} }.',request.id);
    if(!withinPayloadBudget(parsed.data.payload))return error(reply,400,'INVALID_REQUEST','Payload exceeds M0 depth/node limits.',request.id);
    const key=request.headers['idempotency-key'];
    if(typeof key!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/.test(key))return error(reply,400,'INVALID_REQUEST','Idempotency-Key (1-160 safe characters) is required.',request.id);
    const applicationId=identities.get(request)!; const {kind,payload}=parsed.data;
    const definitions=await pool.query('SELECT definition FROM m0.profiles WHERE application_id=$1',[applicationId]);
    const available=definitions.rows.map(r=>Profile.parse(r.definition));
    const report=validateContract(kind,payload,available); const hash=digest(canonicalJson({kind,payload}));
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const added=await client.query('INSERT INTO m0.contract_checks(id,application_id,idempotency_key,request_digest,contract_version,kind,valid,request_summary,report) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(application_id,idempotency_key) DO NOTHING RETURNING id',[randomUUID(),applicationId,key,hash,CONTRACT_VERSION,kind,report.valid,describePayload(payload),report]);
      const stored=await client.query('SELECT id,application_id,request_digest,contract_version,kind,valid,request_summary,report,created_at FROM m0.contract_checks WHERE application_id=$1 AND idempotency_key=$2',[applicationId,key]);
      const row=stored.rows[0];
      if(row.request_digest!==hash){await client.query('ROLLBACK');return error(reply,409,'IDEMPOTENCY_CONFLICT','Key sudah digunakan untuk payload berbeda. Gunakan key baru untuk validasi baru.',request.id);}
      await client.query('COMMIT');
      return reply.code(added.rowCount?201:200).send({...row,replayed:!added.rowCount,mode:'contract-only',execution_created:false});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });
  app.get('/api/m0/history',async(request,reply)=>{
    const q=request.query as Record<string,string>; const limit=Number(q.limit??20);
    if(!Number.isInteger(limit)||limit<1||limit>100)return error(reply,400,'INVALID_REQUEST','limit must be 1-100.',request.id);
    let cursor:{time:string;id:string}|null=null;
    if(q.cursor){try{cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));if(!cursor||!/^\d{4}-/.test(cursor.time)||Number.isNaN(Date.parse(cursor.time))||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cursor.id))throw Error();}catch{return error(reply,400,'INVALID_REQUEST','Invalid page cursor.',request.id);}}
    const rows=await pool.query('SELECT id,application_id,kind,valid,contract_version,request_digest,request_summary,report,created_at,created_at::text AS cursor_time FROM m0.contract_checks WHERE application_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4',[identities.get(request),cursor?.time??null,cursor?.id??null,limit+1]);
    const items=rows.rows.slice(0,limit); const last=items.at(-1);
    return {items,next_cursor:rows.rows.length>limit&&last?Buffer.from(JSON.stringify({time:last.cursor_time,id:last.id})).toString('base64url'):null};
  });
  app.get('/api/m0/history/:id',async(request,reply)=>{
    const {id}=request.params as {id:string};if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return error(reply,404,'NOT_FOUND','Record not found.',request.id);
    const r=await pool.query('SELECT id,application_id,kind,valid,contract_version,request_digest,request_summary,report,created_at FROM m0.contract_checks WHERE id=$1 AND application_id=$2',[id,identities.get(request)]);
    return r.rows[0]??error(reply,404,'NOT_FOUND','Record not found.',request.id);
  });
  app.setNotFoundHandler((request,reply)=>error(reply,404,'NOT_FOUND','Endpoint belum tersedia. M0 hanya menyediakan /api/m0/*.',request.id));
  return app;
}
