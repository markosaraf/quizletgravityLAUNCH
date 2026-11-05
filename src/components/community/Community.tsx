'use client';
import Link from 'next/link';
import {sharedSetPath} from '@/lib/community/set-links';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/community/auth-client';
import './community.css';
import { quizletPasteValue } from '@/lib/gravity/quizlet-share-input';
export async function api(path:string, body?:unknown){
 const response=await fetch('/api/community/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Please try again.');return result;
}
function AccountDialog({open,onOpenChange,onDone}:{open:boolean;onOpenChange:(open:boolean)=>void;onDone?:()=>void}){
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="community-dialog-overlay"/><Dialog.Content className="community-dialog" aria-describedby={undefined}><Dialog.Title className="sr-only">Player account</Dialog.Title><Dialog.Close className="community-dialog-close" aria-label="Close account">×</Dialog.Close><AccountPanel onDone={()=>{onOpenChange(false);onDone?.();}}/></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function CommunityNav(){
 const {data:session}=authClient.useSession();const [open,setOpen]=useState(false);
 return <><nav className="community-nav"><Link href="/" className="community-brand"><img src="/tab-gold.svg" alt="" width={30} height={30}/>Quizzlet Gravity <small>PREVIEW</small></Link><div><Link href="/sets">Sets</Link><button aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>{session?.user.username||session?.user.name||'Choose your name'}</button></div></nav><AccountDialog open={open} onOpenChange={setOpen}/></>;
}
const subscribeImportUrl=()=>()=>{};
const getImportUrl=()=>sessionStorage.getItem('gravity-import-url')||'';
const getServerImportUrl=()=>'';
function ImportQuizletSet(){
 const router=useRouter();
 const savedUrl=useSyncExternalStore(subscribeImportUrl,getImportUrl,getServerImportUrl);
 const [draft,setUrl]=useState<string|null>(null);const url=draft??savedUrl;const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [accountOpen,setAccountOpen]=useState(false);
 async function importSet(){
  if(!url.trim())return;
  setBusy(true);setError('');
  try{
   const session=await authClient.getSession();
   if(!session.data){setAccountOpen(true);return;}
   const response=await fetch('/api/import-quizlet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.trim()})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Unable to import this set.');
   if(!result.sharedId)throw Error('The set could not be saved. Please try again.');
   sessionStorage.removeItem('gravity-import-url');router.push(result.sharePath);
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
 }
 return <section className="community-import"><form onSubmit={e=>{e.preventDefault();void importSet();}}><label htmlFor="quizlet-set-url">Import a Quizlet set</label><div className="community-import-row"><input id="quizlet-set-url" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="Quizlet link or shared text" onPaste={e=>{e.preventDefault();const value=quizletPasteValue(e.clipboardData.getData('text/plain'));setUrl(value);sessionStorage.setItem('gravity-import-url',value);}} value={url} onChange={e=>{setUrl(e.target.value);sessionStorage.setItem('gravity-import-url',e.target.value);}} aria-label="Quizlet set link"/><button className="community-primary" disabled={busy||!url.trim()}>{busy?'Importing…':'Import set'}</button></div></form>{error&&<p role="alert">{error}</p>}<AccountDialog open={accountOpen} onOpenChange={setAccountOpen} onDone={()=>void importSet()}/></section>;
}
export function AccountPanel({onDone}:{onDone?:()=>void}){
 const {data:session}=authClient.useSession();const [mode,setMode]=useState<'guest'|'login'|'signup'|'reset'|'verify'>('guest');const [username,setUsername]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirmEmail,setConfirmEmail]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [config,setConfig]=useState({google:false,recovery:false});
 useEffect(()=>{api('config').then(setConfig).catch(()=>{});},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{
 let result;
 if(mode==='guest'){
  if(!session) {const signed=await authClient.signIn.anonymous();if(signed.error)throw Error(signed.error.message);}
  result=await authClient.updateUser({username,name:username,displayUsername:username});
 }else if(mode==='signup'){if(email.trim().toLowerCase()!==confirmEmail.trim().toLowerCase())throw Error('The email addresses do not match.');result=await authClient.signUp.email({email:email.trim(),password,name:username,username,callbackURL:'/email-confirmed'});}
 else if(mode==='login')result=await authClient.signIn.username({username,password});
 else if(mode==='verify'){await api('pending-email',{username,password,email});setMessage('Confirmation sent. Check your inbox and spam folder, then return here to sign in.');return;}
 else {result=await authClient.requestPasswordReset({email,redirectTo:'/reset-password'});}
 if(result.error){if(result.error.code==='EMAIL_NOT_VERIFIED'){setMode('verify');setMessage('Confirm your email before signing in. A new confirmation link has been sent to your registered address. If you mistyped it, enter the correct address below.');return;}throw Error(result.error.message||'Please check your details.');}
 if(mode==='signup'){setMode('verify');setMessage('Check your email to activate your account. The link expires in one hour. You must confirm before signing in.');}
 else if(mode==='reset')setMessage('If an account matches, you’ll receive a recovery link.');else{await authClient.getSession({query:{disableCookieCache:true}});onDone?.();}
 }catch(e){setMessage(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 return <section className="community-panel"><h2>{session&&!session.user.isAnonymous?'Your account':mode==='verify'?'Confirm your email':'Your player name'}</h2>{mode==='verify'&&message&&<p role="status">{message}</p>}{session&&!session.user.isAnonymous?<><p>Signed in as {session.user.username||session.user.name}.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');try{const r=await authClient.updateUser({username,displayUsername:username});if(r.error)throw Error(r.error.message);await authClient.getSession({query:{disableCookieCache:true}});onDone?.();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><label>Leaderboard username<input required minLength={3} maxLength={24} value={username} onChange={e=>setUsername(e.target.value)} placeholder={session.user.username||'Choose a player name'}/></label><button disabled={busy||!username.trim()}>Save player name</button></form><button onClick={()=>authClient.signOut().then(()=>onDone?.())}>Sign out</button></>:<><div className="community-tabs">{(['guest','login','signup'] as const).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>{setMode(m);setMessage('');}}>{m==='guest'?'Guest':m==='login'?'Sign in':'Create account'}</button>)}</div><form onSubmit={submit}>{mode!=='reset'&&<label>Username<input required minLength={3} maxLength={24} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label>}{(mode==='signup'||mode==='reset'||mode==='verify')&&<label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>}{mode==='signup'&&<label>Confirm email<input required type="email" autoComplete="email" value={confirmEmail} onChange={e=>setConfirmEmail(e.target.value)}/></label>}{(mode==='login'||mode==='signup'||mode==='verify')&&<label>Password<input required type="password" minLength={mode==='signup'?8:1} autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}<button className="community-primary" disabled={busy}>{busy?'Please wait…':mode==='guest'?'Play as guest':mode==='reset'?'Send recovery link':mode==='verify'?'Correct email & send confirmation':mode==='signup'?'Create account':'Sign in'}</button></form>{mode==='verify'&&<><p>Confirm the link in your email, then sign in here. You can correct a typo above using your username and password.</p><button disabled={busy||!email.trim()} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/auth/send-verification-email',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,callbackURL:'/email-confirmed'})});if(!r.ok)throw Error('Could not send confirmation. Please wait a minute and retry.');setMessage('If this address is awaiting confirmation, a new link has been sent.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Resend confirmation</button><button onClick={()=>{setMode('login');setMessage('');}}>I confirmed my email — sign in</button></>}{mode==='guest'&&<p className="community-note">Guest scores belong to this browser. Create an account to keep them across devices.</p>}{config.google&&<button onClick={()=>{if(navigator.userAgent.includes('QuizzletGravityPreview'))location.assign(new URL('/native/start',location.origin).href);else void authClient.signIn.social({provider:'google',callbackURL:location.href});}}>Continue with Google</button>}{config.recovery&&<button onClick={()=>setMode('reset')}>Forgot password?</button>}{session?.user.isAnonymous&&<button onClick={()=>authClient.signOut()}>Leave guest session</button>}</>}{mode!=='verify'&&message&&<p role="status">{message}</p>}</section>;
}
export function ShareSet({title,cards,original}:{title:string;cards:{term:string;definition:string}[];original?:{id:string;snapshot:string}}){
 const {data:session}=authClient.useSession();const [draft,setDraft]=useState({source:title,value:title});const name=draft.source===title?draft.value:title;const snapshot=JSON.stringify(cards);const [saved,setSaved]=useState({snapshot:'',link:''});const link=saved.snapshot===snapshot?saved.link:'';const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 if(cards.length<2)return null;
 async function share(){setBusy(true);setError('');try{const set=original&&original.snapshot===snapshot?await api('sets/'+original.id):await api('sets',{title:name,cards});setSaved({snapshot,link:location.origin+sharedSetPath(set)});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="community-share"><h3>Share this set</h3><p>One shared link. One leaderboard. Invite friends before you play.</p><label>Set title<input value={name} onChange={e=>setDraft({source:title,value:e.target.value})} maxLength={200}/></label>{!session?<AccountPanel/>:<button disabled={busy||!name.trim()} onClick={share}>{busy?'Saving…':'Create shared link'}</button>}{link&&<div><input aria-label="Shared set link" readOnly value={link}/><button onClick={()=>navigator.clipboard.writeText(link).catch(()=>setError('Select and copy the link above.'))}>Copy link</button> <Link href={link}>Open set & leaderboard →</Link></div>}{error&&<p role="alert">{error}</p>}</section>;
}
export function SetsDirectory(){
 const [query,setQuery]=useState('');const [sets,setSets]=useState<SetRecord[]>([]);const [offset,setOffset]=useState(0);const [more,setMore]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{setLoading(true);api('sets?q='+encodeURIComponent(query)+'&offset='+offset).then(r=>{if(active){setSets(r.sets);setMore(r.hasMore);setError('');}}).catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));},200);return()=>{active=false;clearTimeout(timer);};},[query,offset]);
 return <main className="community-page"><h1>Find your next set</h1><p>Import your Quizlet set or find a shared set below.</p><ImportQuizletSet/><label>Search sets<input type="search" placeholder="Search by title or Quizlet creator" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>{error&&<p role="alert">{error}</p>}{loading?<p>Loading sets…</p>:<><div className="community-grid">{sets.map(s=><Link className="community-set" href={sharedSetPath(s)} key={s.id}><small>{s.term_count} terms</small><h2>{s.title}</h2><p>{s.source_url?'Quizlet creator: '+(s.creator_name||'Unavailable'):'Created by '+s.added_by}</p><span>Play & leaderboard →</span></Link>)}</div>{!sets.length&&<p>No sets yet. Import or create the first one.</p>}</>}<div className="community-pagination"><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-24))}>Previous</button><button disabled={!more||loading} onClick={()=>setOffset(offset+24)}>Next</button></div></main>;
}
export type SetRecord={id:string;public_id:string;title:string;term_count:number;creator_name?:string;creator_url?:string;source_url?:string;added_by:string;cards:{term:string;definition:string}[]};
export function Leaderboard({id,refresh=0}:{id:string;refresh?:number}){
 const [entries,setEntries]=useState<{player_id:string;username:string;guest:boolean;score:number;level:number;mode:string}[]>([]);const [offset,setOffset]=useState(0);const [more,setMore]=useState(false);const [error,setError]=useState('');useEffect(()=>{let active=true;api(`sets/${id}/leaderboard?offset=${offset}`).then(r=>{if(active){setEntries(r.entries);setMore(r.hasMore);}}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[id,offset,refresh]);return <section className="community-board"><h2>Leaderboard</h2><p>Each player’s best score across completed games.</p>{error&&<p role="alert">{error}</p>}<div className="community-table"><table><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Level</th><th>Mode</th></tr></thead><tbody>{entries.map((e,i)=><tr key={e.player_id}><td>{offset+i+1}</td><td>{e.username}{e.guest&&<small> · Guest</small>}</td><td>{e.score.toLocaleString()}</td><td>{e.level}</td><td>{e.mode.toLowerCase().replace('_',' ')}</td></tr>)}</tbody></table></div>{!entries.length&&!error&&<p>Be the first to finish a game.</p>}<button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button> <button disabled={!more} onClick={()=>setOffset(offset+50)}>Next</button></section>;
}
