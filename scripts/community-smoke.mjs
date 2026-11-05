import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3035';
let cookie='';
async function call(path,body,withSession=true){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:base,...(withSession&&cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const cookies=r.headers.getSetCookie();if(cookies.length)cookie=cookies.map(c=>c.split(';')[0]).join('; ');return {status:r.status,data:await r.json()};}
const suffix=randomBytes(5).toString('hex');
const sign=await call('/api/auth/sign-in/anonymous',{});assert.equal(sign.status,200,JSON.stringify(sign.data));
const cards=[{term:'sun',definition:'Sonne '+suffix},{term:'moon',definition:'Mond'}];
const a=await call('/api/community/sets',{title:'Smoke '+suffix,cards});assert.equal(a.status,200,JSON.stringify(a.data));
const b=await call('/api/community/sets',{title:'Duplicate',cards:[...cards].reverse()});assert.equal(a.data.id,b.data.id);
const search=await call('/api/community/sets?q='+suffix);assert.equal(search.data.sets.length,1);
const blocked=await call('/api/community/sets',{title:'Unauthorized',cards},false);assert.equal(blocked.status,401);
const run=await call('/api/community/runs',{setId:a.data.id,mode:'BEGINNER'});assert.equal(run.status,200,JSON.stringify(run.data));
await new Promise(r=>setTimeout(r,2200));
const finish=await call(`/api/community/runs/${run.data.id}/finish`,{score:100,level:1});assert.equal(finish.status,200,JSON.stringify(finish.data));
await call(`/api/community/runs/${run.data.id}/finish`,{score:200,level:1});
const board=await call(`/api/community/sets/${a.data.id}/leaderboard`);assert.equal(board.data.entries.length,1);assert.equal(board.data.entries[0].score,100);
console.log('PASS guest signup, authenticated set creation, canonical deduplication, search, access control, score save and idempotency.');
// Delete only this run's test account and set. Never touch real users.
const {Pool}=await import('pg');const db=new Pool({connectionString:process.env.DATABASE_URL});await db.query('DELETE FROM shared_sets WHERE id=$1',[a.data.id]);await db.query('DELETE FROM "user" WHERE id=$1',[sign.data.user.id]);await db.end();
