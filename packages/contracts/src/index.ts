import { z } from 'zod';
export const CONTRACT_VERSION = '1.0.0-m0';
export const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/);
const text = z.string().min(1).max(24000);
export const Context = z.strictObject({
  process_id: id.optional(), step_id: id.optional(), conversation_id: id.optional(),
  parent_execution_id: id.optional(), labels: z.record(z.string().max(40), z.string().max(160)).optional(),
});
export const Constraints = z.strictObject({
  max_output_tokens: z.number().int().min(1).max(32768).optional(),
  timeout_ms: z.number().int().min(1).max(3600000).optional(),
});
export const Capability = z.enum(['chat','generate','structured_generate','agent_execute']);
export const Content = z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('text'),text}),
  z.strictObject({type:z.literal('artifact'),artifact_ref:id}),
]);
export const ChatInput = z.strictObject({messages:z.array(z.strictObject({
  role:z.enum(['system','user','assistant']), content:z.array(Content).min(1).max(16),
})).min(1).max(64)});
export const PromptInput = z.strictObject({prompt:text, artifact_refs:z.array(id).max(16).optional()});
// The caller's schema is DATA, never compiled as executable code. M0 checks a bounded subset below.
export const StructuredInput = PromptInput.extend({response_schema:z.record(z.string(), z.unknown())});
const common = {
  profile:id, context:Context.optional(), constraints:Constraints.optional(),
  session_ref:id.optional(),
};
export const ChatRequest = z.strictObject({...common,input:ChatInput,stream:z.boolean().optional()});
export const GenerateRequest = z.discriminatedUnion('capability',[
  z.strictObject({...common,capability:z.literal('generate'),input:PromptInput,stream:z.boolean().optional()}),
  z.strictObject({...common,capability:z.literal('structured_generate'),input:StructuredInput,stream:z.boolean().optional()}),
]);
export const ExecutionRequest = z.discriminatedUnion('capability',[
  z.strictObject({...common,capability:z.literal('chat'),input:ChatInput}),
  z.strictObject({...common,capability:z.literal('generate'),input:PromptInput}),
  z.strictObject({...common,capability:z.literal('structured_generate'),input:StructuredInput}),
  z.strictObject({...common,capability:z.literal('agent_execute'),input:PromptInput}),
]);
export const ExecutionStatus = z.enum(['ACCEPTED','QUEUED','RUNNING','CANCEL_REQUESTED','RECONCILING','COMPLETED','FAILED','CANCELLED','TIMED_OUT']);
export const Attempt = z.strictObject({
  attempt_id:id, status:z.enum(['PREPARED','DISPATCHED','RUNNING','ORPHAN_SUSPENDED','ABANDONED','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT']),
  authority:z.enum(['UNASSIGNED','ACTIVE','LOST','FENCED','RELEASED']),
  local_compute:z.enum(['NOT_APPLICABLE','STARTING','RUNNING','TERMINATING','EXITED','KILLED','UNKNOWN']),
  external_operations:z.enum(['NONE','IN_FLIGHT','COMMITTED','FAILED','MIXED','UNKNOWN_IN_FLIGHT']),
  accounting:z.enum(['UNRESERVED','RESERVED','PENDING_RECONCILIATION','SETTLED','OVERAGE_SETTLED']),
});
export const Usage = z.strictObject({
  measurement_status:z.enum(['complete','partial','pending','unknown']),
  cost_basis:z.enum(['provider_reported','estimated','allocated','unknown']),
  provider_cost:z.string().regex(/^\d+(\.\d+)?$/).nullable(),
});
export const Result = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('text'),text:z.string(),artifact_refs:z.array(id)}),
  z.strictObject({kind:z.literal('structured'),value:z.unknown(),artifact_refs:z.array(id)}),
  z.strictObject({kind:z.literal('artifacts'),artifact_refs:z.array(id).min(1)}),
  z.strictObject({kind:z.literal('mixed'),text:z.string(),artifact_refs:z.array(id)}),
]);
export const Snapshot = z.strictObject({
  execution_id:id,revision:z.number().int().min(1),status:ExecutionStatus,status_reason:z.string().nullable(),
  profile_revision:id,attempts:z.array(Attempt),result:Result.nullable(),usage:Usage,
  links:z.strictObject({self:z.string(),events:z.string()}),
});
export const ErrorEnvelope = z.strictObject({error:z.strictObject({
  code:z.enum(['INVALID_REQUEST','UNAUTHENTICATED','POLICY_DENIED','NOT_FOUND','IDEMPOTENCY_CONFLICT','SESSION_BUSY','STREAM_RESUME_EXPIRED','RESOURCE_EXPIRED','UNSUPPORTED_CAPABILITY','BUDGET_EXHAUSTED','RATE_LIMITED','CAPACITY_EXHAUSTED','DEPENDENCY_UNAVAILABLE','WAIT_TIMEOUT','NOT_IMPLEMENTED']),
  message:z.string(),retryable:z.boolean(),request_id:z.string(),execution_id:id.nullable(),
})});
export const Event = z.strictObject({
  schema_version:z.literal('1'),event_id:id,execution_id:id,attempt_id:id.optional(),stream_epoch:id,occurred_at:z.iso.datetime(),
  type:z.enum(['execution.accepted','execution.started','attempt.started','attempt.orphaned','attempt.ended','model.started','model.delta','tool.started','tool.completed','usage.updated','execution.cancel_requested','execution.completed','execution.failed','execution.cancelled','execution.timed_out','stream.reset_required']),
  sequence:z.number().int().nonnegative(),payload:z.record(z.string(),z.unknown()),
});
export const CancelRequest = z.strictObject({reason:z.string().max(500).optional()});
export const ToolOperation = z.strictObject({
  operation_id:id,idempotency_key:id,tool_ref:id,input:z.record(z.string(),z.unknown()),
  effect:z.enum(['read_only','mutating']),status:z.enum(['PENDING','IN_FLIGHT','COMMITTED','FAILED','UNKNOWN']),
});
export const Profile = z.strictObject({
  profile:id,capability:Capability,workload_class:z.enum(['interactive','batch','agent']),
  execution_path:z.enum(['gateway','agent']),runtime_adapter:z.enum(['claude','codex','gemini']).nullable(),
  provider_adapter:z.enum(['openrouter','direct-anthropic']).nullable(),harness_ref:id.nullable(),
  limits:z.strictObject({max_output_tokens:z.number().int().positive(),timeout_ms:z.number().int().positive()}),
  streaming:z.boolean(),mode:z.literal('contract-only'),title:z.string(),description:z.string(),
});
export type ProfileType=z.infer<typeof Profile>;
export const profiles:ProfileType[]=[
  {profile:'chat-default@1',capability:'chat',workload_class:'interactive',execution_path:'gateway',runtime_adapter:null,provider_adapter:'openrouter',harness_ref:null,limits:{max_output_tokens:2048,timeout_ms:30000},streaming:true,mode:'contract-only',title:'Direct chat',description:'Tidak perlu job atau plugin. Percakapan tetap milik aplikasi.'},
  {profile:'text-default@1',capability:'generate',workload_class:'batch',execution_path:'gateway',runtime_adapter:null,provider_adapter:'openrouter',harness_ref:null,limits:{max_output_tokens:2048,timeout_ms:30000},streaming:true,mode:'contract-only',title:'Text generation',description:'Satu langkah generasi dengan prompt terstruktur.'},
  {profile:'fare-interpretation@1',capability:'structured_generate',workload_class:'batch',execution_path:'gateway',runtime_adapter:null,provider_adapter:'openrouter',harness_ref:null,limits:{max_output_tokens:1024,timeout_ms:30000},streaming:false,mode:'contract-only',title:'Structured generation',description:'Schema hasil dibatasi; validasi bisnis tetap di app.'},
  {profile:'scribe-document@2',capability:'agent_execute',workload_class:'agent',execution_path:'agent',runtime_adapter:'claude',provider_adapter:null,harness_ref:'scribe-package@demo-v2',limits:{max_output_tokens:4096,timeout_ms:120000},streaming:false,mode:'contract-only',title:'Scribe agent',description:'Job tetap di Scribe. Runtime dan plugin belum dieksekusi pada M0.'},
];
export type ContractKind='chat'|'generate'|'execution';
export const ValidationInput=z.strictObject({kind:z.enum(['chat','generate','execution']),payload:z.record(z.string(),z.unknown())});
export type Issue={path:string;code:string;message:string};
export type CheckResult={valid:boolean;issues:Issue[];profile:ProfileType|null;capability:string|null;warnings:string[];contract_version:string};

