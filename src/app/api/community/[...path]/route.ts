import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { auth } from '@/lib/community/auth';
import { db } from '@/lib/community/db';
import { fingerprint } from '@/lib/community/sets';
import { correctPendingEmail } from '@/lib/community/pending-email';
import { z } from 'zod';
export const runtime='nodejs';
const noCache={'Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:noCache});
const uuid=z.string().uuid();
const cardsSchema=z.array(z.object({term:z.string().trim().min(1).max(10000),definition:z.string().trim().min(1).max(10000)})).min(2).max(5000);
async function limit(request:NextRequest, scope:string, max:number){
 const ip=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'local';
 const key=createHash('sha256').update(scope+ip).digest('hex');
 const {rows}=await db.query(`INSERT INTO api_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN api_limits.expires_at<now() THEN 1 ELSE api_limits.count+1 END,expires_at=CASE WHEN api_limits.expires_at<now() THEN now()+interval '1 minute' ELSE api_limits.expires_at END RETURNING count`,[key]);
 if(rows[0].count>max) throw new Error('RATE');
}
function page(request:NextRequest){return Math.max(0,Math.min(100000,Math.floor(Number(request.nextUrl.searchParams.get('offset'))||0)));}
async function body(request:NextRequest){
 if(!request.headers.get('content-type')?.includes('application/json'))throw Error('JSON required');
 const reader=request.body?.getReader();if(!reader)throw Error('Body required');let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw Error('Request too large');}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{reader.releaseLock();}
}
export async function GET(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 try{
 const {path}=await params;await limit(request,'read',180);
 if(path[0]==='config')return json({google:!!process.env.GOOGLE_CLIENT_ID,recovery:!!process.env.GMAIL_REFRESH_TOKEN});
 if(path[0]==='sets'&&path.length===1){
 const q=(request.nextUrl.searchParams.get('q')||'').trim().slice(0,120);const offset=page(request);
 const {rows}=await db.query(`SELECT s.id,s.public_id,s.quizlet_id,s.title,s.creator_name,s.creator_url,s.source_url,s.term_count,s.created_at,coalesce(u."displayUsername",u.username,u.name,'Community') as added_by
 FROM shared_sets s LEFT JOIN "user" u ON u.id=s.created_by
 WHERE $1='' OR s.search_document @@ websearch_to_tsquery('simple',$1) OR lower(s.title) LIKE $2 ESCAPE '\\'
 ORDER BY s.created_at DESC,s.id LIMIT 25 OFFSET $3`,[q,'%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%',offset]);
 return json({sets:rows.slice(0,24),hasMore:rows.length>24,nextOffset:offset+24});
 }
 if(path[0]==='sets'&&uuid.safeParse(path[1]).success){
 if(path[2]==='leaderboard'){
 const {rows}=await db.query(`SELECT h.score,h.level,h.mode,h.achieved_at,u.id AS player_id,coalesce(u."displayUsername",u.username,u.name) AS username,u."isAnonymous" AS guest
 FROM high_scores h JOIN "user" u ON u.id=h.user_id WHERE h.set_id=$1 ORDER BY h.score DESC,h.achieved_at,u.id LIMIT 51 OFFSET $2`,[path[1],page(request)]);
 return json({entries:rows.slice(0,50),hasMore:rows.length>50,offset:page(request)});
 }
 const {rows}=await db.query(`SELECT s.*,coalesce(u."displayUsername",u.username,u.name,'Community') AS added_by FROM shared_sets s LEFT JOIN "user" u ON u.id=s.created_by WHERE s.id=$1`,[path[1]]);
 return rows[0]?json(rows[0]):json({error:'Set not found'},404);
 }
 return json({error:'Not found'},404);
 }catch(e){return json({error:e instanceof Error&&e.message==='RATE'?'Please wait a minute.':'Could not load this page. Please retry.'},e instanceof Error&&e.message==='RATE'?429:500);}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 try{
 const origin=request.headers.get('origin');if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==request.nextUrl.origin))return json({error:'Origin not allowed'},403);
 const {path}=await params;
 if(path.join('/')==='pending-email'){
  await limit(request,'email-correction',3);
  const v=z.object({username:z.string().min(3).max(24),password:z.string().min(1).max(128),email:z.email().max(254)}).parse(await body(request));
  try{await correctPendingEmail(v.username,v.password,v.email.trim().toLowerCase());
   await auth.api.sendVerificationEmail({body:{email:v.email.trim().toLowerCase(),callbackURL:'/email-confirmed'}});
   return json({sent:true});
  }catch(e){return json({error:e instanceof Error?e.message:'Unable to update email. Try again.'},400);}
 }
 const session=await auth.api.getSession({headers:request.headers});if(!session)return json({error:'Choose a guest name or sign in first.'},401);
 if(!session.user.isAnonymous&&!session.user.emailVerified)return json({error:'Confirm your email before continuing.'},403);
 await limit(request,'write',30);const input=await body(request);
 if(path[0]==='sets'&&path.length===1){
 const v=z.object({title:z.string().trim().min(1).max(200),cards:cardsSchema,sourceSetId:uuid.optional()}).parse(input);
 let source: {id:string;public_id:string;title:string;cards:{term:string;definition:string}[];creator_name:string|null;creator_url:string|null;source_url:string|null}|undefined;
 if(v.sourceSetId){
  const {rows}=await db.query('SELECT id,public_id,title,cards,creator_name,creator_url,source_url FROM shared_sets WHERE id=$1 AND quizlet_id IS NOT NULL',[v.sourceSetId]);
  source=rows[0];
  if(!source)return json({error:'The original Quizlet set could not be found. Import it again.'},400);
  // A renamed, reordered or whitespace-only copy must reuse the original leaderboard.
  if(fingerprint(source.cards)===fingerprint(v.cards))return json(source);
 }
 // Attribution comes from the saved source and authenticated user, never client-supplied names.
 const key=source?'adapted:'+source.id+':'+session.user.id+':'+fingerprint(v.cards):'custom:'+fingerprint(v.cards);
 const {rows}=await db.query(`INSERT INTO shared_sets(fingerprint,title,created_by,cards,term_count,creator_name,creator_url,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id,public_id,title`,[key,v.title,session.user.id,JSON.stringify(v.cards),v.cards.length,source?.creator_name??null,source?.creator_url??null,source?.source_url??null]);return json(rows[0]);
 }
 if(path[0]==='runs'&&path.length===1){
 const v=z.object({setId:uuid,mode:z.enum(['SLOTH','BEGINNER','INTERMEDIATE','EXPERT','MAD_MAX'])}).parse(input);
 const {rows}=await db.query(`INSERT INTO game_runs(user_id,set_id,mode) VALUES($1,$2,$3) RETURNING id`,[session.user.id,v.setId,v.mode]);return json(rows[0]);
 }
 if(path[0]==='runs'&&uuid.safeParse(path[1]).success&&path[2]==='finish'){
 const v=z.object({score:z.number().int().min(0).max(10000000),level:z.number().int().min(1).max(10000)}).parse(input);
 const client=await db.connect();try{
 await client.query('BEGIN');const {rows}=await client.query(`SELECT *,extract(epoch FROM now()-started_at) AS elapsed FROM game_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,[path[1],session.user.id]);const run=rows[0];
 if(!run){await client.query('ROLLBACK');return json({error:'Run not found'},404);}
 if(run.finished_at){await client.query('ROLLBACK');return json({saved:true});}
 if(run.elapsed<2||run.elapsed>86400||v.level>Math.floor(run.elapsed/2)+2||v.score>run.elapsed*5000){await client.query('ROLLBACK');return json({error:'This run could not be validated.'},400);}
 await client.query('UPDATE game_runs SET finished_at=now(),score=$1,level=$2 WHERE id=$3',[v.score,v.level,run.id]);
 await client.query(`INSERT INTO high_scores(set_id,user_id,score,level,mode) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(set_id,user_id) DO UPDATE SET score=EXCLUDED.score,level=EXCLUDED.level,mode=EXCLUDED.mode,achieved_at=now() WHERE EXCLUDED.score>high_scores.score`,[run.set_id,session.user.id,v.score,v.level,run.mode]);
 await client.query('COMMIT');return json({saved:true});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 return json({error:'Not found'},404);
 }catch(e){if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Check your input.'},400);return json({error:e instanceof Error&&e.message==='RATE'?'Please wait a minute.':'Unable to save. Please retry.'},e instanceof Error&&e.message==='RATE'?429:500);}
}
