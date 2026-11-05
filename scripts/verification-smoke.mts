import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {betterAuth} from 'better-auth';
import {auth} from '../src/lib/community/auth';
import {db} from '../src/lib/community/db';
import {normalizePlayerName} from '../src/lib/community/usernames';
import {correctPendingEmail} from '../src/lib/community/pending-email';
const base='http://localhost:3035';
const suffix=randomBytes(6).toString('hex');
const username='Emilia Dürig '+suffix.slice(0,6),email=`verify-${suffix}@example.test`,corrected=`correct-${suffix}@example.test`;
const password=randomBytes(12).toString('hex');
const messages:string[]=[];
const originalFetch=globalThis.fetch;
// Exercise the actual MIME/Gmail sender, while blocking ALL real outbound mail.
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock-access-token'});
 if(url==='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'){
  const raw=JSON.parse(String(init?.body)).raw;
  const mime=Buffer.from(raw,'base64url').toString();
  const body=Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString();
  messages.push(body);return Response.json({id:'mock-message'});
 }
 throw Error('Unexpected outbound fetch blocked: '+url);
};
const testAuth=betterAuth({...auth.options,baseURL:base,rateLimit:{enabled:false}});
let userId:string|undefined;
async function request(path:string,body?:unknown,cookie=''){
 const response=await testAuth.handler(new Request(base+'/api/auth'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={};}
 return {response,data,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
function latestLink(){const match=messages.at(-1)?.match(/https?:\/\/\S+/);assert(match);return new URL(match[0]);}
try {
 assert.equal((await db.query('select current_database() name')).rows[0].name,'quizzlet_preview');
 const signup=await request('/sign-up/email',{username,email,password,name:'Verification test',callbackURL:'/email-confirmed'});
 assert.equal(signup.response.status,200,JSON.stringify(signup.data));userId=signup.data.user.id;
 assert.equal(signup.data.token,null);assert(!signup.cookie.includes('session_token'));
 assert.equal(messages.length,1);const oldLink=latestLink();
 const denied=await request('/sign-in/username',{username,password});assert.equal(denied.response.status,403);assert.equal(denied.data.code,'EMAIL_NOT_VERIFIED');
 assert.equal(messages.length,2);
 const repeated=await request('/sign-up/email',{username:'other_'+suffix,email,password:'DifferentPass123!',name:'Another name',callbackURL:'/email-confirmed'});
 assert.equal(repeated.response.status,200);assert.equal(messages.length,3);
 assert.equal((await db.query('SELECT username FROM "user" WHERE id=$1',[userId])).rows[0].username,normalizePlayerName(username));
 assert.equal((await db.query('SELECT count(*) FROM "user" WHERE email=$1',[email])).rows[0].count,'1');
 const resentLink=latestLink();assert.equal(resentLink.pathname,'/api/auth/verify-email');
 assert.equal(messages.at(-1)?.includes('Your username: '+username),true);

 await assert.rejects(correctPendingEmail(username,'wrong-password',corrected));
 await correctPendingEmail(username,password,corrected);
 const stale=await request(oldLink.pathname.replace('/api/auth','')+oldLink.search);assert.notEqual(stale.response.headers.get('location'),'/email-confirmed');
 const resend=await request('/send-verification-email',{email:corrected,callbackURL:'/email-confirmed'});assert.equal(resend.response.status,200);
 const link=latestLink();const token=link.searchParams.get('token');assert(token);
 const invalid=await request('/verify-email?token=invalid');assert(invalid.response.status>=400);
 const verified=await request('/verify-email?token='+encodeURIComponent(token));assert.equal(verified.response.status,200,JSON.stringify(verified.data));
 const signed=await request('/sign-in/username',{username,password});assert.equal(signed.response.status,200,JSON.stringify(signed.data));assert(signed.cookie.includes('session_token'));
 await assert.rejects(correctPendingEmail(username,password,email));
 const reset=await request('/request-password-reset',{email:corrected,redirectTo:'/reset-password'});assert.equal(reset.response.status,200);
 const resetLink=latestLink();const resetToken=resetLink.pathname.split('/').at(-1);assert(resetToken);
 const newPassword=randomBytes(8).toString('hex');
 const changed=await request('/reset-password',{token:resetToken,newPassword});assert.equal(changed.response.status,200,JSON.stringify(changed.data));
 const reused=await request('/reset-password',{token:resetToken,newPassword});assert(reused.response.status>=400);
 assert.equal((await request('/sign-in/username',{username,password})).response.status,401);
 assert.equal((await request('/sign-in/username',{username,password:newPassword})).response.status,200);
 const variant=await request('/sign-in/username',{username:(' '+username.toUpperCase()+' ').normalize('NFD'),password:newPassword});assert.equal(variant.response.status,200);assert.equal(variant.data.user.displayUsername,username);
 const duplicateName=await request('/sign-up/email',{username:username.toUpperCase(),email:'another-'+suffix+'@example.test',password,name:'Duplicate'});assert(duplicateName.response.status>=400);
 const oldSession=await request('/get-session',undefined,signed.cookie);assert.equal(oldSession.data,null);
 console.log('PASS: Unicode/spaced username signup and case-insensitive login; duplicate name rejected; no signup session; automatic verification; unverified login blocked; typo correction requires password; old link rejected; resend; verification; verified account protected; password recovery; single-use reset; session revocation. No real email sent.');
}finally{
 globalThis.fetch=originalFetch;
 if(userId)await db.query('DELETE FROM "user" WHERE id=$1',[userId]);
 await db.end();
}
