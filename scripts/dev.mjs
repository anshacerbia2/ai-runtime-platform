import { spawn,execFileSync } from 'node:child_process';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import net from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p','packages/contracts/tsconfig.json'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,[join(root,'scripts/setup-local.mjs')],{cwd:root,stdio:'inherit'});
const config=JSON.parse(readFileSync(join(root,'.local/config.json'),'utf8'));
for(const port of [config.apiPort,config.webPort])await new Promise((ok,no)=>{const server=net.createServer();server.once('error',()=>no(new Error(`Port ${port} is occupied. Stop the existing project dev session or select free ports in .local/config.json.`)));server.listen(port,'127.0.0.1',()=>server.close(ok));});
const children=[
  spawn(process.execPath,['--import','tsx','apps/api/src/main.ts'],{cwd:root,stdio:'inherit'}),
  spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--config','apps/web/vite.config.ts'],{cwd:root,stdio:'inherit'}),
];
let stopped=false;
function stop(){if(stopped)return;stopped=true;for(const child of children)child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children){child.on('error',e=>{console.error(e.message);process.exitCode=1;stop();});child.on('exit',code=>{if(!stopped){process.exitCode=code??1;stop();}});}
console.log(`M0 UI: http://127.0.0.1:${config.webPort} | API: http://127.0.0.1:${config.apiPort} | NO live providers`);
