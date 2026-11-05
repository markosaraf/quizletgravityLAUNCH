import { createHash } from 'node:crypto';
import { db } from './db';
import type { QuizletImportResult } from '../gravity/quizlet-parser';
export type Card = {term:string;definition:string};
export function fingerprint(cards:Card[]){return createHash('sha256').update(JSON.stringify(cards.map(c=>[c.term.trim().normalize('NFC'),c.definition.trim().normalize('NFC')]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');}
export async function saveQuizletSet(result:QuizletImportResult,userId:string){
 const {rows}=await db.query(`INSERT INTO shared_sets(public_id,quizlet_id,fingerprint,title,creator_name,creator_url,source_url,created_by,cards,term_count)
 VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(quizlet_id) DO UPDATE SET quizlet_id=EXCLUDED.quizlet_id RETURNING *`,
 [result.setId,'quizlet:'+result.setId,result.title,result.creatorName||null,result.creatorUrl||null,result.url,userId,JSON.stringify(result.cards),result.cards.length]);return rows[0];
}
