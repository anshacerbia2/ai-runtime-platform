import { loadConfig } from './config.js';
import { createPool,migrate } from './db.js';
const config=loadConfig();const pool=createPool(config);
try{await migrate(pool,config);console.log('M0 schema and immutable demo profiles ready.');}finally{await pool.end();}
