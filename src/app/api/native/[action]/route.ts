import {NextRequest,NextResponse} from 'next/server';
import {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {auth} from '@/lib/community/auth';
import {db} from '@/lib/community/db';
const hash=(v:string)=>createHash('sha256').update(v).digest('base64url');
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function crypt(value:string,decrypt=false){const key=createHash('sha256').update(process.env.BETTER_AUTH_SECRET!).digest();if(decrypt){const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();}const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([c.update(value),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64url');}
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 if(request.headers.get('origin')!==request.nextUrl.origin)return json({error:'Origin not allowed'},403);
 if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Request too large'},413);
 try{const {action}=await params;const text=await request.text();if(text.length>4096)return json({error:'Request too large'},413);const input=JSON.parse(text);
 if(action==='authorize'){
  if(!/^[A-Za-z0-9_-]{43}$/.test(input.challenge||''))return json({error:'Invalid challenge'},400);
  const session=await auth.api.getSession({headers:request.headers});if(!session||session.user.isAnonymous||!session.user.emailVerified)return json({error:'Sign in to continue'},401);
  const ott=await auth.api.generateOneTimeToken({headers:request.headers});const code=randomBytes(32).toString('base64url');
  await db.query('DELETE FROM native_handoffs WHERE expires_at<now()');
  await db.query("INSERT INTO native_handoffs(code_hash,challenge,encrypted_token,expires_at) VALUES($1,$2,$3,now()+interval '2 minutes')",[hash(code),input.challenge,crypt(ott.token)]);return json({code});
 }
 if(action==='exchange'){
  if(!/^[A-Za-z0-9_-]{43}$/.test(input.code||'')||!/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier||''))return json({error:'Invalid return link'},400);
  const previous=await auth.api.getSession({headers:request.headers});const client=await db.connect();try{await client.query('BEGIN');const {rows}=await client.query('SELECT * FROM native_handoffs WHERE code_hash=$1 AND expires_at>now() FOR UPDATE',[hash(input.code)]);const row=rows[0];if(!row||!timingSafeEqual(Buffer.from(row.challenge),Buffer.from(hash(input.verifier)))){await client.query('ROLLBACK');return json({error:'Sign-in link expired. Try again.'},400);}await client.query('DELETE FROM native_handoffs WHERE code_hash=$1',[hash(input.code)]);await client.query('COMMIT');const response=await auth.api.verifyOneTimeToken({body:{token:crypt(row.encrypted_token,true)},asResponse:true});if(!response.ok)return json({error:'Sign-in expired. Try again.'},400);
  const verified=await response.clone().json();const newId=verified?.user?.id||verified?.session?.userId;
  if(previous?.user.isAnonymous&&newId&&newId!==previous.user.id){
   await client.query('BEGIN');
   await client.query(`INSERT INTO high_scores(set_id,user_id,score,level,mode,achieved_at) SELECT set_id,$1,score,level,mode,achieved_at FROM high_scores WHERE user_id=$2 ON CONFLICT(set_id,user_id) DO UPDATE SET score=EXCLUDED.score,level=EXCLUDED.level,mode=EXCLUDED.mode,achieved_at=EXCLUDED.achieved_at WHERE EXCLUDED.score>high_scores.score`,[newId,previous.user.id]);
   await client.query('UPDATE shared_sets SET created_by=$1 WHERE created_by=$2',[newId,previous.user.id]);
   await client.query('DELETE FROM high_scores WHERE user_id=$1',[previous.user.id]);
   await client.query('COMMIT');
  }
  const result=json({ok:true});for(const c of response.headers.getSetCookie())result.headers.append('Set-Cookie',c);return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Unable to complete sign-in. Try again.'},400);}
}
