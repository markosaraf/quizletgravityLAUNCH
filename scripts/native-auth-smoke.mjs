import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
const base=process.env.TEST_URL||'http://localhost:3035';let cookie='';let user;
async function post(path,body,session=true){const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(session?{Cookie:cookie}:{})},body:JSON.stringify(body)});const set=r.headers.getSetCookie();if(set.length)cookie=set.map(c=>c.split(';')[0]).join('; ');return{status:r.status,data:await r.json()};}
const suffix=randomBytes(6).toString('hex'),verifier=randomBytes(32).toString('base64url');
const db=new Pool({connectionString:process.env.DATABASE_URL});
try{const signup=await post('/api/auth/sign-up/email',{email:`native-${suffix}@example.test`,password:randomBytes(20).toString('hex'),name:'Native test',username:'native_'+suffix});assert.equal(signup.status,200);user=signup.data.user.id;
const a=await post('/api/native/authorize',{challenge:createHash('sha256').update(verifier).digest('base64url')});assert.equal(a.status,200,JSON.stringify(a.data));
const bad=await post('/api/native/exchange',{code:a.data.code,verifier:randomBytes(32).toString('base64url')},false);assert.equal(bad.status,400);
const good=await post('/api/native/exchange',{code:a.data.code,verifier},false);assert.equal(good.status,200,JSON.stringify(good.data));
const session=await fetch(base+'/api/auth/get-session',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(session.user.id,user);
const replay=await post('/api/native/exchange',{code:a.data.code,verifier},false);assert.equal(replay.status,400);
console.log('PASS native PKCE exchange, wrong-verifier rejection, session cookie, and replay rejection.');
}finally{if(user)await db.query('DELETE FROM "user" WHERE id=$1',[user]);await db.end();}
