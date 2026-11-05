import {notFound,redirect} from 'next/navigation';
import {db} from '@/lib/community/db';
import {sharedSetPath} from '@/lib/community/set-links';
import {SharedSet} from '@/components/community/SharedSet';
export default async function SetPage({params}:{params:Promise<{setPath:string[]}>}) {
 const {setPath}=await params;
 const path='/'+setPath.join('/');
 const match=path.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(\d{1,20})\/[^/]+-flash-cards$/i);
 if(!match)notFound();
 const {rows}=await db.query('SELECT id,public_id,title,source_url FROM shared_sets WHERE public_id=$1',[match[1]]);
 const set=rows[0];if(!set)notFound();
 const canonical=sharedSetPath(set);
 if(decodeURI(canonical)!==path)redirect(canonical);
 return <SharedSet id={set.id}/>;
}
