import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {auth} from '@/lib/community/auth';
import {db} from '@/lib/community/db';
import {isAdmin} from '@/lib/community/admin';
export const runtime='nodejs';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
type Context={params:Promise<{path:string[]}>};
export async function GET(request:NextRequest,{params}:Context){
 try{
  const session=await auth.api.getSession({headers:request.headers});
  const admin=!!session&&!session.user.isAnonymous&&await isAdmin(session.user.id);
  const {path}=await params;
  if(path.join('/')==='status')return json({admin});
  if(!admin)return json({error:'Administrator access required.'},403);
  const offset=Math.max(0,Math.min(100000,Number(request.nextUrl.searchParams.get('offset'))||0));
  const q=(request.nextUrl.searchParams.get('q')||'').trim().slice(0,120);
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  if(path.join('/')==='users'){
   const {rows:counts}=await db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT coalesce(u."isAnonymous",false))::int AS accounts,count(*) FILTER(WHERE u."isAnonymous")::int AS guests FROM "user" u WHERE NOT EXISTS(SELECT 1 FROM deleted_users d WHERE d.user_id=u.id)`);
   const {rows}=await db.query(`SELECT u.id,coalesce(u."displayUsername",u.username,u.name) AS username,u."isAnonymous" AS guest,u."createdAt" AS created_at,EXISTS(SELECT 1 FROM community_admins a WHERE a.user_id=u.id) AS admin FROM "user" u WHERE NOT EXISTS(SELECT 1 FROM deleted_users d WHERE d.user_id=u.id) AND ($1='' OR coalesce(u."displayUsername",u.username,u.name) ILIKE $2 ESCAPE '\\') ORDER BY u."createdAt" DESC,u.id LIMIT 51 OFFSET $3`,[q,pattern,offset]);
   return json({users:rows.slice(0,50),hasMore:rows.length>50,...counts[0]});
  }
  if(path.join('/')==='sets'){
   const {rows}=await db.query(`SELECT s.id,s.public_id,s.title,s.source_url,s.term_count,coalesce(u."displayUsername",u.username,u.name,'Deleted user') AS creator FROM shared_sets s LEFT JOIN "user" u ON u.id=s.created_by WHERE $1='' OR s.title ILIKE $2 ESCAPE '\\' ORDER BY s.created_at DESC,s.id LIMIT 51 OFFSET $3`,[q,pattern,offset]);
   return json({sets:rows.slice(0,50),hasMore:rows.length>50});
  }
  return json({error:'Not found'},404);
 }catch{return json({error:'Unable to load moderation tools.'},500);}
}
export async function DELETE(request:NextRequest,{params}:Context){
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==request.nextUrl.origin))return json({error:'Origin not allowed'},403);
 const session=await auth.api.getSession({headers:request.headers});
 if(!session||session.user.isAnonymous||!await isAdmin(session.user.id))return json({error:'Administrator access required.'},403);
 const {path}=await params;
 if(path.length!==2||!['users','sets'].includes(path[0])||!path[1]||path[1].length>128)return json({error:'Not found'},404);
 if(path[0]==='sets'&&!/^[0-9a-f-]{36}$/i.test(path[1]))return json({error:'Invalid set.'},400);
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  if(path[0]==='users'){
   const {rows}=await client.query('SELECT id,email FROM "user" WHERE id=$1 FOR UPDATE',[path[1]]);
   if(!rows.length){await client.query('ROLLBACK');return json({error:'User not found.'},404);}
   const admins=await client.query('SELECT 1 FROM community_admins WHERE user_id=$1',[path[1]]);
   if(admins.rows.length){await client.query('ROLLBACK');return json({error:'Administrator accounts cannot be deleted here.'},400);}
   await client.query('DELETE FROM session WHERE "userId"=$1',[path[1]]);
   await client.query('DELETE FROM account WHERE "userId"=$1',[path[1]]);
   await client.query('DELETE FROM verification WHERE identifier=$1 OR value=$2',[rows[0].email,path[1]]);
   await client.query(`UPDATE "user" SET name='Deleted user',username=NULL,"displayUsername"=NULL,email=$2,"emailVerified"=false,image=NULL,"isAnonymous"=false,"updatedAt"=now() WHERE id=$1`,[path[1],randomUUID()+'@deleted.invalid']);
   await client.query('INSERT INTO deleted_users(user_id) VALUES($1) ON CONFLICT DO NOTHING',[path[1]]);
  }else{
   const result=await client.query('DELETE FROM shared_sets WHERE id=$1 RETURNING id',[path[1]]);
   if(!result.rows.length){await client.query('ROLLBACK');return json({error:'Set not found.'},404);}
  }
  await client.query('INSERT INTO moderation_log(actor_id,action,target_id) VALUES($1,$2,$3)',[session.user.id,path[0]==='users'?'delete_user':'delete_set',path[1]]);
  await client.query('COMMIT');return json({deleted:true});
 }catch{await client.query('ROLLBACK');return json({error:'Unable to delete. Please retry.'},500);}finally{client.release();}
}
