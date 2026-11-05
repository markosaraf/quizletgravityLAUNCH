import { getMigrations } from 'better-auth/db/migration';
import { auth } from '../src/lib/community/auth';
import { db } from '../src/lib/community/db';
import { readFileSync } from 'node:fs';
async function main(){
 const {rows}=await db.query('select current_database() name');
 if(rows[0].name!=='quizzlet_preview') throw Error('Refusing migration outside preview database');
 const m=await getMigrations(auth.options);await m.runMigrations();
 await db.query(readFileSync('scripts/community-schema.sql','utf8'));await db.end();console.log('Preview schema ready');
}
main().catch(e=>{console.error(e.message);process.exit(1)});
