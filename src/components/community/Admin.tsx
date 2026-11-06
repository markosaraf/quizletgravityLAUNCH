'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {authClient} from '@/lib/community/auth-client';
import {sharedSetPath} from '@/lib/community/set-links';
export function useAdmin(){
 const {data:session}=authClient.useSession();
 const id=session?.user.id;
 const [checked,setChecked]=useState({id:'',admin:false});
 useEffect(()=>{let active=true;if(id)fetch('/api/admin/status').then(r=>r.json()).then(r=>{if(active)setChecked({id,admin:r.admin===true});}).catch(()=>{});return()=>{active=false;};},[id]);
 return !!id&&checked.id===id&&checked.admin;
}
async function remove(kind:'users'|'sets',id:string){
 const response=await fetch(`/api/admin/${kind}/${encodeURIComponent(id)}`,{method:'DELETE'});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to delete.');
}
export function DeleteSetButton({id,title}:{id:string;title:string}){
 const admin=useAdmin();const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 if(!admin)return null;
 return <><button disabled={busy} onClick={async()=>{if(!confirm(`Delete “${title}” and its leaderboard? This cannot be undone.`))return;setBusy(true);try{await remove('sets',id);router.push('/sets');}catch(e){setError((e as Error).message);setBusy(false);}}}>Delete set</button>{error&&<p role="alert">{error}</p>}</>;
}
interface UserRow{id:string;username:string;guest:boolean;admin:boolean;created_at:string}
interface SetRow{id:string;public_id:string;title:string;source_url:string|null;term_count:number;creator:string}
export function AdminUsers(){
 const admin=useAdmin();const [kind,setKind]=useState<'users'|'sets'>('users');const [q,setQ]=useState('');const [offset,setOffset]=useState(0);const [version,setVersion]=useState(0);
 const [data,setData]=useState<{users?:UserRow[];sets?:SetRow[];total?:number;accounts?:number;guests?:number;hasMore?:boolean}>({});
 const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('');
 useEffect(()=>{let active=true;if(!admin)return;const timer=setTimeout(()=>{setLoading(true);fetch(`/api/admin/${kind}?q=${encodeURIComponent(q)}&offset=${offset}`).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);if(active){setData(value);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});},200);return()=>{active=false;clearTimeout(timer);};},[admin,kind,q,offset,version]);
 async function deleteItem(id:string,name:string){if(!confirm(kind==='users'?`Delete user “${name}”? Their login and personal details will be removed. Existing scores will say “Deleted user”.`:`Delete “${name}” and its leaderboard? This cannot be undone.`))return;setBusy(id);try{await remove(kind,id);setVersion(v=>v+1);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 if(!admin)return <main className="community-page"><h1>Users</h1><p>Sign in with your administrator account to manage users and sets.</p></main>;
 return <main className="community-page"><h1>{kind==='users'?'Users':'Manage sets'}</h1><div className="community-tabs"><button aria-pressed={kind==='users'} onClick={()=>{setKind('users');setOffset(0);setQ('');}}>Users</button><button aria-pressed={kind==='sets'} onClick={()=>{setKind('sets');setOffset(0);setQ('');}}>Sets</button></div>{kind==='users'&&data.total!==undefined&&<p><strong>{data.total} users</strong> · {data.accounts} accounts · {data.guests} guests</p>}<label>Search {kind}<input type="search" value={q} onChange={e=>{setQ(e.target.value);setOffset(0);}}/></label>{error&&<p role="alert">{error}</p>}{loading?<p>Loading…</p>:<ul className="admin-list">{kind==='users'?data.users?.map(u=><li key={u.id}><div><strong>{u.username}</strong><small>{u.admin?'Administrator':u.guest?'Guest':'Account'}</small></div><button disabled={!!busy||u.admin} onClick={()=>deleteItem(u.id,u.username)}>{busy===u.id?'Deleting…':'Delete user'}</button></li>):data.sets?.map(s=><li key={s.id}><div><Link href={sharedSetPath(s)}>{s.title}</Link><small>{s.term_count} terms · {s.creator}</small></div><button disabled={!!busy} onClick={()=>deleteItem(s.id,s.title)}>{busy===s.id?'Deleting…':'Delete set'}</button></li>)}</ul>}<div className="community-pagination"><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button><button disabled={!data.hasMore||loading} onClick={()=>setOffset(offset+50)}>Next</button></div></main>;
}
