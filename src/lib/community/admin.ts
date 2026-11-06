import {db} from './db';
export async function isAdmin(userId:string):Promise<boolean>{
 const {rows}=await db.query('SELECT 1 FROM community_admins WHERE user_id=$1',[userId]);
 return rows.length>0;
}