export const ExecutionProfile=z.strictObject({
  profile:id,capability:Capability,
  runtime:z.strictObject({adapter:z.enum(['claude','codex','gemini']),version_policy:id}).optional(),
  model_policy_ref:id,credential_binding_ref:id,harness_ref:id.optional(),tool_policy_ref:id.optional(),data_policy_ref:id,
  limits:z.strictObject({max_attempts:z.number().int().min(1),max_turns:z.number().int().min(1),max_concurrency:z.number().int().min(1)}),
  budget_policy_ref:id,session_policy:z.enum(['none','same-runtime-single-writer']),workload_class:z.enum(['interactive','batch','agent']),
});
export const AdapterDescriptor=z.strictObject({
  adapter_id:id,kind:z.enum(['provider','runtime']),version:id,capabilities:z.array(Capability),
  supports_streaming:z.boolean(),supports_cancellation:z.boolean(),supports_sessions:z.boolean(),
  usage_granularity:z.enum(['invocation','summary','unknown']),
  enforced_limits:z.array(z.enum(['output_tokens','turns','duration','concurrency'])),
  status:z.enum(['PLANNED','TEST_ONLY','VERIFIED_FOR_PROFILE']),
});
export function validateSnapshot(value:unknown):boolean{
  const parsed=Snapshot.safeParse(value);if(!parsed.success)return false;
  return parsed.data.status!=='COMPLETED'||parsed.data.result!==null;
}

