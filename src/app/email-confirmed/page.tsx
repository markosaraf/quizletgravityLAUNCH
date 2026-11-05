import Link from 'next/link';
import '@/components/community/community.css';
export default async function EmailConfirmed({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {error}=await searchParams;
 return <main className="community-panel"><h1>{error?'Confirmation link unavailable':'Email confirmed'}</h1><p>{error?'This link is invalid or expired. Return to your account and request another confirmation email.':'Your email is confirmed. Return to Quizzlet Gravity in your app or browser and sign in with your username and password.'}</p><Link href="/">Back to Quizzlet Gravity</Link></main>;
}
