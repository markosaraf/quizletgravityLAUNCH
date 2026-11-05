import {SharedSet} from '@/components/community/SharedSet';
export default async function SetPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <SharedSet id={id}/>;}
