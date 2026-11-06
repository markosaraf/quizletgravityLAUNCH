import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import {chromium} from '@playwright/test';
import pg from 'pg';
const base='http://localhost:3035';
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/quizzlet_preview');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const browser=await chromium.launch();
const admin=await browser.newContext();const member=await browser.newContext();const anon=await browser.newContext();
const ids=[];let setId;
const password=randomUUID();
async function call(ctx,path,data,method=data?'POST':'GET',origin=base){const r=await ctx.request.fetch(base+path,{method,...(data?{data}:{}),headers:{Origin:origin}});return {status:r.status(),data:await r.json()};}
async function user(adminRole){const id=randomUUID();ids.push(id);const name='test'+id.replaceAll('-','').slice(0,16);await db.query('INSERT INTO "user"(id,name,email,"emailVerified",username,"displayUsername","isAnonymous") VALUES($1,$2,$3,true,$2,$2,false)',[id,name,id+'@example.invalid']);await db.query('INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,$3,now())',[randomUUID(),id,await hashPassword(password)]);if(adminRole)await db.query('INSERT INTO community_admins(user_id) VALUES($1)',[id]);return {id,name};}
try{
 const a=await user(true),u=await user(false);
 for(const [ctx,who] of [[admin,a],[member,u]]){const r=await call(ctx,'/api/auth/sign-in/username',{username:who.name,password});assert.equal(r.status,200);}
 assert.equal((await call(anon,'/api/admin/users')).status,403);
 assert.equal((await call(member,'/api/admin/users')).status,403);
 await call(member,'/api/auth/update-user',{admin:true,role:'admin'});
 assert.equal((await call(member,'/api/admin/status')).data.admin,false);
 const c=await call(member,'/api/community/sets',{title:'Moderation fixture '+u.name,cards:[{term:'a',definition:u.id},{term:'b',definition:'test'}]});assert.equal(c.status,200);setId=c.data.id;
 await db.query('INSERT INTO high_scores(set_id,user_id,score,level,mode) VALUES($1,$2,120,1,\'BEGINNER\')',[setId,u.id]);
 assert.equal((await call(member,'/api/admin/sets/'+setId,undefined,'DELETE')).status,403);
 assert.equal((await call(admin,'/api/admin/sets/'+setId,undefined,'DELETE','https://evil.invalid')).status,403);
 assert.equal((await call(admin,'/api/admin/users/'+a.id,undefined,'DELETE')).status,400);
 const before=(await call(admin,'/api/admin/users')).data.total;
 const page=await admin.newPage();await page.goto(base+'/admin/users');await page.getByRole('heading',{name:'Users',exact:true}).waitFor();await page.getByLabel('Search users').fill(u.name);await page.getByText(u.name,{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert(await page.getByRole('link',{name:'Users',exact:true}).isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete user',exact:true}).click();await page.getByText(u.name,{exact:true}).waitFor({state:'hidden'});
 assert.equal((await call(admin,'/api/admin/users')).data.total,before-1);
 const board=await call(anon,`/api/community/sets/${setId}/leaderboard`);assert.equal(board.data.entries[0].username,'Deleted user');assert.equal(board.data.entries[0].score,120);
 assert.equal((await call(member,'/api/community/sets',{title:'Blocked',cards:[{term:'x',definition:'y'},{term:'z',definition:'t'}]})).status,401);
 assert.notEqual((await call(anon,'/api/auth/sign-in/username',{username:u.name,password})).status,200);
 const credentials=await db.query('SELECT count(*)::int AS n FROM account WHERE "userId"=$1',[u.id]);assert.equal(credentials.rows[0].n,0);
 assert.equal((await call(admin,'/api/admin/sets/'+setId,undefined,'DELETE')).status,200);
 assert.equal((await call(anon,'/api/community/sets/'+setId)).status,404);
 const publicPage=await anon.newPage();await publicPage.goto(base+'/sets');assert.equal(await publicPage.getByRole('link',{name:'Users',exact:true}).count(),0);
 console.log('PASS admin login, private user list/count, no self-elevation, CSRF rejection, protected admin, mobile admin UI, user deletion/session revocation, preserved anonymous scores and set deletion.');
}finally{
 await browser.close();if(setId)await db.query('DELETE FROM shared_sets WHERE id=$1',[setId]);
 await db.query('DELETE FROM moderation_log WHERE actor_id=ANY($1::text[])',[ids]);
 for(const id of ids)await db.query('DELETE FROM "user" WHERE id=$1',[id]);await db.end();
}