const schemas={ExecutionProfile,AdapterDescriptor,ChatRequest,GenerateRequest,ExecutionRequest,ExecutionStatus,Attempt,Usage,Snapshot,ErrorEnvelope,Event,CancelRequest,ToolOperation,M0Profile:Profile,ValidationInput};
export const schemaBundle=Object.fromEntries(Object.entries(schemas).map(([k,v])=>[k,z.toJSONSchema(v,{target:'draft-2020-12',io:'input'})]));
export const examples:{id:string;title:string;kind:ContractKind;payload:unknown}[]=[
  {id:'chat',title:'Direct chat',kind:'chat',payload:{profile:'chat-default@1',input:{messages:[{role:'user',content:[{type:'text',text:'Jelaskan apa yang dimiliki app dan platform.'}]}]},stream:true}},
  {id:'structured',title:'Structured output',kind:'generate',payload:{profile:'fare-interpretation@1',capability:'structured_generate',context:{process_id:'fare-123',step_id:'interpret'},input:{prompt:'Klasifikasikan aturan berikut.',response_schema:{type:'object',properties:{category:{type:'string',enum:['allowed','restricted','unknown']}},required:['category'],additionalProperties:false}},stream:false}},
  {id:'scribe',title:'Scribe agent',kind:'execution',payload:{profile:'scribe-document@2',capability:'agent_execute',context:{process_id:'scribe-job-123',step_id:'generate-document'},input:{prompt:'Buat draft sesuai standar dokumen.',artifact_refs:['artifact-video-123','artifact-standard-v3']}}},
  {id:'invalid',title:'Identity spoofing',kind:'chat',payload:{profile:'chat-default@1',application_id:'another-app',input:{messages:[{role:'user',content:[{type:'text',text:'Identitas ini harus ditolak.'}]}]}}},
];
function schemaIssues(schema:unknown):Issue[]{
  const issues:Issue[]=[]; let nodes=0;
  const allowed=new Set(['type','properties','required','additionalProperties','enum','items','description','minimum','maximum','minLength','maxLength','minItems','maxItems']);
  function walk(v:unknown,depth:number,path:string){
    if(++nodes>128||depth>8){issues.push({path,code:'SCHEMA_LIMIT',message:'Schema melebihi batas 128 node / kedalaman 8.'});return;}
    if(!v||typeof v!=='object'||Array.isArray(v)){issues.push({path,code:'INVALID_SCHEMA',message:'Node schema harus object.'});return;}
    const o=v as Record<string,unknown>;
    if(Object.keys(o).some(k=>!allowed.has(k))){issues.push({path,code:'SCHEMA_KEYWORD_NOT_ALLOWED',message:'Keyword schema di luar subset M0; referensi remote dan executable schema tidak didukung.'});return;}
    if(!['object','array','string','number','integer','boolean','null'].includes(String(o.type)))issues.push({path,code:'INVALID_SCHEMA',message:'type schema harus eksplisit dan didukung.'});
    for(const key of ['minimum','maximum','minLength','maxLength','minItems','maxItems']){
      const value=o[key];if(value===undefined)continue;
      const count=key.endsWith('Length')||key.endsWith('Items');
      if(typeof value!=='number'||!Number.isFinite(value)||(count&&(!Number.isInteger(value)||value<0)))issues.push({path,code:'INVALID_SCHEMA',message:'Batas schema harus angka valid; panjang/count harus integer nonnegatif.'});
    }
    for(const [lo,hi] of [['minimum','maximum'],['minLength','maxLength'],['minItems','maxItems']] as const){
      if(typeof o[lo]==='number'&&typeof o[hi]==='number'&&o[lo]>o[hi])issues.push({path,code:'INVALID_SCHEMA',message:'Batas minimum melebihi maximum.'});
    }
    if(o.description!==undefined&&(typeof o.description!=='string'||o.description.length>2048))issues.push({path,code:'INVALID_SCHEMA',message:'description harus teks maksimal 2048 karakter.'});
    if(o.properties!==undefined&&o.type!=='object'||o.items!==undefined&&o.type!=='array')issues.push({path,code:'INVALID_SCHEMA',message:'properties/items tidak cocok dengan type.'});
    if(o.properties!==undefined){
      if(!o.properties||typeof o.properties!=='object'||Array.isArray(o.properties))issues.push({path,code:'INVALID_SCHEMA',message:'properties harus object.'});
      else for(const [key,child] of Object.entries(o.properties)){ if(key==='__proto__'||key==='constructor'||key==='prototype'){issues.push({path,code:'INVALID_SCHEMA',message:'Nama property tidak diperbolehkan.'});continue;} walk(child,depth+1,path+'/properties/'+key); }
    }
    if(o.items!==undefined)walk(o.items,depth+1,path+'/items');
    if(o.required!==undefined&&(!Array.isArray(o.required)||o.required.some(x=>typeof x!=='string'||!o.properties||!Object.hasOwn(o.properties as object,x))))issues.push({path,code:'INVALID_SCHEMA',message:'required harus menunjuk property yang didefinisikan.'});
    if(o.additionalProperties!==undefined&&typeof o.additionalProperties!=='boolean')issues.push({path,code:'INVALID_SCHEMA',message:'additionalProperties harus boolean pada M0.'});
    if(o.enum!==undefined&&(!Array.isArray(o.enum)||o.enum.length===0||o.enum.length>64||o.enum.some(x=>x!==null&&!['string','number','boolean'].includes(typeof x))))issues.push({path,code:'INVALID_SCHEMA',message:'enum harus 1–64 nilai scalar.'});
  }
  walk(schema,0,'/input/response_schema'); return issues.slice(0,20);
}
export function validateContract(kind:ContractKind,payload:unknown,available:ProfileType[]=profiles):CheckResult{
  const schema=kind==='chat'?ChatRequest:kind==='generate'?GenerateRequest:ExecutionRequest;
  const parsed=schema.safeParse(payload);
  const base={profile:null,capability:null,warnings:[],contract_version:CONTRACT_VERSION};
  if(!parsed.success)return {...base,valid:false,issues:parsed.error.issues.slice(0,20).map(i=>({path:'/'+i.path.join('/'),code:i.code,message:i.code==='unrecognized_keys'?'Field tambahan tidak diizinkan; identitas dan izin ditentukan server.':i.message}))};
  const request=parsed.data; const capability=kind==='chat'?'chat':('capability'in request?request.capability:null);
  const profile=available.find(x=>x.profile===request.profile)??null; const issues:Issue[]=[];
  if(!profile)issues.push({path:'/profile',code:'PROFILE_NOT_FOUND',message:'Profile tidak tersedia untuk aplikasi ini.'});
  if(profile&&profile.capability!==capability)issues.push({path:'/capability',code:'UNSUPPORTED_CAPABILITY',message:'Capability tidak cocok dengan profile.'});
  if(request.session_ref)issues.push({path:'/session_ref',code:'UNSUPPORTED_CAPABILITY',message:'Session hanya diperiksa pada fase runtime; belum tersedia di M0.'});
  if(request.context?.parent_execution_id)issues.push({path:'/context/parent_execution_id',code:'UNSUPPORTED_CAPABILITY',message:'Otorisasi parent execution belum tersedia di M0.'});
  if(Object.keys(request.context?.labels??{}).length>16)issues.push({path:'/context/labels',code:'LIMIT_EXCEEDED',message:'Maksimal 16 labels.'});
  if(profile){
    if('stream'in request&&request.stream&&!profile.streaming)issues.push({path:'/stream',code:'UNSUPPORTED_CAPABILITY',message:'Profile ini tidak mengizinkan streaming.'});
    for(const k of ['max_output_tokens','timeout_ms'] as const){const n=request.constraints?.[k];if(n!==undefined&&n>profile.limits[k])issues.push({path:'/constraints/'+k,code:'POLICY_DENIED',message:'Caller hanya boleh menurunkan batas profile.'});}
  }
  if('response_schema'in request.input)issues.push(...schemaIssues(request.input.response_schema));
  const warnings=['CONTRACT_ONLY: tidak ada AI call, tool, budget reservation, atau execution yang dibuat.'];
  if('artifact_refs'in request.input&&request.input.artifact_refs?.length||'messages'in request.input&&request.input.messages.some(m=>m.content.some(c=>c.type==='artifact')))warnings.push('Artifact reference hanya diperiksa bentuknya; existence/authorization membutuhkan service artifact pada fase berikutnya.');
  return {valid:issues.length===0,issues,profile,capability,warnings,contract_version:CONTRACT_VERSION};
}
// Bound the entire diagnostic request before recursive canonicalization.
export function withinPayloadBudget(value:unknown,maxDepth=24,maxNodes=4096):boolean{
  const stack:{value:unknown;depth:number}[]=[{value,depth:0}];let nodes=0;
  while(stack.length){
    const item=stack.pop()!;if(++nodes>maxNodes||item.depth>maxDepth)return false;
    if(item.value&&typeof item.value==='object'){
      for(const child of Object.values(item.value))stack.push({value:child,depth:item.depth+1});
    }
  }
  return true;
}

// Stable JSON for lab idempotency. This is NOT the complete M1 execution digest contract.
export function canonicalJson(value:unknown):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
}
export function describePayload(payload:unknown){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {shape:typeof payload};
  const o=payload as Record<string,unknown>; const i=(o.input&&typeof o.input==='object'?o.input:{}) as Record<string,unknown>;
  // Persist structural metadata only: no raw prompt/messages, labels, credential, or arbitrary input.
  return {top_level_fields:Object.keys(o).filter(k=>['profile','capability','context','input','constraints','stream','session_ref'].includes(k)),prompt_characters:typeof i.prompt==='string'?i.prompt.length:0,message_count:Array.isArray(i.messages)?i.messages.length:0,artifact_count:Array.isArray(i.artifact_refs)?i.artifact_refs.length:0};
}
