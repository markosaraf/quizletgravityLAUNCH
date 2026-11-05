import {db} from './db';
import {normalizePlayerName} from './usernames';
import {auth} from './auth';

/** Only an unverified credential account's password holder can correct a typo. */
export async function correctPendingEmail(username:string,password:string,email:string) {
 const context=await auth.$context;
 const {rows}=await db.query(`SELECT u.id,u.email,u."emailVerified",u."isAnonymous",a.password FROM "user" u
 JOIN account a ON a."userId"=u.id AND a."providerId"='credential' WHERE u.username=$1`,[normalizePlayerName(username)]);
 const user=rows[0];
 if(!user?.password){await context.password.hash(password);throw Error('Check your username and password.');}
 if(!await context.password.verify({hash:user.password,password}))throw Error('Check your username and password.');
 if(user.emailVerified||user.isAnonymous)throw Error('This option is only for an email address awaiting confirmation.');
 const client=await db.connect();
 try {
  await client.query('BEGIN');
  const updated=await client.query(`UPDATE "user" SET email=$1,"updatedAt"=now() WHERE id=$2 AND "emailVerified"=false AND email=$3 RETURNING id`,[email,user.id,user.email]);
  if(!updated.rowCount)throw Error('Account changed. Please sign in again.');
  await client.query('DELETE FROM session WHERE "userId"=$1',[user.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='23505')throw Error('This email cannot be used. Try signing in or recovering your account.');throw Error('Unable to update email. Please try again.');}finally{client.release();}
}
