import {notFound,redirect} from 'next/navigation';
import {db} from '@/lib/community/db';
import {sharedSetPath} from '@/lib/community/set-links';
export default async function SetPage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!/^[a-f0-9-]{36}$/i.test(id))notFound();
 const {rows}=await db.query('SELECT public_id,title,source_url FROM shared_sets WHERE id=$1',[id]);
 if(!rows[0])notFound();redirect(sharedSetPath(rows[0]));
}
