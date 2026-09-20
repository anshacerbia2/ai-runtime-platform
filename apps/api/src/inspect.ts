import { loadConfig } from './config.js';
import { createPool } from './db.js';
const pool=createPool(loadConfig());
try{
  console.table((await pool.query('SELECT version,applied_at FROM m0.schema_migrations')).rows);
  console.table((await pool.query('SELECT application_id,kind,valid,count(*)::int FROM m0.contract_checks GROUP BY application_id,kind,valid ORDER BY application_id,kind')).rows);
  console.table((await pool.query('SELECT id,application_id,kind,valid,created_at FROM m0.contract_checks ORDER BY created_at DESC LIMIT 10')).rows);
  console.log('Only metadata is persisted. Raw prompts and service credentials are not displayed.');
}finally{await pool.end();}
