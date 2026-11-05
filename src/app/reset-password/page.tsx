'use client';
import {useState} from 'react';
import {authClient} from '@/lib/community/auth-client';
import '@/components/community/community.css';
export default function ResetPassword(){const [password,setPassword]=useState('');const [message,setMessage]=useState('');return <main className="community-panel"><h1>Reset your password</h1><form onSubmit={async e=>{e.preventDefault();const token=new URLSearchParams(location.search).get('token');if(!token){setMessage('This recovery link is missing or expired. Request a new one.');return;}const r=await authClient.resetPassword({newPassword:password,token});setMessage(r.error?.message||'Password updated. You can now sign in.');}}><label>New password<input type="password" minLength={8} maxLength={128} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button>Save password</button></form><p role="status">{message}</p><a href="/">Back to Quizzlet Gravity</a></main>;}
