import { existsSync,readFileSync,writeFileSync,mkdirSync,unlinkSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync,spawnSync } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const local=join(root,'.local'); const configPath=join(local,'config.json');
const ext=process.platform==='win32'?'.exe':'';
const log=(s)=>console.log('[M0 setup] '+s);
function binaryDir(){
  if(process.env.PG_BIN)return process.env.PG_BIN;
  const found=spawnSync('pg_config',['--bindir'],{encoding:'utf8'});
  if(found.status===0)return found.stdout.trim();
  if(process.platform==='win32')for(const v of ['18','17','16','15']){const dir=`C:\\Program Files\\PostgreSQL\\${v}\\bin`;if(existsSync(join(dir,'initdb.exe')))return dir;}
  throw new Error('PostgreSQL binaries not found. Set PG_BIN or provide DATABASE_URL for a dedicated LOCAL ai_runtime_m0 database. See docs/development/M0.md.');
}
async function portFree(port){return new Promise((yes,no)=>{const s=net.createServer();s.once('error',no);s.listen(port,'127.0.0.1',()=>s.close(()=>yes(true)));});}
let config;
try{
  if(process.argv.includes('--stop')){
    if(!existsSync(configPath)){log('No project database configured.');process.exit(0);}
    config=JSON.parse(readFileSync(configPath,'utf8'));
    if(config.owner!=='ai-runtime-platform-m0')throw new Error('Unrecognized database owner marker.');
    if(config.externalDatabase){log('External database is not managed or stopped by this script.');process.exit(0);}
    const status=spawnSync(join(config.pgBin,'pg_ctl'+ext),['status','-D',join(local,'postgres')]);
    if(status.status===0)execFileSync(join(config.pgBin,'pg_ctl'+ext),['stop','-D',join(local,'postgres'),'-m','fast','-w'],{stdio:'inherit'});
    log('Only this project cluster was stopped; data retained.');process.exit(0);
  }
  mkdirSync(local,{recursive:true});
  if(existsSync(configPath)){
    config=JSON.parse(readFileSync(configPath,'utf8'));
    if(config.owner!=='ai-runtime-platform-m0')throw new Error('Unrecognized config: not overwriting.');
    if(process.env.DATABASE_URL&&process.env.DATABASE_URL!==config.databaseUrl)throw new Error('DATABASE_URL differs from existing local config; refusing implicit switch.');
  }else{
    const password=randomBytes(24).toString('hex');
    config={owner:'ai-runtime-platform-m0',externalDatabase:!!process.env.DATABASE_URL,databaseUrl:process.env.DATABASE_URL??`postgresql://runtime_m0:${password}@127.0.0.1:54329/ai_runtime_m0`,apiPort:4311,webPort:4310,dbPort:54329,
      applications:[{id:'m0-playground',name:'Local Contract Playground',token:randomBytes(32).toString('hex')},{id:'m0-test-other',name:'Isolation Test App',token:randomBytes(32).toString('hex')}]};
    if(!config.externalDatabase)config.pgBin=binaryDir();
    writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const url=new URL(config.databaseUrl);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/ai_runtime_m0')throw new Error('Only LOCAL ai_runtime_m0 database is supported. No production database.');
  if(!config.externalDatabase){
    const data=join(local,'postgres'); const ctl=join(config.pgBin,'pg_ctl'+ext);
    if(!existsSync(join(data,'PG_VERSION'))){
      if(existsSync(data))throw new Error('Partial database directory found; inspect manually. No automatic deletion.');
      const pw=join(local,'initdb-password.tmp');writeFileSync(pw,decodeURIComponent(url.password)+'\n',{mode:0o600});
      try{execFileSync(join(config.pgBin,'initdb'+ext),['-D',data,'-U','runtime_m0','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+pw],{stdio:'inherit'});}finally{unlinkSync(pw);}
    }
    if(spawnSync(ctl,['status','-D',data]).status!==0){
      await portFree(config.dbPort);
      execFileSync(ctl,['start','-D',data,'-l',join(local,'postgres.log'),'-o',`-h 127.0.0.1 -p ${config.dbPort}`,'-w','-t','30'],{stdio:'inherit'});
    }
    const adminUrl=new URL(config.databaseUrl);adminUrl.pathname='/postgres';
    const admin=new pg.Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:3000});await admin.connect();
    try{const check=await admin.query("SELECT 1 FROM pg_database WHERE datname='ai_runtime_m0'");if(!check.rows.length)await admin.query('CREATE DATABASE ai_runtime_m0');}finally{await admin.end();}
  }
  const client=new pg.Client({connectionString:config.databaseUrl,connectionTimeoutMillis:3000});
  await client.connect();const version=await client.query('SHOW server_version');await client.end();
  log('PostgreSQL '+version.rows[0].server_version+' reachable on loopback. Secrets are not printed.');
  if(!process.argv.includes('--db-only'))execFileSync(process.execPath,[join(root,'node_modules/tsx/dist/cli.mjs'),'apps/api/src/migrate.ts'],{cwd:root,stdio:'inherit'});
  log('Ready. Start UI + API with npm run dev. Data: .local/postgres (git-ignored).');
}catch(error){console.error('[M0 setup failed]',error.message);process.exitCode=1;}
