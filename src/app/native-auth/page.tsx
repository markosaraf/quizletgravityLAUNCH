'use client';
import {useEffect,useState} from 'react';
import {authClient} from '@/lib/community/auth-client';
import {AccountPanel} from '@/components/community/Community';

export default function NativeAuth() {
 const {data:session}=authClient.useSession();
 const [link,setLink]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!session||session.user.isAnonymous)return;
  const params=new URLSearchParams(location.search);
  const challenge=params.get('challenge'),state=params.get('state');
  if(!challenge||!state)return;
  let active=true;
  fetch('/api/native/authorize',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge}),
  }).then(r=>r.json()).then(r=>{
   if(!active)return;
   if(r.error){setError(r.error);return;}
   const callback='quizzletgravitypreview://auth?code='+encodeURIComponent(r.code)+'&state='+encodeURIComponent(state);
   setLink(callback);
   // Android Auth Tab and iOS ASWebAuthenticationSession capture this
   // callback, close the browser sheet, and finish sign-in in the app.
   location.assign(callback);
  }).catch(()=>{if(active)setError('Could not return to the app. Please try signing in again.');});
  return()=>{active=false;};
 },[session?.user.id,session?.user.isAnonymous]);
 return <main className="community-panel">
  <h1>Sign in to Quizzlet Gravity</h1>
  {!session||session.user.isAnonymous?<AccountPanel/>:link?<>
   <p>Returning to Quizzlet Gravity…</p>
   <a className="community-primary" href={link}>Return to Quizzlet Gravity</a>
  </>:<p>Completing sign-in…</p>}
  {error&&<p role="alert">{error}</p>}
 </main>;
}
