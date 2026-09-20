import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export type LocalConfig={owner:string;databaseUrl:string;externalDatabase:boolean;apiPort:number;webPort:number;dbPort:number;pgBin?:string;applications:{id:string;name:string;token:string}[]};
export function loadConfig():LocalConfig{
  const path=resolve(process.env.RUNTIME_ROOT??process.cwd(),'.local/config.json');
  let c:LocalConfig; try{c=JSON.parse(readFileSync(path,'utf8')) as LocalConfig;}catch{throw new Error('Local configuration missing. Run npm run setup from repository root.');}
  if(c.owner!=='ai-runtime-platform-m0')throw new Error('Refusing unrelated local configuration.');
  const u=new URL(c.databaseUrl);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/ai_runtime_m0')throw new Error('M0 accepts only the isolated local ai_runtime_m0 database.');
  if(process.env.NODE_ENV==='production')throw new Error('M0 Contract Lab is local-only; production mode is not supported.');
  if(!c.applications?.length||c.applications.some(a=>a.token.length<32))throw new Error('Invalid local credential configuration.');
  return c;
}
