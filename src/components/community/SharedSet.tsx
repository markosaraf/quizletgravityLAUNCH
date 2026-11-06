'use client';
import {DeleteSetButton} from './Admin';
import {useEffect,useState,useMemo} from 'react';
import {api,AccountPanel,Leaderboard,type SetRecord} from './Community';
import {authClient} from '@/lib/community/auth-client';
import {GravityApp} from '@/components/gravity/GravityApp';
import {importedCardsToTerms} from '@/lib/gravity/import-cards';
import '@/gravity/gravity.css';
export function SharedSet({id}:{id:string}){
 const [set,setSet]=useState<SetRecord|null>(null);const [error,setError]=useState('');const [playing,setPlaying]=useState(false);const [copied,setCopied]=useState(false);const {data:session}=authClient.useSession();
 const gameSet=useMemo(()=>set?{set:{id:set.id,title:set.title,wordLang:'en',defLang:'en'},terms:importedCardsToTerms(set.cards)!}:null,[set]);
 useEffect(()=>{api('sets/'+id).then(setSet).catch(e=>setError(e.message));},[id]);
 if(error)return <main className="community-page"><h1>Set unavailable</h1><p>{error}</p></main>;
 if(!set)return <main className="community-page">Loading set…</main>;
 if(playing&&gameSet)return <GravityApp shared={gameSet}/>;
 return <main className="community-page"><small>{set.term_count} terms</small><h1>{set.title}</h1>{set.source_url?<p>Original Quizlet set creator: {set.creator_url?<a href={set.creator_url} target="_blank" rel="noreferrer">{set.creator_name}</a>:set.creator_name||'Unavailable'} · <a href={set.source_url} target="_blank" rel="noreferrer">Original set</a>{!set.quizlet_id&&<><br/>Quizlet Gravity set creator: {set.added_by}</>}</p>:<p>Quizlet Gravity set creator: {set.added_by}</p>}<div className="community-actions"><DeleteSetButton id={set.id} title={set.title}/><button onClick={()=>{navigator.clipboard.writeText(location.href).then(()=>setCopied(true)).catch(()=>alert('Copy this page’s URL from your address bar.'));}}>{copied?'Link copied':'Copy set link'}</button>{session&&<button onClick={()=>setPlaying(true)}>Play this set</button>}</div>{!session&&<AccountPanel/>}<details><summary>Preview terms</summary><div className="community-terms">{set.cards.slice(0,100).map((c,i)=><div key={i}><span>{c.term}</span><span>{c.definition}</span></div>)}</div>{set.cards.length>100&&<p>Showing the first 100 terms. All {set.term_count} terms are available in the game.</p>}</details><Leaderboard id={id}/></main>;
}
