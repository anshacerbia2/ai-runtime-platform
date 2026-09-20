import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { profiles,canonicalJson } from '@ai-runtime/contracts';
import type { LocalConfig } from './config.js';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function createPool(config:LocalConfig){return new Pool({connectionString:config.databaseUrl,max:6,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,statement_timeout:5000,application_name:'ai-runtime-m0'});}
export async function migrate(pool:Pool,config:LocalConfig){
  const sql=readFileSync(resolve(process.env.RUNTIME_ROOT??process.cwd(),'db/migrations/0001_m0_contract_lab.sql'),'utf8');
  const checksum=digest(sql); const client=await pool.connect();
  try{
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)',[621408321]);
    await client.query('CREATE SCHEMA IF NOT EXISTS m0');
    await client.query('CREATE TABLE IF NOT EXISTS m0.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const prior=await client.query('SELECT checksum FROM m0.schema_migrations WHERE version=$1',['0001']);
    if(prior.rows.length&&prior.rows[0].checksum!==checksum)throw new Error('Migration checksum changed. Add a new migration; do not edit applied history.');
    if(!prior.rows.length){await client.query(sql);await client.query('INSERT INTO m0.schema_migrations(version,checksum) VALUES($1,$2)',['0001',checksum]);}
    for(const app of config.applications){
      await client.query('INSERT INTO m0.applications(id,display_name,token_sha256) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,token_sha256=excluded.token_sha256',[app.id,app.name,digest(app.token)]);
      for(const profile of profiles){
        const checksum=digest(canonicalJson(profile));
        await client.query('INSERT INTO m0.profiles(application_id,profile_ref,definition,digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[app.id,profile.profile,profile,checksum]);
        const old=await client.query('SELECT digest FROM m0.profiles WHERE application_id=$1 AND profile_ref=$2',[app.id,profile.profile]);
        if(old.rows[0].digest!==checksum)throw new Error('Immutable demo profile changed. Use a new profile revision.');
      }
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
