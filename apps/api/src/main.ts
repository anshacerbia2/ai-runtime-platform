import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { buildServer } from './server.js';
const config=loadConfig();const pool=createPool(config);const app=buildServer(pool,config,true);
let closing=false;
async function shutdown(){if(closing)return;closing=true;await app.close();await pool.end();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
try{await pool.query('SELECT 1 FROM m0.schema_migrations LIMIT 1');await app.listen({host:'127.0.0.1',port:config.apiPort});}
catch(error){app.log.error(error);await shutdown();process.exitCode=1;}
